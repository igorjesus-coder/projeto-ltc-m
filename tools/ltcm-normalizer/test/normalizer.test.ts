import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeP011Artifacts } from '../src/artifact-writer.js';
import { canonicalJson, prettyCanonicalJson, sha256Canonical } from '../src/canonical-json.js';
import { parseArguments } from '../src/cli.js';
import {
  assertLegacyImportBatchReference,
  parseExistingSnapshot,
  plannedLegacyImportBatchReference,
} from '../src/contracts.js';
import {
  applyExistingSnapshot,
  clientMatchKey,
  normalizeClientName,
  normalizeP011,
} from '../src/normalizer.js';
import {
  executePreparedBatch,
  preparePersistenceBatch,
  type LtcmPersistencePort,
} from '../src/persistence.js';
import { assertSafeOutput, emptySnapshot, loadP010Source } from '../src/source-reader.js';
import {
  EXPECTED_PROJECT_CODES,
  P010_WORKBOOK_SHA256,
  type ExistingSnapshot,
  type P010Row,
  type RawCell,
  type SheetKey,
} from '../src/types.js';

const PROJECT_COLUMNS = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];

function rawCell(
  column: string,
  row: number,
  value: string | number | null,
  extra: Partial<RawCell> = {},
): RawCell {
  return {
    column_index: column.charCodeAt(0) - 64,
    column_letter: column,
    address: `${column}${row}`,
    value,
    formula: null,
    data_type: typeof value === 'number' ? 'number' : value === null ? 'blank' : 'string',
    number_format: typeof value === 'number' ? 'R$ #,##0.00' : 'General',
    state: value === null ? 'blank' : 'value',
    ...(typeof value === 'number' ? { round_trip_text: value.toString() } : {}),
    ...extra,
  };
}

function stagingRow(sheetKey: SheetKey, sheetName: string, row: number, cells: RawCell[]): P010Row {
  const end = sheetKey === 'monthly_revenue' ? 'T' : sheetKey === 'project_values' ? 'K' : 'L';
  const rawPayload = {
    schema_version: 1 as const,
    sheet_key: sheetKey,
    sheet_name: sheetName,
    row_number: row,
    source_range: `A${row}:${end}${row}`,
    cells,
  };
  return {
    payload_schema_version: 1,
    source_row_number: row,
    source_range: rawPayload.source_range,
    row_kind: cells.length === 0 ? 'blank' : 'unknown',
    row_hash: sha256Canonical(rawPayload),
    status: 'pending',
    validation_attempt: 0,
    raw_payload: rawPayload,
  };
}

function fixtureRows(): Map<SheetKey, P010Row[]> {
  const projectValues = Array.from({ length: 10 }, (_, index) =>
    stagingRow('project_values', 'Valores Projetos LTC-M', index + 1, []),
  );
  projectValues[1] = stagingRow(
    'project_values',
    'Valores Projetos LTC-M',
    2,
    EXPECTED_PROJECT_CODES.map((code, index) =>
      rawCell(
        PROJECT_COLUMNS[index] ?? 'C',
        2,
        `${index === 5 ? ' ' : ''}${code}-Cliente-${index + 1}`,
      ),
    ),
  );
  projectValues[2] = stagingRow(
    'project_values',
    'Valores Projetos LTC-M',
    3,
    EXPECTED_PROJECT_CODES.map((code, index) =>
      rawCell(PROJECT_COLUMNS[index] ?? 'C', 3, code === '2026-04-16531' ? 164000 : 1000 + index),
    ),
  );

  const rowAssignments = new Map<number, string>();
  for (let row = 4; row <= 43; row += 1) rowAssignments.set(row, '2024-10-12524');
  [
    [44, '2025-07-14416'],
    [45, '2024-02-10990'],
    [46, '2026-01-15797'],
    [47, '2025-12-15568'],
    [48, '2024-06-11837'],
    [49, '2025-08-14656'],
    [50, '2026-03-16231'],
    [51, '2026-04-16531'],
  ].forEach(([row, code]) => rowAssignments.set(row as number, code as string));
  const clientsByCode: Record<string, string> = {
    '2024-10-12524': 'Alpha',
    '2025-07-14416': 'Alpha',
    '2024-02-10990': 'Empresa UTE (saldo)',
    '2026-01-15797': 'Empresa Unidade A (demanda)',
    '2025-12-15568': 'Empresa Unidade B',
    '2024-06-11837': 'Empresa(Frota) (demanda)',
    '2025-08-14656': 'Beta',
    '2026-03-16231': 'Empresa (demanda)',
    '2026-04-16531': 'Empresa',
  };
  const monthly = Array.from({ length: 52 }, (_, index) =>
    stagingRow('monthly_revenue', 'Prev. Receita Mensal', index + 1, []),
  );
  monthly[2] = stagingRow('monthly_revenue', 'Prev. Receita Mensal', 3, [
    rawCell('B', 3, 'Projeto LTC-M'),
    rawCell('C', 3, 'Cliente'),
    rawCell('H', 3, 'Moeda'),
  ]);
  for (const [row, code] of rowAssignments) {
    monthly[row - 1] = stagingRow('monthly_revenue', 'Prev. Receita Mensal', row, [
      rawCell('B', row, `${row === 48 ? ' ' : ''}${code}`),
      rawCell('C', row, clientsByCode[code] ?? 'Cliente'),
      rawCell('H', row, 'BRL'),
      rawCell('J', row, row === 45 ? 369749.1735 : row === 51 ? 164000 : 0),
    ]);
  }
  const curve = Array.from({ length: 16 }, (_, index) =>
    stagingRow('curve_s', 'Curva S', index + 1, []),
  );
  return new Map<SheetKey, P010Row[]>([
    ['project_values', projectValues],
    ['monthly_revenue', monthly],
    ['curve_s', curve],
  ]);
}

async function writeFixture(
  root: string,
  mutate?: (manifest: Record<string, unknown>) => void,
): Promise<void> {
  const rows = fixtureRows();
  await mkdir(path.join(root, 'sheets'), { recursive: true });
  const definitions = [...rows].map(([key, values], index) => ({
    sheet_key: key,
    sheet_name:
      key === 'project_values'
        ? 'Valores Projetos LTC-M'
        : key === 'monthly_revenue'
          ? 'Prev. Receita Mensal'
          : 'Curva S',
    workbook_index: index,
    visibility: 'visible',
    detected_range:
      key === 'project_values' ? 'A1:K10' : key === 'monthly_revenue' ? 'A1:T52' : 'A1:L16',
    worksheet_range:
      key === 'project_values' ? 'A1:K10' : key === 'monthly_revenue' ? 'A1:T52' : 'A1:L16',
    source_row_count: values.length,
    staged_row_count: values.length,
    rejected_row_count: 0,
    content_hash: sha256Canonical(values.map((row) => row.raw_payload)),
    artifact: `sheets/${key}.jsonl`,
    status: 'completed',
  }));
  const manifest: Record<string, unknown> = {
    artifact_contract: 'ltcm.p010.extraction-manifest.v1',
    payload_schema_version: 1,
    source: { source_hash: P010_WORKBOOK_SHA256 },
    workbook: {
      sheet_names: [
        'Valores Projetos LTC-M',
        'Prev. Receita Mensal',
        'Curva S',
        'Decisões Aprovadas',
      ],
      ignored_sheet_names: ['Decisões Aprovadas'],
      date_system: '1900',
    },
    extraction: {
      error_count: 0,
      warning_count: 1,
      operational_sheet_count: 3,
      staged_row_count: 78,
      status: 'passed_with_warnings',
      strict: true,
    },
    sheets: definitions,
  };
  mutate?.(manifest);
  await writeFile(path.join(root, 'manifest.json'), prettyCanonicalJson(manifest));
  await writeFile(
    path.join(root, 'validation-report.json'),
    prettyCanonicalJson({
      report_contract: 'ltcm.p010.validation-report.v1',
      error_count: 0,
      warning_count: 1,
      entries: [{ error_code: 'RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE' }],
    }),
  );
  await writeFile(
    path.join(root, 'profile-report.json'),
    prettyCanonicalJson({
      report_contract: 'ltcm.p010.profile-report.v1',
      profile_detected: true,
      projects: { count: 9, codes: [...EXPECTED_PROJECT_CODES] },
    }),
  );
  for (const [key, values] of rows) {
    await writeFile(
      path.join(root, 'sheets', `${key}.jsonl`),
      `${values.map(canonicalJson).join('\n')}\n`,
    );
  }
}

async function withFixture<T>(work: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ltcm-p011-test-'));
  try {
    await writeFixture(root);
    return await work(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('normalização estrita preserva regras de nomes e chave determinística', () => {
  assert.equal(normalizeClientName('  A\u0301cme   S.A.  '), 'Ácme S.A.');
  assert.equal(clientMatchKey('  ÁCME   S.A. '), clientMatchKey('Ácme S.A.'));
  assert.notEqual(clientMatchKey('Acme S.A.'), clientMatchKey('Ácme S.A.'));
  assert.notEqual(clientMatchKey('Ácme, S.A.'), clientMatchKey('Ácme S.A.'));
  assert.notEqual(clientMatchKey('Ácme Ltda.'), clientMatchKey('Ácme S.A.'));
});

test('fonte sintética v1 gera nove projetos, D02/D03/D04 e fronteira P012', async () => {
  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const result = normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z');
    assert.equal(result.projects.length, 9);
    assert.equal(new Set(result.projects.map((project) => project.project_code)).size, 9);
    assert.equal(
      result.projects.find((project) => project.project_code === '2026-04-16531')?.contract_value,
      '164000',
    );
    assert.ok(result.projects.some((project) => project.raw_codes.includes(' 2024-06-11837')));
    assert.ok(
      result.divergences.some(
        (entry) => entry.code === 'RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE',
      ),
    );
    assert.equal(result.validationSummary['item_outputs'], 0);
    assert.equal(result.validationSummary['competency_operations'], 0);
    assert.equal(result.validationSummary['curve_s_operations'], 0);
    assert.equal(result.validationSummary['p012_executed'], false);
    assert.equal(result.validationSummary['d05_contract_total_mapped'], true);
    assert.equal(result.validationSummary['d06_classification_mapped'], true);
    assert.equal(result.validationSummary['d38_legacy_lineage_planned'], true);
    assert.equal(result.validationSummary['d39_official_name_mapped'], true);
    assert.ok(
      result.projects.every(
        (project) =>
          project.data_reference_date === null &&
          project.legacy_import_batch_reference?.kind === 'planned',
      ),
    );
    assert.equal(
      result.projects.find((project) => project.project_code === '2024-02-10990')?.classification,
      'opening_balance',
    );
    assert.equal(
      result.projects.find((project) => project.project_code === '2026-01-15797')?.classification,
      'demand',
    );
    assert.equal(
      result.projects.find((project) => project.project_code === '2025-12-15568')?.classification,
      'full_contract',
    );
    assert.ok(result.clients.some((client) => client.status === 'ambiguous'));
  });
});

test('mesma fonte produz exatamente os mesmos objetos e hashes', async () => {
  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const first = normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z');
    const second = normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z');
    assert.equal(canonicalJson(first), canonicalJson(second));
  });
});

test('D02 rejeita 168000 e moeda/cliente ausentes rejeitam somente o dependente', async () => {
  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const projectRows = source.rows.get('project_values') ?? [];
    const value = projectRows[2]?.raw_payload.cells.find((candidate) => candidate.address === 'K3');
    assert.ok(value);
    value.value = 168000;
    value.round_trip_text = '168000';
    const monthlyRows = source.rows.get('monthly_revenue') ?? [];
    const betaRow = monthlyRows[48];
    assert.ok(betaRow);
    const currency = betaRow.raw_payload.cells.find((candidate) => candidate.address === 'H49');
    const client = betaRow.raw_payload.cells.find((candidate) => candidate.address === 'C49');
    assert.ok(currency && client);
    currency.value = null;
    client.value = null;
    const result = normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z');
    const d02 = result.projects.find((candidate) => candidate.project_code === '2026-04-16531');
    const dependent = result.projects.find(
      (candidate) => candidate.project_code === '2025-08-14656',
    );
    assert.equal(d02?.contract_value, null);
    assert.ok(d02?.diagnostic_codes.includes('PROJECT_VALUE_CONFLICT'));
    assert.equal(dependent?.action, 'rejected');
    assert.ok(dependent?.diagnostic_codes.includes('PROJECT_CURRENCY_MISSING'));
    assert.ok(dependent?.diagnostic_codes.includes('PROJECT_CLIENT_UNRESOLVED'));
    assert.equal(
      result.projects.find((candidate) => candidate.project_code === '2024-10-12524')?.action,
      'pending_decision',
    );
  });
});

test('snapshot classifica cliente existente e projeto idêntico/conflitante', async () => {
  await withFixture(async (root) => {
    const result = normalizeP011(
      await loadP010Source(root),
      emptySnapshot(),
      '1970-01-01T00:00:00.000Z',
    );
    const client = result.clients.find(
      (candidate) => candidate.match_key === clientMatchKey('Alpha'),
    );
    const project = result.projects.find((candidate) => candidate.project_code === '2024-10-12524');
    assert.ok(client && project);
    project.project_name_mapping_status = 'mapped';
    project.project_name_proposal = 'Projeto sintético';
    project.classification = 'full_contract';
    project.operational_status = 'active';
    project.contract_value = '1000';
    project.data_reference_date = '2026-07-21';
    project.action = 'insert';
    const snapshot: ExistingSnapshot = {
      contract: 'ltcm.p011.existing-snapshot.v2',
      currencies: [{ code: 'BRL', active: true }],
      clients: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          legal_name: 'Alpha',
          display_name: 'Alpha',
          tax_id: null,
          active: true,
          deleted_at: null,
          row_version: 1,
        },
      ],
      projects: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          project_code: project.project_code,
          project_name: 'Projeto sintético',
          client_id: '00000000-0000-4000-8000-000000000001',
          classification: 'full_contract',
          status: 'active',
          base_currency: 'BRL',
          contract_value: '1000',
          data_reference_date: '2026-07-21',
          legacy_import_batch_id: null,
          deleted_at: null,
          version: 1,
        },
      ],
    };
    applyExistingSnapshot(result.clients, result.projects, snapshot);
    assert.equal(client.action, 'no_op');
    assert.equal(project.action, 'no_op');
    project.contract_value = '1001';
    project.action = 'insert';
    applyExistingSnapshot(result.clients, result.projects, snapshot);
    assert.equal(project.action, 'conflict');
    assert.ok(project.diagnostic_codes.includes('PROTECTED_RECORD_CONFLICT'));
  });
});

test('leitor rejeita hash, contrato, JSONL corrompido e matriz de abas inválidos', async (context) => {
  await context.test('hash do workbook', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ltcm-p011-hash-'));
    try {
      await writeFixture(root, (manifest) => {
        (manifest['source'] as Record<string, unknown>)['source_hash'] = '0'.repeat(64);
      });
      await assert.rejects(loadP010Source(root), /P010_INPUT_HASH_MISMATCH/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  await context.test('contrato P009/P010', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ltcm-p011-contract-'));
    try {
      await writeFixture(root, (manifest) => {
        manifest['payload_schema_version'] = 2;
      });
      await assert.rejects(loadP010Source(root), /P009_CONTRACT_MISMATCH/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  await context.test('JSONL corrompido', async () => {
    await withFixture(async (root) => {
      await writeFile(path.join(root, 'sheets', 'curve_s.jsonl'), '{');
      await assert.rejects(loadP010Source(root), /JSON corrompido/u);
    });
  });
  await context.test('aba operacional ausente/documental em staging', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ltcm-p011-sheets-'));
    try {
      await writeFixture(root, (manifest) => {
        const sheets = manifest['sheets'] as Array<Record<string, unknown>>;
        sheets.pop();
      });
      await assert.rejects(loadP010Source(root), /Aba operacional ausente/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('--apply permanece bloqueado e ajuda não exige caminhos', () => {
  assert.throws(() => parseArguments(['--apply']), /REMOTE_APPLY_NOT_AUTHORIZED/u);
  assert.equal(parseArguments(['--help']), 'help');
  assert.throws(
    () => parseArguments(['--input-dir', 'a', '--output-dir', 'b', '--generated-at', 'agora']),
    /ISO UTC/u,
  );
});

test('saída exige subdiretório gerenciado sob .artifacts e rejeita traversal', async () => {
  const input = path.resolve('.artifacts', 'p010-fixture');
  await assert.rejects(assertSafeOutput(path.resolve('fora'), input), /dentro de \.artifacts/u);
  await assert.rejects(
    assertSafeOutput(path.resolve('.artifacts'), input),
    /não pode ser sua raiz/u,
  );
  await assert.rejects(
    assertSafeOutput(path.resolve('.artifacts', 'p010-fixture', 'p011'), input),
    /não pode estar dentro da entrada/u,
  );
});

test('contratos v2 validam snapshot e referência de lote sem inferir data artificial', () => {
  const batchId = '00000000-0000-4000-8000-000000000010';
  const project = {
    id: '00000000-0000-4000-8000-000000000002',
    project_code: 'SYNTHETIC-001',
    project_name: 'Projeto sintético',
    client_id: '00000000-0000-4000-8000-000000000001',
    classification: 'full_contract' as const,
    status: 'active' as const,
    base_currency: 'BRL',
    contract_value: '1000',
    deleted_at: null,
    version: 1,
  };
  const v1 = parseExistingSnapshot({
    contract: 'ltcm.p011.existing-snapshot.v1',
    currencies: [],
    clients: [],
    projects: [{ ...project, data_reference_date: '2026-07-21' }],
  });
  assert.equal(v1.contract, 'ltcm.p011.existing-snapshot.v2');
  assert.equal(v1.projects[0]?.legacy_import_batch_id, null);
  const v2 = parseExistingSnapshot({
    contract: 'ltcm.p011.existing-snapshot.v2',
    currencies: [],
    clients: [],
    projects: [{ ...project, data_reference_date: null, legacy_import_batch_id: batchId }],
  });
  assert.equal(v2.projects[0]?.legacy_import_batch_id, batchId);
  assert.throws(
    () =>
      parseExistingSnapshot({
        contract: 'ltcm.p011.existing-snapshot.v2',
        currencies: [],
        clients: [],
        projects: [{ ...project, data_reference_date: null, legacy_import_batch_id: null }],
      }),
    /linhagem obrigatória/u,
  );
  assert.throws(
    () =>
      parseExistingSnapshot({
        contract: 'ltcm.p011.existing-snapshot.v1',
        currencies: [],
        clients: [],
        projects: [{ ...project, data_reference_date: null }],
      }),
    /Snapshot v1/u,
  );
  assert.throws(
    () => assertLegacyImportBatchReference({ kind: 'existing', import_batch_id: 'invalid' }),
    /UUID inválido/u,
  );
  const planned = plannedLegacyImportBatchReference('a'.repeat(64), 'b'.repeat(64));
  assert.deepEqual(planned, plannedLegacyImportBatchReference('a'.repeat(64), 'b'.repeat(64)));
  assert.throws(
    () => assertLegacyImportBatchReference({ ...planned, planned_key: '' }),
    /chave determinística/u,
  );
});

test('fronteira de persistência resolve lote antes de clientes e projetos na mesma transação', async () => {
  await withFixture(async (root) => {
    const normalized = normalizeP011(
      await loadP010Source(root),
      emptySnapshot(),
      '1970-01-01T00:00:00.000Z',
    );
    const client = normalized.clients.find((candidate) => candidate.status === 'valid');
    const project = normalized.projects.find(
      (candidate) => candidate.client_candidate_id === client?.candidate_id,
    );
    assert.ok(client && project);
    project.action = 'insert';
    project.project_name_mapping_status = 'mapped';
    project.classification = 'full_contract';
    project.operational_status = 'active';
    project.contract_value = '1000';
    project.data_reference_date = null;
    const batch = preparePersistenceBatch(normalized.clients, normalized.projects);
    assert.equal(batch.isolation, 'serializable');
    assert.equal(batch.physicalDeletes, false);
    assert.equal(batch.bypassRls, false);
    assert.equal(batch.importBatches.length, 1);
    const calls: string[] = [];
    const batchId = '00000000-0000-4000-8000-000000000010';
    const port: LtcmPersistencePort = {
      async serializableTransaction(work) {
        calls.push('transaction');
        return work({
          async insertImportBatch(input) {
            calls.push(`batch:${input.plannedKey}`);
            return { candidateId: input.plannedKey, outcome: 'inserted', targetId: batchId };
          },
          async insertClient(input) {
            calls.push(`client:${input.candidateId}`);
            return { candidateId: input.candidateId, outcome: 'inserted', targetId: 'client-id' };
          },
          async insertProject(input, resolvedClientId, resolvedLegacyImportBatchId) {
            calls.push(
              `project:${input.candidateId}:${resolvedClientId}:${resolvedLegacyImportBatchId}`,
            );
            return { candidateId: input.candidateId, outcome: 'inserted', targetId: 'project-id' };
          },
        });
      },
    };
    const results = await executePreparedBatch(port, batch);
    assert.equal(calls[0], 'transaction');
    assert.ok(
      calls.findIndex((call) => call.startsWith('batch:')) <
        calls.findIndex((call) => call.startsWith('client:')) &&
        calls.findIndex((call) => call.startsWith('client:')) <
          calls.findIndex((call) => call.startsWith('project:')),
    );
    assert.ok(calls.some((call) => call.endsWith(`:${batchId}`)));
    assert.equal(results.at(-1)?.outcome, 'inserted');
  });
});

test('persistência aceita data conhecida sem lote e rejeita data nula sem linhagem', async () => {
  await withFixture(async (root) => {
    const normalized = normalizeP011(
      await loadP010Source(root),
      emptySnapshot(),
      '1970-01-01T00:00:00.000Z',
    );
    const client = normalized.clients.find((candidate) => candidate.status === 'valid');
    const project = normalized.projects.find(
      (candidate) => candidate.client_candidate_id === client?.candidate_id,
    );
    assert.ok(client && project);
    project.action = 'insert';
    project.project_name_mapping_status = 'mapped';
    project.classification = 'full_contract';
    project.operational_status = 'active';
    project.contract_value = '1000';
    project.data_reference_date = '2026-07-21';
    project.legacy_import_batch_reference = null;
    assert.equal(
      preparePersistenceBatch(normalized.clients, normalized.projects).importBatches.length,
      0,
    );
    project.data_reference_date = null;
    assert.throws(
      () => preparePersistenceBatch(normalized.clients, normalized.projects),
      /Projeto não resolvido/u,
    );
    project.legacy_import_batch_reference = {
      kind: 'existing',
      import_batch_id: '00000000-0000-4000-8000-000000000010',
    };
    assert.equal(
      preparePersistenceBatch(normalized.clients, normalized.projects).importBatches.length,
      0,
    );
    project.legacy_import_batch_reference = { kind: 'existing', import_batch_id: 'invalid' };
    assert.throws(
      () => preparePersistenceBatch(normalized.clients, normalized.projects),
      /UUID inválido/u,
    );
    project.matched_legacy_import_batch_id = '00000000-0000-4000-8000-000000000010';
    project.legacy_import_batch_reference = null;
    project.data_reference_date = '2026-07-21';
    assert.throws(
      () => preparePersistenceBatch(normalized.clients, normalized.projects),
      /remover linhagem/u,
    );
  });
});

test('writer gerenciado produz bytes idênticos A/B e recusa diretório não gerenciado', async () => {
  await withFixture(async (root) => {
    const artifacts = normalizeP011(
      await loadP010Source(root),
      emptySnapshot(),
      '1970-01-01T00:00:00.000Z',
    );
    const parent = await mkdtemp(path.join(os.tmpdir(), 'ltcm-p011-write-'));
    try {
      const first = path.join(parent, 'a');
      const second = path.join(parent, 'b');
      await writeP011Artifacts(first, structuredClone(artifacts));
      await writeP011Artifacts(second, structuredClone(artifacts));
      const namesA = (await readdir(first)).sort();
      const namesB = (await readdir(second)).sort();
      assert.deepEqual(namesA, namesB);
      for (const name of namesA) {
        assert.deepEqual(
          await readFile(path.join(first, name)),
          await readFile(path.join(second, name)),
        );
      }
      const unmanaged = path.join(parent, 'unmanaged');
      await mkdir(unmanaged);
      await writeFile(path.join(unmanaged, 'keep.txt'), 'preservar');
      await assert.rejects(writeP011Artifacts(unmanaged, artifacts), /não é gerenciado/u);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
