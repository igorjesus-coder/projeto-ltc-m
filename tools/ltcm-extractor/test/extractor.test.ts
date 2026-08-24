import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as XLSX from 'xlsx';

import { writeArtifacts } from '../src/artifact-writer.js';
import { canonicalJson, sha256Canonical } from '../src/canonical-json.js';
import { parseArguments } from '../src/cli.js';
import { extractWorkbook, worksheetRangeCellCount } from '../src/extractor.js';
import {
  assertP013MonthlySourceFingerprint,
  evaluateP013MonthlySource,
} from '../src/p013-source-gate.js';
import { OPERATIONAL_SHEETS, type StagingRowArtifact } from '../src/types.js';
import { inspectWorkbookPackage } from '../src/workbook-package.js';

const execFileAsync = promisify(execFile);

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'ltcm-p010-test-'));
}

function operationalWorkbook(
  options: {
    missingCurve?: boolean;
    unexpected?: boolean;
    hiddenRevenue?: boolean;
    formulaWithoutCache?: boolean;
    unexpectedEmpty?: boolean;
    reverseOperationalOrder?: boolean;
    date1904?: boolean;
  } = {},
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const values = XLSX.utils.aoa_to_sheet([
    [1, 2],
    [],
    ['  código sem normalização  ', true, 866.5999999999999, 0],
  ]);
  values.C1 = { t: 'n', v: 3, f: 'A1+B1', z: '0.00' };
  values.D1 = { t: 'n', v: 45_658, z: 'yyyy-mm-dd' };
  values.E1 = { t: 's', v: '' };
  values.F2 = { t: 'z', z: '0' };
  values.E3 = { t: 'e', v: 7, w: '#DIV/0!' };
  if (options.formulaWithoutCache) values.F1 = { t: 'n', f: 'A1*B1' };
  values.G1 = { t: 's', v: 'mesclada' };
  values['!ref'] = 'A1:H3';
  values['!merges'] = [XLSX.utils.decode_range('G1:H1')];
  const revenue = XLSX.utils.aoa_to_sheet([[100], [200]]);
  const curve = XLSX.utils.aoa_to_sheet([[0.1], [0.2]]);
  const operational = [
    [values, OPERATIONAL_SHEETS[0].name],
    [revenue, OPERATIONAL_SHEETS[1].name],
    [curve, OPERATIONAL_SHEETS[2].name],
  ] as const;
  for (const [sheet, name] of options.reverseOperationalOrder
    ? [...operational].reverse()
    : operational) {
    if (options.missingCurve && name === OPERATIONAL_SHEETS[2].name) continue;
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([['conteúdo documental secreto']]),
    'Decisões Aprovadas',
  );
  if (options.unexpected)
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['ignorar']]), 'Outra Aba');
  if (options.unexpectedEmpty)
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), 'Outra Aba Vazia');

  workbook.Workbook = {
    WBProps: { date1904: options.date1904 ?? true },
    Sheets: workbook.SheetNames.map((name) => ({
      name,
      Hidden: options.hiddenRevenue && name === OPERATIONAL_SHEETS[1].name ? 1 : 0,
    })),
  };
  return workbook;
}

function ltcmProfileWorkbook(
  options: { duplicateCompetency?: boolean; outOfOrderCompetency?: boolean } = {},
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const projectCodes = [
    '2024-02-10990',
    '2024-06-11837',
    '2024-10-12524',
    '2025-07-14416',
    '2026-01-15797',
    '2025-12-15568',
    '2025-08-14656',
    '2026-03-16231',
    '2026-04-16531',
  ];
  const periods = [46204, 46235, 46266, 46296, 46327, 46357, 46388, 46419, 46447];
  if (options.duplicateCompetency) periods[1] = periods[0] ?? 46204;
  if (options.outOfOrderCompetency)
    [periods[0], periods[1]] = [periods[1] ?? 46235, periods[0] ?? 46204];

  const projectValues = XLSX.utils.aoa_to_sheet([['PROJETOS LTC-M (TOTAL+DEMANDA)']]);
  projectValues.A2 = { t: 's', v: 'PROJETOS LTC-M' };
  projectCodes.forEach((code, index) => {
    projectValues[`${XLSX.utils.encode_col(index + 2)}2`] = {
      t: 's',
      v: code === '2024-06-11837' ? ` ${code}-SINTÉTICO` : `${code}-SINTÉTICO`,
    };
  });
  projectValues.K3 = { t: 'n', v: 164000 };
  for (const address of ['B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'C4', 'C5']) {
    projectValues[address] = { t: 'n', v: address === 'B3' ? 1 : 0, f: '1+0' };
  }
  projectValues['!ref'] = 'A1:K10';

  const monthly = XLSX.utils.aoa_to_sheet([]);
  for (const [column, value] of Object.entries({
    A: 'Item',
    B: 'Projeto LTC-M',
    C: 'Cliente',
    D: 'Código',
    E: 'Descrição',
    F: 'Quantidade',
    G: 'UN',
    H: 'Moeda',
    I: 'Preço Unitário',
    J: 'Preço Total',
  })) {
    monthly[`${column}3`] = { t: 's', v: value };
  }
  periods.forEach((serial, index) => {
    monthly[`${XLSX.utils.encode_col(index + 10)}3`] = { t: 'n', v: serial, z: 'mmm-yy' };
  });
  for (let row = 4; row <= 51; row += 1) {
    const code = projectCodes[(row - 4) % projectCodes.length] ?? projectCodes[0];
    monthly[`A${row}`] = { t: 'n', v: row - 3 };
    monthly[`B${row}`] = { t: 's', v: `${code}-SINTÉTICO` };
    if (row !== 48) {
      monthly[`D${row}`] = { t: 's', v: `ITEM-${(row - 4) % 5}` };
      monthly[`E${row}`] = { t: 's', v: 'Descrição sintética' };
    }
    for (let column = 10; column <= 18; column += 1) {
      monthly[`${XLSX.utils.encode_col(column)}${row}`] = { t: 'z', z: '0.00' };
    }
  }
  monthly.K4 = { t: 'n', v: 0, z: '0.00' };
  monthly.L4 = { t: 'n', v: 10, z: '0.00' };
  monthly.M4 = { t: 'n', v: 20.005, f: '10+10.005', z: '0.00' };
  monthly.B45 = { t: 's', v: '2024-02-10990-SINTÉTICO' };
  monthly.B51 = { t: 's', v: '2026-04-16531-SINTÉTICO' };
  for (let row = 4; row <= 14; row += 1) monthly[`J${row}`] = { t: 'n', v: 1, f: '1+0' };
  monthly.J45 = { t: 'n', v: 369749.1735, f: '1+0', z: '0.0000' };
  monthly.J51 = { t: 'n', v: 164000, f: '1+0', z: '0' };
  const totals = periods.map((_, index) => [0, 10, 20.005][index] ?? 0);
  totals.forEach((value, index) => {
    monthly[`${XLSX.utils.encode_col(index + 10)}52`] = { t: 'n', v: value, f: '1+0' };
  });
  monthly.J52 = { t: 'n', v: 45, f: 'SUM(J4:J51)' };
  monthly.T52 = { t: 'n', v: 30.005, f: 'SUM(K52:S52)' };
  monthly['!ref'] = 'A1:T52';

  const curve = XLSX.utils.aoa_to_sheet([]);
  curve.B2 = { t: 's', v: 'CURVA S - SINTÉTICA' };
  periods.forEach((serial, index) => {
    curve[`${XLSX.utils.encode_col(index + 2)}7`] = { t: 'n', v: serial, z: 'mmm-yy' };
    curve[`${XLSX.utils.encode_col(index + 2)}8`] = {
      t: 'n',
      v: totals[index] ?? 0,
      f: '1+0',
    };
    curve[`${XLSX.utils.encode_col(index + 2)}9`] = {
      t: 'n',
      v: totals.slice(0, index + 1).reduce((sum, value) => sum + value, 0),
      f: '1+0',
    };
    curve[`${XLSX.utils.encode_col(index + 2)}10`] = { t: 'n', v: 1, f: '1+0' };
  });
  curve.L8 = { t: 'n', v: 30.005, f: 'SUM(C8:K8)' };
  curve.L9 = { t: 'n', v: 45, f: '1+0' };
  curve.L10 = { t: 'n', v: 1, f: '1+0' };
  curve['!ref'] = 'A1:L16';

  const documentarySheet = XLSX.utils.aoa_to_sheet([['Decisão sintética']]);
  documentarySheet.F11 = { t: 's', v: 'fim sintético' };
  documentarySheet['!ref'] = 'A1:F11';
  XLSX.utils.book_append_sheet(workbook, projectValues, OPERATIONAL_SHEETS[0].name);
  XLSX.utils.book_append_sheet(workbook, monthly, OPERATIONAL_SHEETS[1].name);
  XLSX.utils.book_append_sheet(workbook, curve, OPERATIONAL_SHEETS[2].name);
  XLSX.utils.book_append_sheet(workbook, documentarySheet, 'Decisões Aprovadas');
  workbook.Workbook = {
    WBProps: { date1904: false },
    Sheets: workbook.SheetNames.map((name) => ({ name, Hidden: 0 })),
  };
  return workbook;
}

async function writeWorkbook(directory: string, workbook = operationalWorkbook()): Promise<string> {
  const target = path.join(directory, 'origem.xlsx');
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', cellDates: false });
  await writeFile(target, bytes);
  return target;
}

async function snapshotDirectory(root: string): Promise<Map<string, Buffer>> {
  const snapshot = new Map<string, Buffer>();
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll('\\', '/');
      if (entry.isDirectory()) await visit(absolute);
      else snapshot.set(relative, await readFile(absolute));
    }
  }
  await visit(root);
  return snapshot;
}

test('serializa o contrato v1 sem normalizar valores e preserva estados de célula', async (context) => {
  const temporary = await temporaryDirectory();
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const input = await writeWorkbook(temporary);
  const result = await extractWorkbook({
    inputPath: input,
    outputDir: path.join(temporary, 'out'),
    strict: true,
  });

  assert.equal(
    result.exitCode,
    0,
    JSON.stringify(result.validationReport.entries.map((entry) => entry.error_code)),
  );
  assert.equal(result.manifest.payload_schema_version, 1);
  assert.equal(
    result.manifest.source.source_hash,
    createHash('sha256')
      .update(await readFile(input))
      .digest('hex'),
  );
  assert.equal(result.manifest.workbook.date_system, '1904');
  assert.deepEqual(result.manifest.workbook.ignored_sheet_names, ['Decisões Aprovadas']);
  const rows = result.rowsBySheet.get('project_values');
  assert.ok(rows);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]?.raw_payload.schema_version, 1);
  assert.equal(rows[0]?.source_range, 'A1:H1');
  assert.equal(rows[0]?.raw_payload.cells.length, 8);
  assert.deepEqual(rows[0]?.raw_payload.cells[2], {
    column_index: 3,
    column_letter: 'C',
    address: 'C1',
    value: 3,
    formula: 'A1+B1',
    data_type: 'number',
    number_format: '0.00',
    state: 'formula',
    record_present: true,
    value_present: true,
    stub: false,
    cached_result_present: true,
    formatted_text: '3.00',
    round_trip_text: '3',
  });
  assert.equal(rows[0]?.raw_payload.cells[3]?.value, 45_658);
  assert.equal(rows[0]?.raw_payload.cells[3]?.number_format, 'yyyy-mm-dd');
  assert.equal(rows[0]?.raw_payload.cells[3]?.is_date_serial, true);
  assert.match(rows[0]?.raw_payload.cells[3]?.date_iso ?? '', /^\d{4}-\d{2}-\d{2}$/u);
  assert.equal(rows[0]?.raw_payload.cells[4]?.value, '');
  assert.equal(rows[0]?.raw_payload.cells[4]?.state, 'empty_string');
  assert.equal(rows[0]?.raw_payload.cells[5]?.state, 'missing');
  assert.equal(rows[0]?.raw_payload.cells[5]?.value, null);
  assert.equal(rows[0]?.raw_payload.cells[5]?.record_present, false);
  assert.equal(rows[1]?.raw_payload.cells[5]?.stub, true);
  assert.equal(rows[1]?.raw_payload.cells[5]?.value, null);
  assert.equal(rows[0]?.raw_payload.cells[7]?.state, 'merged');
  assert.equal(rows[0]?.raw_payload.cells[7]?.merged_from, 'G1');
  assert.equal(rows[1]?.row_kind, 'blank');
  assert.equal(rows[2]?.raw_payload.cells[0]?.value, '  código sem normalização  ');
  assert.equal(rows[2]?.raw_payload.cells[1]?.value, true);
  assert.equal(rows[2]?.raw_payload.cells[2]?.round_trip_text, '866.5999999999999');
  assert.equal(rows[2]?.raw_payload.cells[3]?.value, 0);
  assert.equal(rows[2]?.raw_payload.cells[4]?.data_type, 'error');
  assert.equal(rows[2]?.raw_payload.cells[4]?.formatted_error, '#DIV/0!');
  assert.equal(rows[0]?.row_hash, sha256Canonical(rows[0]?.raw_payload));
  assert.equal(
    result.manifest.sheets[0]?.content_hash,
    sha256Canonical(rows.map((row) => row.raw_payload)),
  );
  assert.equal(canonicalJson(result).includes('conteúdo documental secreto'), false);
  assert.equal(canonicalJson(result).includes(path.dirname(input)), false);
});

test('gera exatamente os mesmos bytes em reexecuções no mesmo diretório gerenciado', async (context) => {
  const temporary = await temporaryDirectory();
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const input = await writeWorkbook(temporary);
  const output = path.join(temporary, 'artifacts');
  const first = await extractWorkbook({ inputPath: input, outputDir: output, strict: true });
  await writeArtifacts(output, first);
  const firstSnapshot = await snapshotDirectory(output);
  const second = await extractWorkbook({ inputPath: input, outputDir: output, strict: true });
  await writeArtifacts(output, second);
  const secondSnapshot = await snapshotDirectory(output);

  assert.deepEqual([...secondSnapshot.keys()], [...firstSnapshot.keys()]);
  for (const [name, bytes] of firstSnapshot)
    assert.deepEqual(secondSnapshot.get(name), bytes, name);
  const jsonl = await readFile(path.join(output, 'sheets', 'project_values.jsonl'), 'utf8');
  const rows = jsonl
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as StagingRowArtifact);
  assert.equal(rows[0]?.payload_schema_version, 1);
  assert.equal(rows[0]?.status, 'pending');
  assert.equal(rows[0]?.validation_attempt, 0);
});

test('modo estrito falha estruturalmente, mas mantém artefatos das abas encontradas', async (context) => {
  const temporary = await temporaryDirectory();
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const input = await writeWorkbook(
    temporary,
    operationalWorkbook({ missingCurve: true, unexpected: true, hiddenRevenue: true }),
  );
  const strictResult = await extractWorkbook({
    inputPath: input,
    outputDir: path.join(temporary, 'strict'),
    strict: true,
  });
  const relaxedResult = await extractWorkbook({
    inputPath: input,
    outputDir: path.join(temporary, 'relaxed'),
    strict: false,
  });

  assert.equal(strictResult.exitCode, 1);
  assert.equal(strictResult.manifest.extraction.operational_sheet_count, 2);
  assert.ok(strictResult.rowsBySheet.has('project_values'));
  assert.ok(strictResult.rowsBySheet.has('monthly_revenue'));
  assert.equal(strictResult.rowsBySheet.has('curve_s'), false);
  assert.deepEqual(
    strictResult.validationReport.entries.map((entry) => [entry.error_code, entry.severity]),
    [
      ['P010_REQUIRED_SHEET_MISSING', 'error'],
      ['P010_UNEXPECTED_SHEET', 'error'],
      ['P010_OPERATIONAL_SHEET_HIDDEN', 'error'],
    ],
  );
  assert.deepEqual(
    parseArguments([
      '--input=C:\\Users\\Igor Jesus\\Documents\\origem.xlsx',
      '--output-dir=.artifacts\\saída com espaço',
    ]),
    {
      inputPath: path.resolve('C:\\Users\\Igor Jesus\\Documents\\origem.xlsx'),
      outputDir: path.resolve('.artifacts\\saída com espaço'),
      strict: false,
    },
  );
  assert.deepEqual(
    parseArguments([
      '^--input=C:\\Users\\Igor^ Jesus\\Documents\\origem.xlsx^',
      '--output-dir=.artifacts\\saída',
    ]),
    {
      inputPath: path.resolve('C:\\Users\\Igor Jesus\\Documents\\origem.xlsx'),
      outputDir: path.resolve('.artifacts\\saída'),
      strict: false,
    },
  );
  assert.equal(relaxedResult.exitCode, 0);
  assert.equal(relaxedResult.validationReport.warning_count, 3);
});

test('recusa substituir diretório que não possui marcador P010', async (context) => {
  const temporary = await temporaryDirectory();
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const input = await writeWorkbook(temporary);
  const output = path.join(temporary, 'out');
  await writeFile(output, 'arquivo');
  const result = await extractWorkbook({ inputPath: input, outputDir: output, strict: true });
  await assert.rejects(writeArtifacts(output, result), /não é um diretório/);
});

test('valida argumentos da CLI sem aceitar opções ambíguas', () => {
  assert.deepEqual(parseArguments(['--input', 'a.xlsx', '--output-dir', 'out', '--strict']), {
    inputPath: path.resolve('a.xlsx'),
    outputDir: path.resolve('out'),
    strict: true,
  });
  assert.equal(parseArguments(['--help']), 'help');
  assert.deepEqual(
    parseArguments([
      '--input',
      'C:\\Users\\Igor',
      'Jesus\\Documents\\origem.xlsx',
      '--output-dir',
      '.artifacts\\saída',
      '--strict',
    ]),
    {
      inputPath: path.resolve('C:\\Users\\Igor Jesus\\Documents\\origem.xlsx'),
      outputDir: path.resolve('.artifacts\\saída'),
      strict: true,
    },
  );
  assert.throws(() => parseArguments(['--input', 'a.xlsx']), /--output-dir/);
  assert.throws(() => parseArguments(['--wat']), /desconhecida/);
});

test('executa a CLI compilada e grava o resumo e os artefatos', async (context) => {
  const temporary = await temporaryDirectory();
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const input = await writeWorkbook(temporary);
  const output = path.join(temporary, 'cli-output');
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const execution = await execFileAsync(process.execPath, [
    cli,
    '--input',
    input,
    '--output-dir',
    output,
    '--strict',
  ]);

  assert.match(
    execution.stdout,
    /^P010 passed: 3 aba\(s\), 7 linha\(s\), 0 erro\(s\), 0 aviso\(s\)\./,
  );
  assert.equal(execution.stderr, '');
  assert.equal(
    JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8')).payload_schema_version,
    1,
  );
  await assert.rejects(
    execFileAsync(process.execPath, [cli, '--input', input, '--output-dir', temporary, '--strict']),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 2 &&
      'stderr' in error &&
      typeof error.stderr === 'string' &&
      error.stderr.includes('dentro do diretório de saída'),
  );
});

test('rejeita conteúdo que apenas usa a extensão xlsx', async (context) => {
  const temporary = await temporaryDirectory();
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const input = path.join(temporary, 'falso.xlsx');
  await writeFile(input, 'não é um ZIP XLSX', 'utf8');
  await assert.rejects(
    extractWorkbook({ inputPath: input, outputDir: path.join(temporary, 'out'), strict: true }),
    /assinatura ZIP/,
  );
});

test('preserva fórmula sem inventar resultado em cache e a reporta no modo estrito', async (context) => {
  const temporary = await temporaryDirectory();
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const input = await writeWorkbook(temporary, operationalWorkbook({ formulaWithoutCache: true }));
  const result = await extractWorkbook({
    inputPath: input,
    outputDir: path.join(temporary, 'out'),
    strict: true,
  });

  const formulaCell = result.rowsBySheet.get('project_values')?.[0]?.raw_payload.cells[5];
  assert.equal(formulaCell?.formula, 'A1*B1');
  assert.equal(formulaCell?.value, null);
  assert.equal(formulaCell?.cached_result_present, false);
  assert.equal(result.exitCode, 1);
  assert.ok(
    result.validationReport.entries.some(
      (entry) => entry.error_code === 'P010_FORMULA_WITHOUT_CACHED_RESULT',
    ),
  );
});

test('valida o perfil LTC-M sintético e mantém warning de negócio aprovado sem falhar strict', async (context) => {
  const temporary = await temporaryDirectory();
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const input = await writeWorkbook(temporary, ltcmProfileWorkbook());
  const result = await extractWorkbook({
    inputPath: input,
    outputDir: path.join(temporary, 'out'),
    strict: true,
  });

  assert.equal(
    result.exitCode,
    0,
    JSON.stringify(result.validationReport.entries.map((entry) => entry.error_code)),
  );
  assert.equal(result.profileReport.profile_detected, true);
  assert.equal(result.profileReport.status, 'passed_with_warnings');
  assert.deepEqual(
    result.profileReport.sheets.map((sheet) => [
      sheet.extraction_range,
      sheet.extracted_rows,
      sheet.formula_definitions,
    ]),
    [
      ['A1:K10', 10, 10],
      ['A1:T52', 52, 25],
      ['A1:L16', 16, 30],
    ],
  );
  assert.equal(result.profileReport.projects.count, 9);
  assert.equal(result.profileReport.projects.leading_space_preserved, true);
  assert.equal(result.profileReport.items.count, 48);
  assert.ok(result.profileReport.items.duplicate_code_groups > 0);
  assert.deepEqual(result.profileReport.items.blank_code_rows, [48]);
  assert.deepEqual(
    result.profileReport.competencies.map((competency) => competency.iso),
    [
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
      '2027-03-01',
    ],
  );
  assert.deepEqual(
    result.validationReport.entries.map((entry) => entry.error_code),
    ['RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE'],
  );
  assert.equal(result.profileReport.documentary_sheet.staging_row_count, 0);
  assert.equal(result.rowsBySheet.has('documentary' as never), false);
});

async function p013GateForWorkbook(directory: string, workbook: XLSX.WorkBook) {
  const input = await writeWorkbook(directory, workbook);
  const bytes = await readFile(input);
  const result = await extractWorkbook({
    inputPath: input,
    outputDir: path.join(directory, 'out'),
    strict: true,
  });
  return {
    extraction: result,
    gate: evaluateP013MonthlySource(
      result.rowsBySheet.get('monthly_revenue') ?? [],
      inspectWorkbookPackage(bytes).get('Prev. Receita Mensal'),
    ),
  };
}

test('gate P013 usa fingerprint semântico e ignora formatação, fórmula e topologia OOXML', async (context) => {
  const temporary = await temporaryDirectory();
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const originalRun = await p013GateForWorkbook(
    await mkdtemp(path.join(temporary, 'original-')),
    ltcmProfileWorkbook(),
  );
  assert.equal(originalRun.gate.ok, true, JSON.stringify(originalRun.gate.diagnostics));
  assert.equal(originalRun.gate.cell_count, 432);
  assert.throws(
    () => assertP013MonthlySourceFingerprint(originalRun.gate),
    /P013_SOURCE_SEMANTIC_FINGERPRINT_MISMATCH/u,
  );

  const cosmetic = ltcmProfileWorkbook();
  const cosmeticMonthly = cosmetic.Sheets[OPERATIONAL_SHEETS[1].name];
  assert.ok(cosmeticMonthly);
  cosmeticMonthly.M4 = { t: 'n', v: 20.005, f: '20.005+0', z: '#,##0.0000' };
  const cosmeticRun = await p013GateForWorkbook(
    await mkdtemp(path.join(temporary, 'cosmetic-')),
    cosmetic,
  );
  assert.equal(cosmeticRun.gate.ok, true, JSON.stringify(cosmeticRun.gate.diagnostics));
  assert.equal(cosmeticRun.gate.semantic_fingerprint, originalRun.gate.semantic_fingerprint);

  const metadata = inspectWorkbookPackage(
    await readFile(await writeWorkbook(await mkdtemp(path.join(temporary, 'topology-')), cosmetic)),
  ).get('Prev. Receita Mensal');
  assert.ok(metadata);
  const topologyOnly = {
    ...metadata,
    formulaDefinitions: metadata.formulaDefinitions + 99,
  };
  const topologyGate = evaluateP013MonthlySource(
    cosmeticRun.extraction.rowsBySheet.get('monthly_revenue') ?? [],
    topologyOnly,
  );
  assert.equal(topologyGate.semantic_fingerprint, originalRun.gate.semantic_fingerprint);
});

test('gate P013 rejeita mutações estruturais, de identidade, estado, valor e cache', async (context) => {
  const temporary = await temporaryDirectory();
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const baseline = await p013GateForWorkbook(
    await mkdtemp(path.join(temporary, 'baseline-')),
    ltcmProfileWorkbook(),
  );
  const expected = baseline.gate.semantic_fingerprint ?? '';
  const mutations: Array<[string, (sheet: XLSX.WorkSheet) => void]> = [
    ['header', (sheet) => (sheet.A3 = { t: 's', v: 'Outro' })],
    ['competence', (sheet) => (sheet.K3 = { t: 'n', v: 46205, z: 'mmm-yy' })],
    ['missing-competence', (sheet) => (sheet.K3 = { t: 'z' })],
    ['extra-competence', (sheet) => (sheet.T3 = { t: 'n', v: 46478, z: 'mmm-yy' })],
    ['missing-row', (sheet) => (sheet.A51 = { t: 'z' })],
    [
      'extra-row',
      (sheet) => {
        sheet.A53 = { t: 'n', v: 50 };
        sheet['!ref'] = 'A1:T53';
      },
    ],
    ['value', (sheet) => (sheet.L4 = { t: 'n', v: 11, z: '0.00' })],
    ['zero-to-blank', (sheet) => (sheet.K4 = { t: 'z', z: '0.00' })],
    ['blank-to-zero', (sheet) => (sheet.N4 = { t: 'n', v: 0, z: '0.00' })],
    ['cache', (sheet) => (sheet.M4 = { t: 'n', v: 20.015, f: '10+10.015', z: '0.00' })],
    ['aggregate-cache', (sheet) => (sheet.T52 = { t: 'n', v: 31, f: 'SUM(K52:S52)' })],
    ['formula-error', (sheet) => (sheet.M4 = { t: 'e', v: 7, f: '1/0', w: '#DIV/0!' })],
    ['missing-cache', (sheet) => (sheet.M4 = { t: 'n', f: '10+10.005', z: '0.00' })],
    ['item-identity', (sheet) => (sheet.A4 = { t: 'n', v: 999 })],
  ];
  for (const [name, mutate] of mutations) {
    const workbook = ltcmProfileWorkbook();
    const monthly = workbook.Sheets[OPERATIONAL_SHEETS[1].name];
    assert.ok(monthly);
    mutate(monthly);
    const run = await p013GateForWorkbook(
      await mkdtemp(path.join(temporary, `${name}-`)),
      workbook,
    );
    assert.notEqual(run.gate.semantic_fingerprint, expected, name);
  }

  const renamed = ltcmProfileWorkbook();
  const monthlyIndex = renamed.SheetNames.indexOf(OPERATIONAL_SHEETS[1].name);
  const renamedSheet = renamed.Sheets[OPERATIONAL_SHEETS[1].name];
  assert.ok(renamedSheet);
  renamed.SheetNames[monthlyIndex] = 'Prev. Receita Renomeada';
  delete renamed.Sheets[OPERATIONAL_SHEETS[1].name];
  renamed.Sheets['Prev. Receita Renomeada'] = renamedSheet;
  const renamedRun = await p013GateForWorkbook(
    await mkdtemp(path.join(temporary, 'wrong-worksheet-')),
    renamed,
  );
  assert.notEqual(renamedRun.gate.semantic_fingerprint, expected);
});

test('gate P013 aceita o candidato D01A local por semântica quando disponível', async (context) => {
  const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url));
  const sourceDirectory = path.join(repositoryRoot, '.local-source');
  const sources = await readdir(sourceDirectory).catch(() => []);
  const source = sources.find((name) => name.endsWith('.xlsx'));
  if (source === undefined) {
    context.skip('Fonte D01A local não está disponível.');
    return;
  }
  const input = path.join(sourceDirectory, source);
  const bytes = await readFile(input);
  const result = await extractWorkbook({ inputPath: input, outputDir: '<unused>', strict: true });
  const gate = evaluateP013MonthlySource(
    result.rowsBySheet.get('monthly_revenue') ?? [],
    inspectWorkbookPackage(bytes).get('Prev. Receita Mensal'),
  );
  assert.equal(gate.blank_count, 330);
  assert.equal(gate.explicit_zero_count, 1);
  assert.equal(gate.non_zero_count, 101);
  assert.equal(gate.canonical_total, '2800460.18');
  assert.equal(gate.aggregate_raw_rounded_total, '2800460.15');
  assert.equal(gate.rounding_residual, '0.03');
  assertP013MonthlySourceFingerprint(gate);
});

test('detecta competência duplicada, ordem de abas divergente e abas extras vazia e não vazia', async (context) => {
  const temporary = await temporaryDirectory();
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const duplicateInput = await writeWorkbook(
    temporary,
    ltcmProfileWorkbook({ duplicateCompetency: true }),
  );
  const duplicateResult = await extractWorkbook({
    inputPath: duplicateInput,
    outputDir: path.join(temporary, 'duplicate'),
    strict: true,
  });
  assert.equal(duplicateResult.exitCode, 1);
  assert.equal(
    duplicateResult.profileReport.checks.find((check) => check.check_id === 'COMPETENCIES')?.status,
    'error',
  );

  const orderDirectory = await mkdtemp(path.join(temporary, 'period-order-'));
  const orderInput = await writeWorkbook(
    orderDirectory,
    ltcmProfileWorkbook({ outOfOrderCompetency: true }),
  );
  const orderResult = await extractWorkbook({
    inputPath: orderInput,
    outputDir: path.join(temporary, 'period-order-out'),
    strict: true,
  });
  assert.equal(
    orderResult.profileReport.checks.find((check) => check.check_id === 'COMPETENCIES')?.status,
    'error',
  );

  const structuralDirectory = await mkdtemp(path.join(temporary, 'structural-'));
  const structuralInput = await writeWorkbook(
    structuralDirectory,
    operationalWorkbook({
      reverseOperationalOrder: true,
      unexpected: true,
      unexpectedEmpty: true,
      date1904: false,
    }),
  );
  const structuralResult = await extractWorkbook({
    inputPath: structuralInput,
    outputDir: path.join(temporary, 'structural'),
    strict: true,
  });
  assert.equal(structuralResult.manifest.workbook.date_system, '1900');
  assert.ok(
    structuralResult.validationReport.entries.some(
      (entry) => entry.error_code === 'P010_OPERATIONAL_SHEET_ORDER',
    ),
  );
  assert.ok(
    structuralResult.validationReport.entries.some(
      (entry) => entry.error_code === 'P010_UNEXPECTED_SHEET' && entry.severity === 'error',
    ),
  );
  assert.ok(
    structuralResult.validationReport.entries.some(
      (entry) => entry.error_code === 'P010_UNEXPECTED_EMPTY_SHEET' && entry.severity === 'warning',
    ),
  );
});

test('aplica limites, extensão, proteção de caminho e impacto localizado de hashes', async (context) => {
  const temporary = await temporaryDirectory();
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const original = operationalWorkbook();
  const originalInput = await writeWorkbook(temporary, original);
  const originalResult = await extractWorkbook({
    inputPath: originalInput,
    outputDir: path.join(temporary, 'original-out'),
    strict: true,
  });

  const changedDirectory = await mkdtemp(path.join(temporary, 'changed-'));
  const changed = operationalWorkbook();
  const changedSheet = changed.Sheets[OPERATIONAL_SHEETS[0].name];
  assert.ok(changedSheet);
  changedSheet.A1 = { t: 'n', v: 2 };
  const changedInput = await writeWorkbook(changedDirectory, changed);
  const changedResult = await extractWorkbook({
    inputPath: changedInput,
    outputDir: path.join(temporary, 'changed-out'),
    strict: true,
  });
  assert.notEqual(
    originalResult.manifest.source.source_hash,
    changedResult.manifest.source.source_hash,
  );
  assert.notEqual(
    originalResult.rowsBySheet.get('project_values')?.[0]?.row_hash,
    changedResult.rowsBySheet.get('project_values')?.[0]?.row_hash,
  );
  assert.equal(
    originalResult.rowsBySheet.get('project_values')?.[1]?.row_hash,
    changedResult.rowsBySheet.get('project_values')?.[1]?.row_hash,
  );
  assert.notEqual(
    originalResult.manifest.sheets[0]?.content_hash,
    changedResult.manifest.sheets[0]?.content_hash,
  );
  assert.equal(
    originalResult.manifest.sheets[1]?.content_hash,
    changedResult.manifest.sheets[1]?.content_hash,
  );

  const invalidExtension = path.join(temporary, 'origem.xls');
  await writeFile(invalidExtension, await readFile(originalInput));
  await assert.rejects(
    extractWorkbook({
      inputPath: invalidExtension,
      outputDir: path.join(temporary, 'xls'),
      strict: true,
    }),
    /extensão \.xlsx/,
  );
  const oversized = path.join(temporary, 'grande.xlsx');
  await writeFile(oversized, Buffer.from('PK\u0003\u0004'));
  await truncate(oversized, 100 * 1024 * 1024 + 1);
  await assert.rejects(
    extractWorkbook({
      inputPath: oversized,
      outputDir: path.join(temporary, 'large'),
      strict: true,
    }),
    /excede o limite/,
  );

  const longTextWorkbook = operationalWorkbook();
  const longTextSheet = longTextWorkbook.Sheets[OPERATIONAL_SHEETS[0].name];
  assert.ok(longTextSheet);
  longTextSheet.A1 = { t: 's', v: 'x'.repeat(32_768) };
  assert.throws(() => XLSX.write(longTextWorkbook, { type: 'buffer', bookType: 'xlsx' }), /32767/u);

  assert.ok(worksheetRangeCellCount('A1:XFD1048576') > 2_000_000);
  await assert.rejects(
    writeArtifacts(path.parse(temporary).root, originalResult),
    /diretório raiz/,
  );
});
