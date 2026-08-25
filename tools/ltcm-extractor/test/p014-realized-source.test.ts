import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  loadP014CertifiedRealizedSource,
  readP014CertifiedRealizedSourceFacts,
} from '../src/p014-realized-source.js';
import {
  assertP014RealizedSourceFingerprint,
  evaluateP014RealizedSource,
  P014_D01_REALIZED_SOURCE_SEMANTIC_FINGERPRINT,
  type P014DocumentaryRealizedEvidence,
  type P014RealizedSourceGateInput,
} from '../src/p014-source-gate.js';
import type { RawCellPayload, SheetKey, StagingRowArtifact } from '../src/types.js';
import type {
  WorksheetPackageCellMetadata,
  WorksheetPackageMetadata,
} from '../src/workbook-package.js';

const PROJECT_COLUMNS = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'] as const;
const PROJECT_CODES = [
  '2024-02-10990',
  '2024-06-11837',
  '2024-10-12524',
  '2025-07-14416',
  '2026-01-15797',
  '2025-12-15568',
  '2025-08-14656',
  '2026-03-16231',
  '2026-04-16531',
] as const;
const PROJECT_VALUES = ['2260099.66', '232825', '205446', '0', '0', '0', '0', '0', '0'] as const;
const COMPETENCIES = [
  '2026-07-01',
  '2026-08-01',
  '2026-09-01',
  '2026-10-01',
  '2026-11-01',
  '2026-12-01',
  '2027-01-01',
  '2027-02-01',
  '2027-03-01',
] as const;

function rawCell(
  address: string,
  options: Partial<RawCellPayload> & Pick<RawCellPayload, 'state'>,
): RawCellPayload {
  const column = address.match(/^[A-Z]+/u)?.[0] ?? 'A';
  const value = options.value ?? null;
  return {
    column_index: column.charCodeAt(0) - 64,
    column_letter: column,
    address,
    value,
    formula: options.formula ?? null,
    data_type:
      options.data_type ??
      (options.state === 'blank' ? 'blank' : typeof value === 'number' ? 'number' : 'string'),
    number_format: options.number_format ?? null,
    state: options.state,
    record_present: options.record_present ?? true,
    value_present: options.value_present ?? options.state !== 'blank',
    stub: options.stub ?? options.state === 'blank',
    ...(options.cached_result_present === undefined
      ? {}
      : { cached_result_present: options.cached_result_present }),
    ...(options.date_iso === undefined ? {} : { date_iso: options.date_iso }),
    ...(options.round_trip_text === undefined ? {} : { round_trip_text: options.round_trip_text }),
  };
}

function rows(
  count: number,
  sheetKey: SheetKey,
  sheetName: string,
  cells: readonly RawCellPayload[],
): StagingRowArtifact[] {
  const byRow = new Map<number, RawCellPayload[]>();
  for (const cell of cells) {
    const rowNumber = Number.parseInt(cell.address.match(/\d+$/u)?.[0] ?? '0', 10);
    byRow.set(rowNumber, [...(byRow.get(rowNumber) ?? []), cell]);
  }
  return Array.from({ length: count }, (_, index) => {
    const rowNumber = index + 1;
    const rowCells = byRow.get(rowNumber) ?? [];
    return {
      source_row_number: rowNumber,
      source_range: `A${rowNumber}:L${rowNumber}`,
      row_kind: rowCells.length === 0 ? 'blank' : 'unknown',
      payload_schema_version: 1,
      raw_payload: {
        schema_version: 1,
        sheet_key: sheetKey,
        sheet_name: sheetName,
        row_number: rowNumber,
        source_range: `A${rowNumber}:L${rowNumber}`,
        cells: rowCells,
      },
      row_hash: `${sheetKey}-${rowNumber}`.padEnd(64, '0').slice(0, 64),
      status: 'pending',
      validation_attempt: 0,
    };
  });
}

function packageSheet(
  worksheetRange: string,
  cells: ReadonlyMap<string, WorksheetPackageCellMetadata>,
): WorksheetPackageMetadata {
  return { worksheetRange, formulaCells: 0, formulaDefinitions: 0, cells };
}

function documentary(): P014DocumentaryRealizedEvidence {
  return {
    worksheet_name: 'Decisões Aprovadas',
    structural_range: 'A1:F11',
    realized_topic: 'Curva S — Realizado Mensal',
    realized_meaning: 'Valor efetivamente faturado no mês.',
    realized_workbook_effect: 'A linha Realizado Mensal deve representar faturamento efetivo.',
    realized_system_effect: 'Métrica principal: billing_actual.',
    realized_status: 'Aprovada',
    closed_project_topic: 'Projeto 2024-02-10990',
    closed_project_meaning:
      'Projeto integralmente faturado e encerrado; valores programados são previsão de recebimento.',
    closed_project_system_effect:
      'Não incluir esses valores na Curva S de faturamento; armazenar como receipt_forecast.',
  };
}

function gateInput(): P014RealizedSourceGateInput {
  const projectCells: RawCellPayload[] = [
    rawCell('A2', { state: 'value', value: 'PROJETOS LTC-M' }),
    rawCell('B2', { state: 'value', value: 'TOTAL GERAL' }),
    rawCell('A4', { state: 'value', value: 'Faturado' }),
    rawCell('B4', {
      state: 'formula',
      value: 2698370.66,
      data_type: 'number',
      formula: 'SUM(C4:K4)',
      cached_result_present: true,
    }),
    rawCell('B10', { state: 'value', value: 'obs.: Dados em atualização (21/07)' }),
  ];
  const projectMetadata = new Map<string, WorksheetPackageCellMetadata>([
    ['B4', { valueText: '2698370.66', formulaPresent: true, material: true }],
  ]);
  for (let index = 0; index < PROJECT_COLUMNS.length; index += 1) {
    const column = PROJECT_COLUMNS[index]!;
    const raw = PROJECT_VALUES[index]!;
    const formula = column === 'C' ? 'C3' : null;
    projectCells.push(
      rawCell(`${column}2`, { state: 'value', value: `${PROJECT_CODES[index]}-Projeto` }),
      rawCell(`${column}4`, {
        state: formula === null ? 'value' : 'formula',
        value: Number(raw),
        data_type: 'number',
        formula,
        cached_result_present: formula === null ? undefined : true,
        round_trip_text: raw,
      }),
    );
    projectMetadata.set(`${column}4`, {
      valueText: raw,
      formulaPresent: formula !== null,
      material: true,
    });
  }

  const curveCells: RawCellPayload[] = [
    rawCell('B3', {
      state: 'value',
      value: "Fonte: aba 'Previsão de Receita' (linha Total) | Moeda: BRL",
    }),
    rawCell('B12', { state: 'value', value: 'Realizado Mensal (R$)' }),
    rawCell('L12', {
      state: 'formula',
      value: 551516.655,
      data_type: 'number',
      formula: 'SUM(C12:K12)',
      cached_result_present: true,
    }),
    rawCell('B16', {
      state: 'value',
      value:
        "Legenda: células em amarelo/azul (linha 'Realizado Mensal') são de preenchimento manual pelo usuário.",
    }),
  ];
  const curveMetadata = new Map<string, WorksheetPackageCellMetadata>([
    ['L12', { valueText: '551516.655', formulaPresent: true, material: true }],
  ]);
  for (let index = 0; index < PROJECT_COLUMNS.length; index += 1) {
    const column = PROJECT_COLUMNS[index]!;
    curveCells.push(
      rawCell(`${column}7`, {
        state: 'formula',
        value: 46204 + index * 31,
        data_type: 'number',
        formula: `'Prev. Receita Mensal'!${String.fromCharCode(75 + index)}3`,
        cached_result_present: true,
        date_iso: COMPETENCIES[index],
      }),
    );
    if (column === 'C') {
      curveCells.push(
        rawCell('C12', {
          state: 'value',
          value: 551516.655,
          data_type: 'number',
          round_trip_text: '551516.655',
        }),
      );
      curveMetadata.set('C12', {
        valueText: '551516.655',
        formulaPresent: false,
        material: true,
      });
    } else {
      curveCells.push(rawCell(`${column}12`, { state: 'blank' }));
      curveMetadata.set(`${column}12`, {
        valueText: null,
        formulaPresent: false,
        material: false,
      });
    }
  }
  return {
    project_rows: rows(10, 'project_values', 'Valores Projetos LTC-M', projectCells),
    monthly_rows: rows(52, 'monthly_revenue', 'Prev. Receita Mensal', [
      rawCell('C1', { state: 'value', value: 'ITEM FATURADO' }),
    ]),
    curve_rows: rows(16, 'curve_s', 'Curva S', curveCells),
    package_metadata: new Map([
      ['Valores Projetos LTC-M', packageSheet('A1:K17', projectMetadata)],
      ['Curva S', packageSheet('B2:L16', curveMetadata)],
    ]),
    documentary: documentary(),
  };
}

function mutableCell(rowsValue: readonly StagingRowArtifact[], address: string): RawCellPayload {
  const row = rowsValue.find(
    (candidate) => candidate.source_row_number === Number(address.match(/\d+$/u)?.[0]),
  );
  const cell = row?.raw_payload.cells.find((candidate) => candidate.address === address);
  assert.ok(cell);
  return cell;
}

test('gate P014 congela os dois grãos autoritativos sem fabricar dimensões', () => {
  const result = evaluateP014RealizedSource(gateInput());
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.position_count, 18);
  assert.equal(result.fact_count, 10);
  assert.equal(result.blank_count, 8);
  assert.equal(result.explicit_zero_count, 6);
  assert.equal(result.non_zero_count, 4);
  assert.equal(result.project_aggregate_total, '2698370.66');
  assert.equal(result.portfolio_month_total, '551516.66');
  assert.equal(result.positions.filter(({ item_identity }) => item_identity !== null).length, 0);
  assert.equal(
    result.positions.filter(
      ({ authoritative_grain, competence_month }) =>
        authoritative_grain === 'project_aggregate' && competence_month !== null,
    ).length,
    0,
  );
});

test('gate P014 falha fechado para estrutura, identidade, competência, métrica e cache', () => {
  const mutations: Array<[string, (input: P014RealizedSourceGateInput) => void]> = [
    ['header', (input) => (mutableCell(input.project_rows, 'A4').value = 'Previsto')],
    ['missing-project', (input) => (mutableCell(input.project_rows, 'C2').value = null)],
    [
      'duplicate-project',
      (input) =>
        (mutableCell(input.project_rows, 'D2').value = mutableCell(input.project_rows, 'C2').value),
    ],
    [
      'shifted-competence',
      (input) => (mutableCell(input.curve_rows, 'C7').date_iso = '2026-08-01'),
    ],
    [
      'formula-cache',
      (input) => (mutableCell(input.project_rows, 'C4').cached_result_present = false),
    ],
    [
      'unsupported-metric',
      (input) => (input.documentary.realized_system_effect = 'Métrica principal: receipt_actual.'),
    ],
    ['item-hint', (input) => (mutableCell(input.monthly_rows, 'C1').value = 'ITEM PREVISTO')],
  ];
  for (const [name, mutate] of mutations) {
    const input = gateInput();
    mutate(input);
    const result = evaluateP014RealizedSource(input);
    assert.equal(result.ok, false, name);
    assert.throws(() => assertP014RealizedSourceFingerprint(result), /P014_SOURCE_SEMANTIC/u);
  }
});

test('gate P014 distingue blank, zero e valor e detecta mutação sem alocação', () => {
  const baseline = evaluateP014RealizedSource(gateInput());
  assert.ok(baseline.semantic_fingerprint);

  const blankToZero = gateInput();
  const d12 = mutableCell(blankToZero.curve_rows, 'D12');
  Object.assign(d12, {
    state: 'value',
    data_type: 'number',
    value: 0,
    value_present: true,
    stub: false,
  });
  const curveMetadata = blankToZero.package_metadata.get('Curva S');
  assert.ok(curveMetadata);
  (curveMetadata.cells as Map<string, WorksheetPackageCellMetadata>).set('D12', {
    valueText: '0',
    formulaPresent: false,
    material: true,
  });
  const changed = evaluateP014RealizedSource(blankToZero);
  assert.notEqual(changed.semantic_fingerprint, baseline.semantic_fingerprint);

  const zeroToBlank = gateInput();
  const f4 = mutableCell(zeroToBlank.project_rows, 'F4');
  Object.assign(f4, { state: 'blank', data_type: 'blank', value: null, value_present: false });
  assert.equal(evaluateP014RealizedSource(zeroToBlank).ok, false);

  const amount = gateInput();
  const metadata = amount.package_metadata.get('Valores Projetos LTC-M');
  assert.ok(metadata);
  (metadata.cells as Map<string, WorksheetPackageCellMetadata>).set('E4', {
    valueText: '205447',
    formulaPresent: false,
    material: true,
  });
  assert.notEqual(
    evaluateP014RealizedSource(amount).semantic_fingerprint,
    baseline.semantic_fingerprint,
  );
});

test('fonte real P014 passa o fingerprint congelado, rerun e boundary de authority', async (context) => {
  const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url));
  const sourceDirectory = path.join(repositoryRoot, '.local-source');
  const sourceName = (await readdir(sourceDirectory).catch(() => [])).find((name) =>
    name.endsWith('.xlsx'),
  );
  if (sourceName === undefined) {
    context.skip('Fonte P014 local ignorada não está disponível.');
    return;
  }
  const sourcePath = path.join(sourceDirectory, sourceName);
  const before = await readFile(sourcePath);
  const first = await loadP014CertifiedRealizedSource(sourcePath);
  const second = await loadP014CertifiedRealizedSource(sourcePath);
  const after = await readFile(sourcePath);
  assert.deepEqual(after, before);
  assert.equal(
    first.source_sha256,
    'a52a31c08db01e7d04a29245c58496b86be09a5df9107c74e7c59db16cb5e8e5',
  );
  assert.equal(first.source_semantic_fingerprint, P014_D01_REALIZED_SOURCE_SEMANTIC_FINGERPRINT);
  assert.deepEqual(
    readP014CertifiedRealizedSourceFacts(first).positions,
    readP014CertifiedRealizedSourceFacts(second).positions,
  );
  assert.throws(
    () => readP014CertifiedRealizedSourceFacts({ ...first }),
    /P014_SOURCE_AUTHORITY_REQUIRED/u,
  );
});
