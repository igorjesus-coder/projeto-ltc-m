import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeP011Artifacts } from '../src/artifact-writer.js';
import { canonicalJson, prettyCanonicalJson, sha256Canonical } from '../src/canonical-json.js';
import { parseArguments } from '../src/cli.js';
import {
  assertLegacyImportBatchReference,
  createClientCandidateId,
  createProjectCandidateId,
  parseExistingSnapshot,
  parseReviewedResolutionDocument,
  plannedLegacyImportBatchReference,
} from '../src/contracts.js';
import {
  assertItemCandidateId,
  assertSourceLineKey,
  createItemCandidateId,
  createSourceLineKey,
  deriveTotalAmount,
  emptyP012ExistingItemsSnapshot,
  normalizeOptionalItemText,
  normalizeUnit,
  parseCanonicalCurrency,
  parseP012ExistingItemsSnapshot,
  parseSourceItemNumber,
  parseQuantity,
  parseUnitPrice,
} from '../src/item-contracts.js';
import { createValidatedP012CandidateView, normalizeP012Items } from '../src/item-normalizer.js';
import {
  applyExistingSnapshot,
  clientMatchKey,
  normalizeClientName,
  normalizeP011,
} from '../src/normalizer.js';
import {
  applyReviewedResolutions,
  createReviewBinding,
  createSnapshotHash,
  matchProjectLineage,
  parseValidatedCandidateSet,
} from '../src/reviewed-resolutions.js';
import {
  executePreparedBatch,
  preparePersistenceBatch,
  type LtcmPersistencePort,
} from '../src/persistence.js';
import {
  assertSafeOutput,
  createValidatedSourceView,
  emptySnapshot,
  loadP010Source,
  loadReviewedResolutions,
} from '../src/source-reader.js';
import {
  EXPECTED_PROJECT_CODES,
  NORMALIZER_VERSION,
  P010_WORKBOOK_SHA256,
  type ClientCandidate,
  type ExistingSnapshot,
  type ItemCandidate,
  type MappingEvidence,
  type P012ExistingItemsSnapshot,
  type P012ItemCandidateSet,
  type P010Row,
  type ProjectCandidate,
  type RawCell,
  type ReviewBinding,
  type ReviewedResolution,
  type ReviewedResolutionDocument,
  type SheetKey,
} from '../src/types.js';

const PROJECT_COLUMNS = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
const SYNTHETIC_CLIENT_CANDIDATE_ID = createClientCandidateId('cliente sintético');
const SYNTHETIC_PROJECT_CANDIDATE_ID = createProjectCandidateId('SYNTHETIC-001');
const ALTERNATE_PROJECT_CANDIDATE_ID = createProjectCandidateId('SYNTHETIC-002');

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
    rawCell('A', 3, 'Item'),
    rawCell('B', 3, 'Projeto LTC-M'),
    rawCell('C', 3, 'Cliente'),
    rawCell('D', 3, 'Código'),
    rawCell('E', 3, 'Descrição'),
    rawCell('F', 3, 'Quantidade'),
    rawCell('G', 3, 'Unidade'),
    rawCell('H', 3, 'Moeda'),
    rawCell('I', 3, 'Preço unitário'),
    rawCell('J', 3, 'Total'),
  ]);
  for (const [row, code] of rowAssignments) {
    const sourceItemNumber = row - 3;
    const unit = ['UN', 'Serviço', 'Unidade e Serviço'][sourceItemNumber % 3] ?? 'UN';
    const unitPrice = row === 51 ? 164000 : 0;
    monthly[row - 1] = stagingRow('monthly_revenue', 'Prev. Receita Mensal', row, [
      rawCell('A', row, sourceItemNumber),
      rawCell('B', row, `${row === 48 ? ' ' : ''}${code}`),
      rawCell('C', row, clientsByCode[code] ?? 'Cliente'),
      rawCell('D', row, row === 48 ? null : `ITEM-${sourceItemNumber % 5}`),
      rawCell('E', row, row === 48 ? null : `Item sintético ${sourceItemNumber}`),
      rawCell('F', row, 1),
      rawCell('G', row, unit),
      rawCell('H', row, 'BRL'),
      rawCell('I', row, unitPrice),
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
  mutateRows?: (rows: Map<SheetKey, P010Row[]>) => void,
): Promise<void> {
  const rows = fixtureRows();
  mutateRows?.(rows);
  for (const sheetRows of rows.values()) {
    for (const row of sheetRows) row.row_hash = sha256Canonical(row.raw_payload);
  }
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

async function withFixture<T>(
  work: (root: string) => Promise<T>,
  mutateRows?: (rows: Map<SheetKey, P010Row[]>) => void,
): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ltcm-p011-test-'));
  try {
    await writeFixture(root, undefined, mutateRows);
    return await work(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function reviewedDocument(
  artifacts: ReturnType<typeof normalizeP011>,
  resolutions: ReviewedResolution[],
): ReviewedResolutionDocument {
  const binding = artifacts.manifest['review_binding'] as Record<string, string>;
  return {
    contract: 'ltcm.p011.reviewed-resolutions.v1',
    normalizer_version: binding['normalizer_version'] ?? '',
    normalization_manifest_hash: binding['normalization_manifest_hash'] ?? '',
    p010_manifest_hash: binding['p010_manifest_hash'] ?? '',
    input_hash: binding['input_hash'] ?? '',
    snapshot_hash: binding['snapshot_hash'] ?? '',
    candidate_set_hash: binding['candidate_set_hash'] ?? '',
    resolutions,
  };
}

function syntheticOrigin(row = 1): ProjectCandidate['origins'][number] {
  return {
    sheet_key: 'project_values',
    sheet_name: 'Fixture sintética',
    source_row_number: row,
    source_range: `A${row}:K${row}`,
    cell_address: `A${row}`,
    row_hash: 'd'.repeat(64),
    workbook_hash: 'b'.repeat(64),
  };
}

function lineageProject(overrides: Partial<ProjectCandidate> = {}): ProjectCandidate {
  const base: ProjectCandidate = {
    candidate_id: SYNTHETIC_PROJECT_CANDIDATE_ID,
    raw_codes: ['SYNTHETIC-001'],
    project_code: 'SYNTHETIC-001',
    raw_project_label: 'Projeto sintetico valido',
    project_name_proposal: 'Projeto sintetico valido',
    project_name_mapping_status: 'mapped',
    client_match_key: 'cliente sintetico valido',
    client_candidate_id: SYNTHETIC_CLIENT_CANDIDATE_ID,
    client_id: '00000000-0000-4000-8000-000000000086',
    currency: 'BRL',
    raw_classifications: ['Contrato integral'],
    classification: 'full_contract',
    operational_status: 'active',
    contract_value: '1000',
    data_reference_date: null,
    legacy_import_batch_reference: null,
    matched_legacy_import_batch_id: null,
    value_evidence: [],
    receipt_forecast_evidence: [],
    action: 'insert',
    origins: [syntheticOrigin()],
    diagnostic_codes: [],
    source_manifest_hash: 'a'.repeat(64),
    hash: '0'.repeat(64),
  };
  const candidate = { ...base, ...overrides };
  if (overrides.value_evidence === undefined && candidate.contract_value !== null) {
    candidate.value_evidence = [
      {
        raw_number: Number(candidate.contract_value),
        decimal_round_trip_string: candidate.contract_value,
        formatted_text: candidate.contract_value,
        number_format: '0.00',
        coordinate: 'B1',
        row_hash: 'd'.repeat(64),
        mapping_status: 'mapped',
        target_field: 'projects.contract_value',
      },
    ];
  }
  return { ...candidate, hash: sha256Canonical({ ...candidate, hash: undefined }) };
}

function integrityClient(overrides: Partial<ClientCandidate> = {}): ClientCandidate {
  const base: ClientCandidate = {
    candidate_id: SYNTHETIC_CLIENT_CANDIDATE_ID,
    client_ref: 'client-synthetic',
    raw_names: ['Cliente sintético'],
    normalized_name: 'Cliente sintético',
    match_key: 'cliente sintético',
    status: 'ambiguous',
    action: 'conflict',
    matched_client_id: null,
    possible_matches: ['client-other'],
    origins: [syntheticOrigin()],
    diagnostic_codes: ['CLIENT_MATCH_AMBIGUOUS'],
    source_manifest_hash: 'a'.repeat(64),
    hash: '0'.repeat(64),
  };
  const candidate = { ...base, ...overrides };
  return { ...candidate, hash: sha256Canonical({ ...candidate, hash: undefined }) };
}

function fabricatedBinding(
  snapshot: ExistingSnapshot,
  clients: ClientCandidate[],
  projects: ProjectCandidate[],
  p010ManifestHash = 'a'.repeat(64),
  inputHash = 'b'.repeat(64),
): ReviewBinding {
  const candidateSetHash = sha256Canonical({
    clients: clients
      .map((candidate) => ({
        candidate_id: candidate.candidate_id,
        candidate_hash: candidate.hash,
      }))
      .sort((left, right) => left.candidate_id.localeCompare(right.candidate_id, 'en')),
    projects: projects
      .map((candidate) => ({
        candidate_id: candidate.candidate_id,
        candidate_hash: candidate.hash,
      }))
      .sort((left, right) => left.candidate_id.localeCompare(right.candidate_id, 'en')),
  });
  const snapshotHash = createSnapshotHash(snapshot);
  return {
    contract: 'ltcm.p011.review-binding.v1',
    normalizer_version: NORMALIZER_VERSION,
    normalization_manifest_hash: sha256Canonical({
      artifact_contract: 'ltcm.p011.normalization-manifest.v2',
      normalizer_version: NORMALIZER_VERSION,
      p010_manifest_hash: p010ManifestHash,
      input_hash: inputHash,
      snapshot_hash: snapshotHash,
      candidate_set_hash: candidateSetHash,
    }),
    p010_manifest_hash: p010ManifestHash,
    input_hash: inputHash,
    snapshot_hash: snapshotHash,
    candidate_set_hash: candidateSetHash,
  };
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

test('D88 fecha project/target arbitrarios e planned forjado no matcher publico', () => {
  const batchId = '00000000-0000-4000-8000-000000000088';
  const idempotencyKey = `ltcm-p011:${'a'.repeat(64)}`;
  const sourceHash = 'b'.repeat(64);
  const target: ExistingSnapshot['projects'][number] = {
    id: '00000000-0000-4000-8000-000000000089',
    project_code: 'SYNTHETIC-001',
    project_name: 'Projeto sintetico valido',
    client_id: '00000000-0000-4000-8000-000000000086',
    classification: 'full_contract',
    status: 'active',
    base_currency: 'BRL',
    contract_value: '1000',
    data_reference_date: null,
    legacy_import_batch_id: batchId,
    deleted_at: null,
    version: 1,
  };
  const snapshot: ExistingSnapshot = {
    contract: 'ltcm.p011.existing-snapshot.v3',
    currencies: [{ code: 'BRL', active: true }],
    clients: [],
    import_batches: [{ id: batchId, idempotency_key: idempotencyKey, source_hash: sourceHash }],
    projects: [target],
  };
  const plannedProject = lineageProject({
    legacy_import_batch_reference: {
      kind: 'planned',
      planned_key: 'p011-batch-synthetic',
      idempotency_key: idempotencyKey,
      source_manifest_hash: 'a'.repeat(64),
      source_hash: sourceHash,
    },
  });

  const validResult = matchProjectLineage(plannedProject, target, snapshot);
  assert.equal(validResult.equivalent, true);
  assert.deepEqual(validResult.resolvedReference, { kind: 'existing', import_batch_id: batchId });
  assert.throws(
    () => matchProjectLineage({} as ProjectCandidate, target, snapshot),
    /project-lineage\.project/u,
  );
  assert.throws(
    () => matchProjectLineage(plannedProject, {} as ExistingSnapshot['projects'][number], snapshot),
    /project-lineage\.target/u,
  );
  assert.throws(
    () =>
      matchProjectLineage(
        plannedProject,
        { ...target, extra: true } as unknown as ExistingSnapshot['projects'][number],
        snapshot,
      ),
    /project-lineage\.target/u,
  );
  assert.throws(
    () => matchProjectLineage(lineageProject({ client_id: 'invalid' }), target, snapshot),
    /UUID/u,
  );
  assert.throws(
    () =>
      matchProjectLineage(
        { ...lineageProject(), extra: true } as unknown as ProjectCandidate,
        target,
        snapshot,
      ),
    /campos não autorizados=extra/u,
  );
  assert.throws(
    () =>
      matchProjectLineage(
        lineageProject({ operational_status: 'invalid' as ProjectCandidate['operational_status'] }),
        target,
        snapshot,
      ),
    /operational_status/u,
  );
  assert.throws(
    () =>
      matchProjectLineage(
        lineageProject({
          legacy_import_batch_reference: {
            kind: 'existing',
            import_batch_id: 'invalid',
          },
        }),
        target,
        snapshot,
      ),
    /UUID/u,
  );
  assert.throws(
    () =>
      matchProjectLineage(
        plannedProject,
        { ...target, legacy_import_batch_id: 'invalid' },
        snapshot,
      ),
    /project-lineage\.target/u,
  );
  assert.throws(
    () =>
      matchProjectLineage(
        lineageProject({
          legacy_import_batch_reference: {
            kind: 'planned',
            idempotency_key: idempotencyKey,
            source_hash: sourceHash,
          } as ProjectCandidate['legacy_import_batch_reference'],
        }),
        target,
        snapshot,
      ),
    /campos ausentes/u,
  );
  assert.throws(
    () => matchProjectLineage(plannedProject, target, { ...snapshot, projects: [] }),
    /project-lineage\.target/u,
  );
});

test('D88 ancora binding e documento no contrato nominal e na versao real do runtime', () => {
  const snapshot = emptySnapshot();
  const binding = fabricatedBinding(snapshot, [], []);
  const document: ReviewedResolutionDocument = {
    contract: 'ltcm.p011.reviewed-resolutions.v1',
    normalizer_version: NORMALIZER_VERSION,
    normalization_manifest_hash: binding.normalization_manifest_hash,
    p010_manifest_hash: binding.p010_manifest_hash,
    input_hash: binding.input_hash,
    snapshot_hash: binding.snapshot_hash,
    candidate_set_hash: binding.candidate_set_hash,
    resolutions: [],
  };
  assert.equal(binding.contract, 'ltcm.p011.review-binding.v1');
  assert.equal(binding.normalizer_version, NORMALIZER_VERSION);
  assert.throws(
    () => applyReviewedResolutions(document, binding, snapshot, [], [], []),
    /P011_SOURCE_PROVENANCE_REQUIRED/u,
  );
  assert.throws(
    () => createReviewBinding(NORMALIZER_VERSION, 'a'.repeat(64), 'b'.repeat(64), snapshot, [], []),
    /P011_SOURCE_PROVENANCE_REQUIRED/u,
  );
  assert.throws(
    () => createReviewBinding('9.9.9', 'a'.repeat(64), 'b'.repeat(64), snapshot, [], []),
    /RUNTIME_VERSION_MISMATCH/u,
  );

  const invalidContractBinding = {
    ...binding,
    contract: 'invalid.binding.v9',
  } as unknown as ReviewBinding;
  const clients: ClientCandidate[] = [];
  const projects: ProjectCandidate[] = [];
  const mappings: MappingEvidence[] = [];
  const before = canonicalJson({ clients, projects, mappings });
  let summaryCreated = false;
  assert.throws(() => {
    const result = applyReviewedResolutions(
      document,
      invalidContractBinding,
      snapshot,
      clients,
      projects,
      mappings,
    );
    summaryCreated = result.summary !== undefined;
  }, /BINDING_CONTRACT_MISMATCH/u);
  assert.equal(summaryCreated, false);
  assert.equal(canonicalJson({ clients, projects, mappings }), before);
  assert.throws(
    () =>
      applyReviewedResolutions(
        document,
        invalidContractBinding,
        { ...snapshot, extra: true } as unknown as ExistingSnapshot,
        clients,
        projects,
        mappings,
      ),
    /BINDING_CONTRACT_MISMATCH/u,
  );

  const binding99 = {
    ...binding,
    normalizer_version: '9.9.9',
    normalization_manifest_hash: sha256Canonical({
      artifact_contract: 'ltcm.p011.normalization-manifest.v2',
      normalizer_version: '9.9.9',
      p010_manifest_hash: binding.p010_manifest_hash,
      input_hash: binding.input_hash,
      snapshot_hash: binding.snapshot_hash,
      candidate_set_hash: binding.candidate_set_hash,
    }),
  } as ReviewBinding;
  const document99 = {
    ...document,
    normalizer_version: '9.9.9',
    normalization_manifest_hash: binding99.normalization_manifest_hash,
  };
  assert.throws(
    () => applyReviewedResolutions(document99, binding99, snapshot, [], [], []),
    /RUNTIME_VERSION_MISMATCH/u,
  );
  assert.throws(
    () => applyReviewedResolutions(document, binding99, snapshot, [], [], []),
    /RUNTIME_VERSION_MISMATCH/u,
  );
  assert.throws(
    () => applyReviewedResolutions(document99, binding, snapshot, [], [], []),
    /normalizer_version/u,
  );
  assert.throws(() => parseReviewedResolutionDocument(document99), /normalizer_version/u);
});

test('D90 valida candidatos, recalcula hashes e rejeita o bypass D89 atomicamente', async () => {
  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const snapshot = emptySnapshot();
    const base = normalizeP011(source, snapshot, '1970-01-01T00:00:00.000Z');
    const binding = base.manifest['review_binding'] as ReviewBinding;
    const document = reviewedDocument(base, []);
    const client = base.clients.find((candidate) => candidate.status === 'ambiguous');
    const project = base.projects.find((candidate) => candidate.project_code === '2025-08-14656');
    assert.ok(client && project);

    assert.throws(
      () =>
        createReviewBinding(
          NORMALIZER_VERSION,
          binding.p010_manifest_hash,
          binding.input_hash,
          snapshot,
          base.clients,
          base.projects,
        ),
      /P011_SOURCE_PROVENANCE_REQUIRED/u,
    );
    assert.throws(
      () =>
        applyReviewedResolutions(
          document,
          binding,
          snapshot,
          base.clients,
          base.projects,
          base.mappings,
        ),
      /P011_SOURCE_PROVENANCE_REQUIRED/u,
    );

    const tamperedClient = {
      ...client,
      raw_names: [...client.raw_names, 'Nome bruto adulterado'],
    };
    assert.notEqual(sha256Canonical({ ...tamperedClient, hash: undefined }), tamperedClient.hash);
    const tamperedProject = {
      ...project,
      project_name_proposal: 'Projeto semanticamente alterado',
    };
    assert.notEqual(sha256Canonical({ ...tamperedProject, hash: undefined }), tamperedProject.hash);
    const partialClient = {
      candidate_id: client.candidate_id,
      hash: client.hash,
      status: client.status,
      diagnostic_codes: client.diagnostic_codes,
    } as ClientCandidate;
    const clientWithoutName = Object.fromEntries(
      Object.entries(client).filter(([key]) => key !== 'normalized_name'),
    ) as unknown as ClientCandidate;
    const invalidCases: Array<{
      clients: ClientCandidate[];
      projects: ProjectCandidate[];
      pattern: RegExp;
    }> = [
      {
        clients: base.clients.map((entry) =>
          entry.candidate_id === client.candidate_id ? tamperedClient : entry,
        ),
        projects: base.projects,
        pattern: /(?:CLIENT_PROVENANCE_UNPROVEN|CANDIDATE_CONTENT_HASH_MISMATCH)/u,
      },
      {
        clients: base.clients,
        projects: base.projects.map((entry) =>
          entry.candidate_id === project.candidate_id ? tamperedProject : entry,
        ),
        pattern: /CANDIDATE_CONTENT_HASH_MISMATCH/u,
      },
      { clients: [partialClient], projects: [], pattern: /campos ausentes/u },
      {
        clients: [{ ...client, extra: true } as unknown as ClientCandidate],
        projects: [],
        pattern: /campos não autorizados=extra/u,
      },
      {
        clients: [],
        projects: [{ ...project, extra: true } as unknown as ProjectCandidate],
        pattern: /campos não autorizados=extra/u,
      },
      { clients: [clientWithoutName], projects: [], pattern: /campos ausentes=normalized_name/u },
      {
        clients: [{ ...client, status: 'invalid' } as unknown as ClientCandidate],
        projects: [],
        pattern: /client-candidate\.status/u,
      },
      {
        clients: [{ ...client, origins: [{}] } as unknown as ClientCandidate],
        projects: [],
        pattern: /campos ausentes/u,
      },
      {
        clients: [{ ...client, hash: 'invalid' }],
        projects: [],
        pattern: /exige SHA-256 canônico/u,
      },
      {
        clients: [client, structuredClone(client)],
        projects: [],
        pattern: /CANDIDATE_ID_(?:DUPLICATE|NON_CANONICAL)/u,
      },
      {
        clients: [client],
        projects: [
          lineageProject({
            candidate_id: client.candidate_id,
            action: 'pending_decision',
          }),
        ],
        pattern: /CANDIDATE_ID_(?:DUPLICATE|NON_CANONICAL)/u,
      },
    ];

    for (const invalid of invalidCases) {
      const before = canonicalJson({
        clients: invalid.clients,
        projects: invalid.projects,
        snapshot,
        document,
      });
      assert.throws(
        () =>
          createReviewBinding(
            NORMALIZER_VERSION,
            binding.p010_manifest_hash,
            binding.input_hash,
            snapshot,
            invalid.clients,
            invalid.projects,
          ),
        invalid.pattern,
      );
      let summaryCreated = false;
      assert.throws(() => {
        const result = applyReviewedResolutions(
          document,
          binding,
          snapshot,
          invalid.clients,
          invalid.projects,
          base.mappings,
        );
        summaryCreated = result.summary !== undefined;
      }, invalid.pattern);
      assert.equal(summaryCreated, false);
      assert.equal(
        canonicalJson({
          clients: invalid.clients,
          projects: invalid.projects,
          snapshot,
          document,
        }),
        before,
      );
    }
  });
});

test('D92 fecha applyExistingSnapshot sem reparar candidatos ou mutar entradas', () => {
  const snapshot = emptySnapshot();
  const client = integrityClient({
    status: 'valid',
    action: 'insert',
    possible_matches: [],
    diagnostic_codes: [],
  });
  const project = lineageProject({
    client_match_key: client.match_key,
    client_candidate_id: client.candidate_id,
    client_id: null,
    data_reference_date: '2024-01-01',
  });
  const validBefore = canonicalJson({ client, project, snapshot });
  const applied = applyExistingSnapshot([client], [project], snapshot);
  assert.equal(canonicalJson({ client, project, snapshot }), validBefore);
  assert.notEqual(applied.clients[0], client);
  assert.notEqual(applied.projects[0], project);
  assert.equal(applied.clients[0]?.hash, client.hash);
  assert.equal(applied.projects[0]?.hash, project.hash);
  assert.deepEqual(applied.snapshot, snapshot);
  assert.throws(
    () =>
      createReviewBinding(
        NORMALIZER_VERSION,
        'a'.repeat(64),
        'e'.repeat(64),
        applied.snapshot,
        applied.clients,
        applied.projects,
      ),
    /P011_SOURCE_PROVENANCE_REQUIRED/u,
  );

  const staleClient = {
    ...client,
    raw_names: [...client.raw_names, 'Nome bruto adulterado'],
  };
  const staleProject = { ...project, project_name_proposal: 'Projeto semanticamente alterado' };
  assert.notEqual(sha256Canonical({ ...staleClient, hash: undefined }), staleClient.hash);
  assert.notEqual(sha256Canonical({ ...staleProject, hash: undefined }), staleProject.hash);
  const partialClient = {
    candidate_id: client.candidate_id,
    status: client.status,
    hash: client.hash,
  } as ClientCandidate;
  const partialProject = {
    candidate_id: project.candidate_id,
    action: project.action,
    hash: project.hash,
  } as ProjectCandidate;
  const crossTypeProject = lineageProject({
    candidate_id: client.candidate_id,
    action: 'pending_decision',
  });
  const invalidCases: Array<{
    clients: ClientCandidate[];
    projects: ProjectCandidate[];
    pattern: RegExp;
  }> = [
    {
      clients: [staleClient],
      projects: [project],
      pattern: /(?:CLIENT_PROVENANCE_UNPROVEN|CANDIDATE_CONTENT_HASH_MISMATCH)/u,
    },
    {
      clients: [client],
      projects: [staleProject],
      pattern: /CANDIDATE_CONTENT_HASH_MISMATCH/u,
    },
    { clients: [partialClient], projects: [], pattern: /campos ausentes/u },
    { clients: [], projects: [partialProject], pattern: /campos ausentes/u },
    {
      clients: [{ ...client, extra: true } as unknown as ClientCandidate],
      projects: [],
      pattern: /extra/u,
    },
    {
      clients: [],
      projects: [{ ...project, extra: true } as unknown as ProjectCandidate],
      pattern: /extra/u,
    },
    {
      clients: [{ ...client, status: 1 } as unknown as ClientCandidate],
      projects: [],
      pattern: /client-candidate\.status/u,
    },
    {
      clients: [{ ...client, matched_client_id: 'invalid' }],
      projects: [],
      pattern: /UUID/u,
    },
    {
      clients: [{ ...client, origins: [{}] } as unknown as ClientCandidate],
      projects: [],
      pattern: /campos ausentes/u,
    },
    {
      clients: [{ ...client, hash: 'invalid' }],
      projects: [],
      pattern: /SHA-256/u,
    },
    {
      clients: [],
      projects: [
        {
          ...project,
          legacy_import_batch_reference: { kind: 'existing', import_batch_id: 'invalid' },
        } as ProjectCandidate,
      ],
      pattern: /UUID/u,
    },
    {
      clients: [],
      projects: [{ ...project, currency: 'invalid' }],
      pattern: /currency/u,
    },
    {
      clients: [],
      projects: [{ ...project, contract_value: 1 } as unknown as ProjectCandidate],
      pattern: /contract_value/u,
    },
    {
      clients: [],
      projects: [{ ...project, value_evidence: [{}] } as unknown as ProjectCandidate],
      pattern: /campos ausentes/u,
    },
    {
      clients: [],
      projects: [{ ...project, action: 'invalid' } as unknown as ProjectCandidate],
      pattern: /action/u,
    },
    {
      clients: [],
      projects: [{ ...project, hash: 'invalid' }],
      pattern: /SHA-256/u,
    },
    {
      clients: [client, structuredClone(client)],
      projects: [],
      pattern: /CANDIDATE_ID_(?:DUPLICATE|NON_CANONICAL)/u,
    },
    {
      clients: [],
      projects: [project, structuredClone(project)],
      pattern: /CANDIDATE_ID_(?:DUPLICATE|NON_CANONICAL)/u,
    },
    {
      clients: [client],
      projects: [crossTypeProject],
      pattern: /CANDIDATE_ID_(?:DUPLICATE|NON_CANONICAL)/u,
    },
  ];

  for (const invalid of invalidCases) {
    const before = canonicalJson({ ...invalid, snapshot });
    const declaredHashes = [
      ...invalid.clients.map((candidate) => candidate.hash),
      ...invalid.projects.map((candidate) => candidate.hash),
    ];
    assert.throws(
      () => applyExistingSnapshot(invalid.clients, invalid.projects, snapshot),
      invalid.pattern,
    );
    assert.equal(canonicalJson({ ...invalid, snapshot }), before);
    assert.deepEqual(
      [
        ...invalid.clients.map((candidate) => candidate.hash),
        ...invalid.projects.map((candidate) => candidate.hash),
      ],
      declaredHashes,
    );
  }
});

test('D94 rejeita invariantes semânticas antes de hashes, binding ou reconciliação', () => {
  const snapshot = emptySnapshot();
  const client = integrityClient({
    normalized_name: 'Cliente sintético',
    match_key: clientMatchKey('Cliente sintético'),
    status: 'valid',
    action: 'insert',
    matched_client_id: null,
    possible_matches: [],
    diagnostic_codes: [],
  });
  const project = lineageProject({
    client_match_key: client.match_key,
    client_candidate_id: client.candidate_id,
    client_id: null,
    contract_value: '1000.00',
    data_reference_date: '2024-01-01',
  });
  const binding = fabricatedBinding(snapshot, [client], [project]);
  const document: ReviewedResolutionDocument = {
    contract: 'ltcm.p011.reviewed-resolutions.v1',
    normalizer_version: NORMALIZER_VERSION,
    normalization_manifest_hash: binding.normalization_manifest_hash,
    p010_manifest_hash: binding.p010_manifest_hash,
    input_hash: binding.input_hash,
    snapshot_hash: binding.snapshot_hash,
    candidate_set_hash: binding.candidate_set_hash,
    resolutions: [],
  };
  const validApplication = applyExistingSnapshot([client], [project], snapshot);
  assert.equal(validApplication.clients[0]?.action, 'insert');
  assert.equal(validApplication.projects[0]?.contract_value, '1000.00');

  const withHash = <T extends ClientCandidate | ProjectCandidate>(candidate: T): T => ({
    ...candidate,
    hash: sha256Canonical({ ...candidate, hash: undefined }),
  });
  const noOpClientId = '00000000-0000-4000-8000-000000000094';
  const noOpClient = withHash({
    ...client,
    action: 'no_op',
    matched_client_id: noOpClientId,
  });
  const noOpProject = withHash({ ...project, client_id: noOpClientId });
  const noOpSnapshot: ExistingSnapshot = {
    ...snapshot,
    clients: [
      {
        id: noOpClientId,
        legal_name: client.normalized_name,
        display_name: client.normalized_name,
        tax_id: null,
        active: true,
        deleted_at: null,
        row_version: 1,
      },
    ],
  };
  const noOpBinding = fabricatedBinding(
    noOpSnapshot,
    [noOpClient],
    [noOpProject],
    binding.p010_manifest_hash,
    binding.input_hash,
  );
  const noOpDocument: ReviewedResolutionDocument = {
    ...document,
    normalization_manifest_hash: noOpBinding.normalization_manifest_hash,
    p010_manifest_hash: noOpBinding.p010_manifest_hash,
    input_hash: noOpBinding.input_hash,
    snapshot_hash: noOpBinding.snapshot_hash,
    candidate_set_hash: noOpBinding.candidate_set_hash,
  };
  assert.equal(
    applyExistingSnapshot([noOpClient], [noOpProject], noOpSnapshot).clients[0]?.action,
    'no_op',
  );
  assert.throws(
    () =>
      applyReviewedResolutions(
        noOpDocument,
        noOpBinding,
        noOpSnapshot,
        [noOpClient],
        [noOpProject],
        [],
      ),
    /P011_SOURCE_PROVENANCE_REQUIRED/u,
  );

  const noOpBefore = canonicalJson({ noOpClient, noOpProject, snapshot, noOpDocument });
  assert.throws(
    () =>
      createReviewBinding(
        NORMALIZER_VERSION,
        binding.p010_manifest_hash,
        binding.input_hash,
        snapshot,
        [noOpClient],
        [noOpProject],
      ),
    /REVIEWED_RESOLUTION_SNAPSHOT_INSUFFICIENT/u,
  );
  assert.throws(
    () => applyExistingSnapshot([noOpClient], [noOpProject], snapshot),
    /REVIEWED_RESOLUTION_SNAPSHOT_INSUFFICIENT/u,
  );
  let noOpSummaryCreated = false;
  assert.throws(() => {
    const result = applyReviewedResolutions(
      noOpDocument,
      noOpBinding,
      snapshot,
      [noOpClient],
      [noOpProject],
      [],
    );
    noOpSummaryCreated = result.summary !== undefined;
  }, /REVIEWED_RESOLUTION_SNAPSHOT_INSUFFICIENT/u);
  assert.equal(noOpSummaryCreated, false);
  assert.equal(canonicalJson({ noOpClient, noOpProject, snapshot, noOpDocument }), noOpBefore);

  const invalidClients = [
    withHash({ ...client, normalized_name: '' }),
    withHash({ ...client, normalized_name: '   ' }),
    withHash({ ...client, match_key: '' }),
    withHash({ ...client, match_key: '   ' }),
    withHash({ ...client, action: 'conflict' }),
    withHash({ ...client, action: 'no_op', matched_client_id: null }),
    withHash({
      ...client,
      matched_client_id: '00000000-0000-4000-8000-000000000094',
    }),
    withHash({
      ...client,
      status: 'ambiguous',
      action: 'insert',
      diagnostic_codes: ['CLIENT_MATCH_AMBIGUOUS'],
    }),
    withHash({
      ...client,
      status: 'rejected',
      action: 'rejected',
      diagnostic_codes: ['CLIENT_NAME_MISSING'],
    }),
  ];
  const invalidProjects = [
    'not-a-number',
    '',
    '   ',
    'NaN',
    'Infinity',
    '1000x',
    'x1000',
    '1e3',
    '01',
    '-1',
    '1.230',
  ].map((contractValue) => withHash({ ...project, contract_value: contractValue }));

  for (const invalidClient of invalidClients) {
    const before = canonicalJson({ invalidClient, project, snapshot, document });
    assert.throws(
      () =>
        createReviewBinding(
          NORMALIZER_VERSION,
          binding.p010_manifest_hash,
          binding.input_hash,
          snapshot,
          [invalidClient],
          [project],
        ),
      /(?:CLIENT_SEMANTIC_INVARIANT|CANDIDATE_ID_DERIVATION_MISMATCH)/u,
    );
    assert.throws(
      () => applyExistingSnapshot([invalidClient], [project], snapshot),
      /(?:CLIENT_SEMANTIC_INVARIANT|CANDIDATE_ID_DERIVATION_MISMATCH)/u,
    );
    let summaryCreated = false;
    assert.throws(() => {
      const result = applyReviewedResolutions(
        document,
        binding,
        snapshot,
        [invalidClient],
        [project],
        [],
      );
      summaryCreated = result.summary !== undefined;
    }, /(?:CLIENT_SEMANTIC_INVARIANT|CANDIDATE_ID_DERIVATION_MISMATCH)/u);
    assert.equal(summaryCreated, false);
    assert.equal(canonicalJson({ invalidClient, project, snapshot, document }), before);
  }

  for (const invalidProject of invalidProjects) {
    const before = canonicalJson({ client, invalidProject, snapshot, document });
    assert.throws(
      () =>
        createReviewBinding(
          NORMALIZER_VERSION,
          binding.p010_manifest_hash,
          binding.input_hash,
          snapshot,
          [client],
          [invalidProject],
        ),
      /PROJECT_CONTRACT_VALUE_INVALID/u,
    );
    assert.throws(
      () => applyExistingSnapshot([client], [invalidProject], snapshot),
      /PROJECT_CONTRACT_VALUE_INVALID/u,
    );
    let summaryCreated = false;
    assert.throws(() => {
      const result = applyReviewedResolutions(
        document,
        binding,
        snapshot,
        [client],
        [invalidProject],
        [],
      );
      summaryCreated = result.summary !== undefined;
    }, /PROJECT_CONTRACT_VALUE_INVALID/u);
    assert.equal(summaryCreated, false);
    assert.equal(canonicalJson({ client, invalidProject, snapshot, document }), before);
  }

  const snapshotProject = {
    id: '00000000-0000-4000-8000-000000000091',
    project_code: project.project_code,
    project_name: project.project_name_proposal,
    client_id: '00000000-0000-4000-8000-000000000092',
    classification: 'full_contract' as const,
    status: 'active' as const,
    base_currency: 'BRL',
    contract_value: '1000.00',
    data_reference_date: '2024-01-01',
    legacy_import_batch_id: null,
    deleted_at: null,
    version: 1,
  };
  const validSnapshot: ExistingSnapshot = {
    ...snapshot,
    projects: [snapshotProject],
  };
  assert.match(createSnapshotHash(validSnapshot), /^[0-9a-f]{64}$/u);
  for (const validValue of ['0', '0.00', '164000', '1000.5', '999999999999999999.99']) {
    assert.match(
      createSnapshotHash({
        ...validSnapshot,
        projects: [{ ...snapshotProject, contract_value: validValue }],
      }),
      /^[0-9a-f]{64}$/u,
    );
  }
  for (const invalidValue of invalidProjects.map((candidate) => candidate.contract_value)) {
    const invalidSnapshot = {
      ...validSnapshot,
      projects: [{ ...snapshotProject, contract_value: invalidValue }],
    };
    const before = canonicalJson(invalidSnapshot);
    assert.throws(() => parseExistingSnapshot(invalidSnapshot), /PROJECT_CONTRACT_VALUE_INVALID/u);
    assert.throws(() => createSnapshotHash(invalidSnapshot), /PROJECT_CONTRACT_VALUE_INVALID/u);
    assert.throws(
      () =>
        createReviewBinding(
          NORMALIZER_VERSION,
          binding.p010_manifest_hash,
          binding.input_hash,
          invalidSnapshot,
          [client],
          [project],
        ),
      /PROJECT_CONTRACT_VALUE_INVALID/u,
    );
    assert.equal(canonicalJson(invalidSnapshot), before);
  }
  for (const contract of [
    'ltcm.p011.existing-snapshot.v1',
    'ltcm.p011.existing-snapshot.v2',
  ] as const) {
    const legacySnapshot = {
      contract,
      currencies: validSnapshot.currencies,
      clients: validSnapshot.clients,
      projects: [
        Object.fromEntries(
          Object.entries({ ...snapshotProject, contract_value: 'not-a-number' }).filter(
            ([key]) => contract.endsWith('.v2') || key !== 'legacy_import_batch_id',
          ),
        ),
      ],
    };
    assert.throws(() => parseExistingSnapshot(legacySnapshot), /PROJECT_CONTRACT_VALUE_INVALID/u);
  }
});

test('D96 fecha identidade invisível, insert incompleto e unicidades normativas', () => {
  const snapshot = emptySnapshot();
  const withHash = <T extends ClientCandidate | ProjectCandidate>(candidate: T): T => ({
    ...candidate,
    hash: sha256Canonical({ ...candidate, hash: undefined }),
  });
  const client = integrityClient({
    status: 'valid',
    action: 'insert',
    possible_matches: [],
    diagnostic_codes: [],
  });
  const project = lineageProject({
    client_match_key: client.match_key,
    client_candidate_id: client.candidate_id,
    client_id: null,
    data_reference_date: '2024-01-01',
  });
  const binding = fabricatedBinding(snapshot, [client], [project]);
  const document: ReviewedResolutionDocument = {
    contract: 'ltcm.p011.reviewed-resolutions.v1',
    normalizer_version: binding.normalizer_version,
    normalization_manifest_hash: binding.normalization_manifest_hash,
    p010_manifest_hash: binding.p010_manifest_hash,
    input_hash: binding.input_hash,
    snapshot_hash: binding.snapshot_hash,
    candidate_set_hash: binding.candidate_set_hash,
    resolutions: [],
  };
  assert.equal(applyExistingSnapshot([client], [project], snapshot).projects[0]?.action, 'insert');
  assert.throws(
    () => applyReviewedResolutions(document, binding, snapshot, [client], [project], []),
    /P011_SOURCE_PROVENANCE_REQUIRED/u,
  );

  for (const invisible of [
    '\u200b',
    '\u200c',
    '\u200d',
    '\u2060',
    '\u202e',
    '\u2066',
    '\u2069',
    '\u0007',
    '\u0301',
    '---',
  ]) {
    const invalidClient = withHash({
      ...client,
      candidate_id: createClientCandidateId(clientMatchKey(invisible)),
      raw_names: [invisible],
      normalized_name: invisible,
      match_key: clientMatchKey(invisible),
    });
    const before = canonicalJson({ invalidClient, project, snapshot, document });
    assert.throws(
      () => parseValidatedCandidateSet([invalidClient], [project]),
      /CLIENT_SEMANTIC_INVARIANT/u,
    );
    assert.throws(
      () =>
        createReviewBinding(
          NORMALIZER_VERSION,
          binding.p010_manifest_hash,
          binding.input_hash,
          snapshot,
          [invalidClient],
          [project],
        ),
      /CLIENT_SEMANTIC_INVARIANT/u,
    );
    assert.throws(
      () => applyExistingSnapshot([invalidClient], [project], snapshot),
      /CLIENT_SEMANTIC_INVARIANT/u,
    );
    let summaryCreated = false;
    assert.throws(() => {
      const result = applyReviewedResolutions(
        document,
        binding,
        snapshot,
        [invalidClient],
        [project],
        [],
      );
      summaryCreated = result.summary !== undefined;
    }, /CLIENT_SEMANTIC_INVARIANT/u);
    assert.equal(summaryCreated, false);
    assert.equal(canonicalJson({ invalidClient, project, snapshot, document }), before);
  }

  for (const name of ['Cliente São José', 'Αθήνα', '東京', 'Acme\u200d Internacional']) {
    const unicodeClient = withHash({
      ...client,
      candidate_id: createClientCandidateId(clientMatchKey(name)),
      client_ref: `client-${sha256Canonical({ name }).slice(0, 12)}`,
      raw_names: [name],
      normalized_name: name,
      match_key: clientMatchKey(name),
    });
    assert.equal(parseValidatedCandidateSet([unicodeClient], []).clients[0]?.normalized_name, name);
  }

  const incompleteProject = withHash({
    ...project,
    project_name_mapping_status: 'pending_decision',
    client_match_key: null,
    client_candidate_id: null,
    client_id: null,
    currency: null,
    classification: null,
    operational_status: null,
    contract_value: null,
    data_reference_date: null,
    legacy_import_batch_reference: null,
    action: 'insert',
  });
  const incompleteBefore = canonicalJson({ client, incompleteProject, snapshot, document });
  assert.throws(
    () => parseValidatedCandidateSet([client], [incompleteProject]),
    /PROJECT_SEMANTIC_INVARIANT/u,
  );
  assert.throws(
    () =>
      createReviewBinding(
        NORMALIZER_VERSION,
        binding.p010_manifest_hash,
        binding.input_hash,
        snapshot,
        [client],
        [incompleteProject],
      ),
    /PROJECT_SEMANTIC_INVARIANT/u,
  );
  assert.throws(
    () => applyExistingSnapshot([client], [incompleteProject], snapshot),
    /PROJECT_SEMANTIC_INVARIANT/u,
  );
  let incompleteSummaryCreated = false;
  assert.throws(() => {
    const result = applyReviewedResolutions(
      document,
      binding,
      snapshot,
      [client],
      [incompleteProject],
      [],
    );
    incompleteSummaryCreated = result.summary !== undefined;
  }, /PROJECT_SEMANTIC_INVARIANT/u);
  assert.equal(incompleteSummaryCreated, false);
  assert.equal(canonicalJson({ client, incompleteProject, snapshot, document }), incompleteBefore);
  assert.throws(
    () =>
      parseValidatedCandidateSet(
        [],
        [lineageProject({ action: 'conflict', diagnostic_codes: ['PROTECTED_RECORD_CONFLICT'] })],
      ),
    /PROJECT_CONFLICT_UNPROVEN/u,
  );
  assert.equal(
    parseValidatedCandidateSet(
      [client],
      [
        lineageProject({
          candidate_id: ALTERNATE_PROJECT_CANDIDATE_ID,
          raw_codes: ['SYNTHETIC-002'],
          project_code: 'SYNTHETIC-002',
          client_match_key: client.match_key,
          client_candidate_id: client.candidate_id,
          client_id: null,
          action: 'pending_decision',
          diagnostic_codes: ['PROJECT_DATA_REFERENCE_DATE_MISSING'],
        }),
      ],
    ).projects.length,
    1,
  );

  const distinctClient = withHash({
    ...client,
    candidate_id: createClientCandidateId('fornecedor distinto'),
    client_ref: 'client-distinct',
    raw_names: ['Fornecedor distinto'],
    normalized_name: 'Fornecedor distinto',
    match_key: 'fornecedor distinto',
  });
  assert.equal(parseValidatedCandidateSet([client, distinctClient], []).clients.length, 2);
  for (const [clients, projects] of [
    [[client, structuredClone(client)], []],
    [[client, withHash({ ...client, candidate_id: client.candidate_id.toUpperCase() })], []],
    [
      [],
      [
        lineageProject({ action: 'pending_decision' }),
        lineageProject({ action: 'pending_decision' }),
      ],
    ],
    [
      [],
      [
        lineageProject({ action: 'pending_decision' }),
        lineageProject({
          candidate_id: lineageProject().candidate_id.toUpperCase(),
          action: 'pending_decision',
        }),
      ],
    ],
    [
      [client],
      [
        lineageProject({
          candidate_id: client.candidate_id.toUpperCase(),
          action: 'pending_decision',
        }),
      ],
    ],
  ] as Array<[ClientCandidate[], ProjectCandidate[]]>) {
    assert.throws(
      () => parseValidatedCandidateSet(clients, projects),
      /CANDIDATE_ID_(?:DUPLICATE|NON_CANONICAL)/u,
    );
  }

  const snapshotClientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const snapshotClient = {
    id: snapshotClientId,
    legal_name: client.normalized_name,
    display_name: client.normalized_name,
    tax_id: null,
    active: true,
    deleted_at: null,
    row_version: 1,
  };
  const distinctSnapshot: ExistingSnapshot = {
    ...snapshot,
    clients: [snapshotClient, { ...snapshotClient, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }],
  };
  assert.match(createSnapshotHash(distinctSnapshot), /^[0-9a-f]{64}$/u);
  for (const duplicateClients of [
    [snapshotClient, structuredClone(snapshotClient)],
    [snapshotClient, { ...snapshotClient, id: snapshotClientId.toUpperCase() }],
  ]) {
    const invalidSnapshot: ExistingSnapshot = { ...snapshot, clients: duplicateClients };
    assert.throws(() => parseExistingSnapshot(invalidSnapshot), /clients\.id duplicado/u);
    assert.throws(() => createSnapshotHash(invalidSnapshot), /clients\.id duplicado/u);
    assert.throws(
      () =>
        createReviewBinding(
          NORMALIZER_VERSION,
          binding.p010_manifest_hash,
          binding.input_hash,
          invalidSnapshot,
          [client],
          [project],
        ),
      /clients\.id duplicado/u,
    );
    const noOpClient = withHash({
      ...client,
      action: 'no_op',
      matched_client_id: snapshotClientId,
    });
    assert.throws(
      () => applyExistingSnapshot([noOpClient], [], invalidSnapshot),
      /clients\.id duplicado/u,
    );
  }

  const snapshotProject = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    project_code: 'SYNTHETIC-001',
    project_name: 'Projeto sintético',
    client_id: snapshotClientId,
    classification: 'full_contract' as const,
    status: 'active' as const,
    base_currency: 'BRL',
    contract_value: '1000',
    data_reference_date: '2024-01-01',
    legacy_import_batch_id: null,
    deleted_at: null,
    version: 1,
  };
  for (const duplicateProjects of [
    [snapshotProject, structuredClone(snapshotProject)],
    [snapshotProject, { ...snapshotProject, id: snapshotProject.id.toUpperCase() }],
  ]) {
    assert.throws(
      () => parseExistingSnapshot({ ...snapshot, projects: duplicateProjects }),
      /projects\.id duplicado/u,
    );
  }
});

test('D98 fecha IDs não canônicos, matriz de project actions e currencies duplicadas', () => {
  const snapshot = emptySnapshot();
  const withHash = <T extends ClientCandidate | ProjectCandidate>(candidate: T): T => ({
    ...candidate,
    hash: sha256Canonical({ ...candidate, hash: undefined }),
  });
  const client = integrityClient({
    status: 'valid',
    action: 'insert',
    possible_matches: [],
    diagnostic_codes: [],
  });
  const project = lineageProject({
    client_match_key: client.match_key,
    client_candidate_id: client.candidate_id,
    client_id: null,
    data_reference_date: '2024-01-01',
    diagnostic_codes: [],
  });
  assert.equal(parseValidatedCandidateSet([client], [project]).projects[0]?.action, 'insert');

  for (const invalidClientId of [
    client.candidate_id.toUpperCase(),
    `Client-${'1'.repeat(24)}`,
    SYNTHETIC_PROJECT_CANDIDATE_ID,
    `client-${'1'.repeat(23)}`,
    `client-${'1'.repeat(23)}g`,
  ]) {
    const invalid = withHash({ ...client, candidate_id: invalidClientId });
    assert.throws(
      () => parseValidatedCandidateSet([invalid], []),
      /CANDIDATE_ID_NON_CANONICAL: client/u,
    );
    assert.throws(
      () =>
        createReviewBinding(
          NORMALIZER_VERSION,
          'a'.repeat(64),
          'b'.repeat(64),
          snapshot,
          [invalid],
          [],
        ),
      /CANDIDATE_ID_NON_CANONICAL: client/u,
    );
  }
  for (const invalidProjectId of [
    project.candidate_id.toUpperCase(),
    `Project-${'2'.repeat(24)}`,
    SYNTHETIC_CLIENT_CANDIDATE_ID,
    `project-${'2'.repeat(25)}`,
    `project-${'2'.repeat(23)}_`,
  ]) {
    const invalid = withHash({ ...project, candidate_id: invalidProjectId });
    assert.throws(
      () => parseValidatedCandidateSet([client], [invalid]),
      /CANDIDATE_ID_NON_CANONICAL: project/u,
    );
  }
  assert.throws(
    () =>
      parseValidatedCandidateSet(
        [withHash({ ...client, candidate_id: createClientCandidateId('outra chave') })],
        [],
      ),
    /CANDIDATE_ID_DERIVATION_MISMATCH: client/u,
  );
  assert.throws(
    () =>
      parseValidatedCandidateSet(
        [client],
        [withHash({ ...project, candidate_id: createProjectCandidateId('2026-01-99999') })],
      ),
    /CANDIDATE_ID_DERIVATION_MISMATCH: project/u,
  );

  const validBinding = fabricatedBinding(snapshot, [client], [project]);
  const validDocument: ReviewedResolutionDocument = {
    contract: 'ltcm.p011.reviewed-resolutions.v1',
    normalizer_version: validBinding.normalizer_version,
    normalization_manifest_hash: validBinding.normalization_manifest_hash,
    p010_manifest_hash: validBinding.p010_manifest_hash,
    input_hash: validBinding.input_hash,
    snapshot_hash: validBinding.snapshot_hash,
    candidate_set_hash: validBinding.candidate_set_hash,
    resolutions: [],
  };
  assert.throws(
    () =>
      parseReviewedResolutionDocument({
        ...validDocument,
        resolutions: [
          {
            type: 'project',
            candidate_id: SYNTHETIC_CLIENT_CANDIDATE_ID,
            candidate_hash: project.hash,
            approved_name: 'Projeto aprovado',
          },
        ],
      }),
    /CANDIDATE_ID_NON_CANONICAL: project/u,
  );

  for (const invalidProject of [
    withHash({ ...project, diagnostic_codes: ['PROJECT_CLASSIFICATION_PENDING'] }),
    withHash({ ...project, diagnostic_codes: ['PROJECT_UNKNOWN_BLOCKER'] }),
    withHash({ ...project, diagnostic_codes: ['PROJECT_CLIENT_UNRESOLVED'] }),
    withHash({ ...project, currency: null, diagnostic_codes: ['PROJECT_CURRENCY_UNRESOLVED'] }),
    withHash({
      ...project,
      data_reference_date: null,
      legacy_import_batch_reference: null,
      diagnostic_codes: ['PROJECT_DATA_REFERENCE_DATE_MISSING'],
    }),
    withHash({
      ...project,
      project_name_mapping_status: 'pending_decision',
      diagnostic_codes: [],
    }),
  ]) {
    assert.throws(
      () => parseValidatedCandidateSet([client], [invalidProject]),
      /PROJECT_SEMANTIC_INVARIANT/u,
    );
    assert.throws(
      () => applyExistingSnapshot([client], [invalidProject], snapshot),
      /PROJECT_SEMANTIC_INVARIANT/u,
    );
    let summaryCreated = false;
    assert.throws(() => {
      const result = applyReviewedResolutions(
        validDocument,
        validBinding,
        snapshot,
        [client],
        [invalidProject],
        [],
      );
      summaryCreated = result.summary !== undefined;
    }, /PROJECT_SEMANTIC_INVARIANT/u);
    assert.equal(summaryCreated, false);
  }

  const informationalInsert = withHash({
    ...project,
    candidate_id: createProjectCandidateId('2024-02-10990'),
    raw_codes: ['2024-02-10990'],
    project_code: '2024-02-10990',
    diagnostic_codes: ['RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE'],
    receipt_forecast_evidence: [
      {
        raw_number: 369749.1735,
        decimal_round_trip_string: '369749.1735',
        formatted_text: '369749.1735',
        number_format: 'General',
        coordinate: 'J45',
        row_hash: 'a'.repeat(64),
        mapping_status: 'evidence_only',
        target_field: null,
      },
    ],
  });
  assert.equal(
    parseValidatedCandidateSet([client], [informationalInsert]).projects[0]?.action,
    'insert',
  );
  const d38Insert = withHash({
    ...project,
    data_reference_date: null,
    legacy_import_batch_reference: plannedLegacyImportBatchReference(
      'a'.repeat(64),
      'b'.repeat(64),
    ),
    diagnostic_codes: ['PROJECT_DATA_REFERENCE_DATE_MISSING'],
  });
  assert.equal(parseValidatedCandidateSet([client], [d38Insert]).projects[0]?.action, 'insert');

  assert.throws(
    () =>
      parseValidatedCandidateSet(
        [],
        [
          withHash({
            ...project,
            project_name_mapping_status: 'pending_decision',
            client_match_key: null,
            client_candidate_id: null,
            client_id: null,
            currency: null,
            classification: null,
            operational_status: null,
            contract_value: null,
            data_reference_date: null,
            legacy_import_batch_reference: null,
            action: 'no_op',
            diagnostic_codes: ['PROJECT_CLIENT_UNRESOLVED', 'PROJECT_CLASSIFICATION_PENDING'],
          }),
        ],
      ),
    /PROJECT_SEMANTIC_INVARIANT/u,
  );
  assert.throws(
    () => parseValidatedCandidateSet([], [withHash({ ...project, action: 'conflict' })]),
    /PROJECT_SEMANTIC_INVARIANT/u,
  );
  assert.throws(
    () =>
      parseValidatedCandidateSet(
        [],
        [
          withHash({
            ...project,
            action: 'conflict',
            diagnostic_codes: ['PROTECTED_RECORD_CONFLICT'],
          }),
        ],
      ),
    /PROJECT_CONFLICT_UNPROVEN/u,
  );
  assert.throws(
    () => parseValidatedCandidateSet([], [withHash({ ...project, action: 'rejected' })]),
    /PROJECT_SEMANTIC_INVARIANT/u,
  );
  assert.equal(
    parseValidatedCandidateSet(
      [client],
      [
        withHash({
          ...project,
          currency: null,
          action: 'rejected',
          diagnostic_codes: ['PROJECT_CURRENCY_UNRESOLVED'],
        }),
      ],
    ).projects[0]?.action,
    'rejected',
  );
  assert.throws(
    () => parseValidatedCandidateSet([], [withHash({ ...project, action: 'pending_decision' })]),
    /PROJECT_SEMANTIC_INVARIANT/u,
  );
  assert.equal(
    parseValidatedCandidateSet(
      [client],
      [
        withHash({
          ...project,
          project_name_mapping_status: 'pending_decision',
          action: 'pending_decision',
        }),
      ],
    ).projects[0]?.action,
    'pending_decision',
  );

  const existingClientId = '00000000-0000-4000-8000-000000000098';
  const equivalentSnapshot: ExistingSnapshot = {
    ...snapshot,
    clients: [
      {
        id: existingClientId,
        legal_name: client.normalized_name,
        display_name: client.normalized_name,
        tax_id: null,
        active: true,
        deleted_at: null,
        row_version: 1,
      },
    ],
    projects: [
      {
        id: '00000000-0000-4000-8000-000000000099',
        project_code: project.project_code,
        project_name: project.project_name_proposal,
        client_id: existingClientId,
        classification: project.classification!,
        status: project.operational_status!,
        base_currency: project.currency!,
        contract_value: project.contract_value!,
        data_reference_date: project.data_reference_date,
        legacy_import_batch_id: null,
        deleted_at: null,
        version: 1,
      },
    ],
  };
  const reconciled = applyExistingSnapshot([client], [project], equivalentSnapshot);
  assert.equal(reconciled.clients[0]?.action, 'no_op');
  assert.equal(reconciled.projects[0]?.action, 'no_op');
  const noOpBinding = fabricatedBinding(
    equivalentSnapshot,
    reconciled.clients,
    reconciled.projects,
  );
  const noOpDocument: ReviewedResolutionDocument = {
    ...validDocument,
    normalization_manifest_hash: noOpBinding.normalization_manifest_hash,
    snapshot_hash: noOpBinding.snapshot_hash,
    candidate_set_hash: noOpBinding.candidate_set_hash,
  };
  assert.throws(
    () =>
      applyReviewedResolutions(
        noOpDocument,
        noOpBinding,
        equivalentSnapshot,
        reconciled.clients,
        reconciled.projects,
        [],
      ),
    /P011_SOURCE_PROVENANCE_REQUIRED/u,
  );
  const clientOnlySnapshot: ExistingSnapshot = { ...equivalentSnapshot, projects: [] };
  assert.throws(
    () =>
      createReviewBinding(
        NORMALIZER_VERSION,
        'a'.repeat(64),
        'b'.repeat(64),
        clientOnlySnapshot,
        reconciled.clients,
        reconciled.projects,
      ),
    /PROJECT_NO_OP_UNPROVEN/u,
  );
  assert.throws(
    () => applyExistingSnapshot(reconciled.clients, reconciled.projects, clientOnlySnapshot),
    /PROJECT_NO_OP_UNPROVEN/u,
  );
  const forgedBatchProject = withHash({
    ...reconciled.projects[0]!,
    matched_legacy_import_batch_id: '00000000-0000-4000-8000-000000000097',
  });
  assert.throws(
    () =>
      createReviewBinding(
        NORMALIZER_VERSION,
        'a'.repeat(64),
        'b'.repeat(64),
        equivalentSnapshot,
        reconciled.clients,
        [forgedBatchProject],
      ),
    /PROJECT_NO_OP_UNPROVEN/u,
  );
  for (const divergentProject of [
    { ...equivalentSnapshot.projects[0]!, project_name: 'Projeto divergente' },
    { ...equivalentSnapshot.projects[0]!, contract_value: '1001' },
    { ...equivalentSnapshot.projects[0]!, data_reference_date: '2024-01-02' },
  ]) {
    const divergentSnapshot: ExistingSnapshot = {
      ...equivalentSnapshot,
      projects: [divergentProject],
    };
    assert.throws(
      () =>
        createReviewBinding(
          NORMALIZER_VERSION,
          'a'.repeat(64),
          'b'.repeat(64),
          divergentSnapshot,
          reconciled.clients,
          reconciled.projects,
        ),
      /PROJECT_NO_OP_UNPROVEN/u,
    );
    assert.throws(
      () => applyExistingSnapshot(reconciled.clients, reconciled.projects, divergentSnapshot),
      /PROJECT_NO_OP_UNPROVEN/u,
    );
    assert.throws(
      () =>
        applyReviewedResolutions(
          noOpDocument,
          noOpBinding,
          divergentSnapshot,
          reconciled.clients,
          reconciled.projects,
          [],
        ),
      /PROJECT_NO_OP_UNPROVEN/u,
    );
  }

  const duplicateCurrencySnapshots: ExistingSnapshot[] = [
    {
      ...snapshot,
      currencies: [
        { code: 'BRL', active: true },
        { code: 'BRL', active: true },
      ],
    },
    {
      ...snapshot,
      currencies: [
        { code: 'BRL', active: true },
        { code: 'BRL', active: false },
      ],
    },
  ];
  const emptyBinding = fabricatedBinding(snapshot, [], [], 'c'.repeat(64), 'd'.repeat(64));
  const emptyDocument: ReviewedResolutionDocument = {
    contract: 'ltcm.p011.reviewed-resolutions.v1',
    normalizer_version: emptyBinding.normalizer_version,
    normalization_manifest_hash: emptyBinding.normalization_manifest_hash,
    p010_manifest_hash: emptyBinding.p010_manifest_hash,
    input_hash: emptyBinding.input_hash,
    snapshot_hash: emptyBinding.snapshot_hash,
    candidate_set_hash: emptyBinding.candidate_set_hash,
    resolutions: [],
  };
  for (const invalidSnapshot of duplicateCurrencySnapshots) {
    const before = canonicalJson(invalidSnapshot);
    assert.throws(() => parseExistingSnapshot(invalidSnapshot), /currencies\.code duplicado/u);
    assert.throws(() => createSnapshotHash(invalidSnapshot), /currencies\.code duplicado/u);
    assert.throws(
      () =>
        createReviewBinding(
          NORMALIZER_VERSION,
          'c'.repeat(64),
          'd'.repeat(64),
          invalidSnapshot,
          [],
          [],
        ),
      /currencies\.code duplicado/u,
    );
    let summaryCreated = false;
    assert.throws(() => {
      const result = applyReviewedResolutions(
        emptyDocument,
        emptyBinding,
        invalidSnapshot,
        [],
        [],
        [],
      );
      summaryCreated = result.summary !== undefined;
    }, /currencies\.code duplicado/u);
    assert.equal(summaryCreated, false);
    assert.equal(canonicalJson(invalidSnapshot), before);
  }
  for (const contract of ['ltcm.p011.existing-snapshot.v1', 'ltcm.p011.existing-snapshot.v2']) {
    assert.throws(
      () =>
        parseExistingSnapshot({
          contract,
          currencies: duplicateCurrencySnapshots[0]!.currencies,
          clients: [],
          projects: [],
        }),
      /currencies\.code duplicado/u,
    );
  }
});

test('D100 exige evidência real para ambiguous, conflict e rejected antes de promover', () => {
  const snapshot = emptySnapshot();
  const withHash = <T extends ClientCandidate | ProjectCandidate>(candidate: T): T => ({
    ...candidate,
    hash: sha256Canonical({ ...candidate, hash: undefined }),
  });
  const documentFor = (
    binding: ReviewBinding,
    resolutions: ReviewedResolution[] = [],
  ): ReviewedResolutionDocument => ({
    contract: 'ltcm.p011.reviewed-resolutions.v1',
    normalizer_version: binding.normalizer_version,
    normalization_manifest_hash: binding.normalization_manifest_hash,
    p010_manifest_hash: binding.p010_manifest_hash,
    input_hash: binding.input_hash,
    snapshot_hash: binding.snapshot_hash,
    candidate_set_hash: binding.candidate_set_hash,
    resolutions,
  });

  const clientARef = 'client-family-a';
  const clientBRef = 'client-family-b';
  const ambiguousA = integrityClient({
    candidate_id: createClientCandidateId('cliente sintético unidade a'),
    client_ref: clientARef,
    raw_names: ['Cliente sintético unidade A'],
    normalized_name: 'Cliente sintético unidade A',
    match_key: 'cliente sintético unidade a',
    possible_matches: [clientBRef],
  });
  const ambiguousB = integrityClient({
    candidate_id: createClientCandidateId('cliente sintético unidade b'),
    client_ref: clientBRef,
    raw_names: ['Cliente sintético unidade B'],
    normalized_name: 'Cliente sintético unidade B',
    match_key: 'cliente sintético unidade b',
    possible_matches: [clientARef],
  });
  assert.equal(parseValidatedCandidateSet([ambiguousA, ambiguousB], []).clients.length, 2);
  const clientCRef = 'client-family-c';
  const ambiguousC = integrityClient({
    candidate_id: createClientCandidateId('cliente sintético unidade c'),
    client_ref: clientCRef,
    raw_names: ['Cliente sintético unidade C'],
    normalized_name: 'Cliente sintético unidade C',
    match_key: 'cliente sintético unidade c',
    possible_matches: [clientARef, clientBRef],
  });
  const familyA = withHash({ ...ambiguousA, possible_matches: [clientBRef, clientCRef] });
  const familyB = withHash({ ...ambiguousB, possible_matches: [clientARef, clientCRef] });
  assert.equal(parseValidatedCandidateSet([familyA, familyB, ambiguousC], []).clients.length, 3);
  assert.throws(
    () =>
      parseValidatedCandidateSet(
        [withHash({ ...familyA, possible_matches: [clientCRef, clientBRef] }), familyB, ambiguousC],
        [],
      ),
    /CLIENT_AMBIGUITY_UNPROVEN/u,
  );
  for (const falseAmbiguity of [
    withHash({ ...ambiguousA, possible_matches: [] }),
    withHash({ ...ambiguousA, possible_matches: [clientBRef, clientBRef] }),
    withHash({ ...ambiguousA, possible_matches: ['client-unrelated'] }),
  ]) {
    assert.throws(
      () => parseValidatedCandidateSet([falseAmbiguity, ambiguousB], []),
      /CLIENT_(?:SEMANTIC_INVARIANT|AMBIGUITY_UNPROVEN)/u,
    );
    assert.throws(
      () => applyExistingSnapshot([falseAmbiguity, ambiguousB], [], snapshot),
      /CLIENT_(?:SEMANTIC_INVARIANT|AMBIGUITY_UNPROVEN)/u,
    );
    assert.throws(
      () =>
        createReviewBinding(
          NORMALIZER_VERSION,
          'a'.repeat(64),
          'b'.repeat(64),
          snapshot,
          [falseAmbiguity, ambiguousB],
          [],
        ),
      /CLIENT_(?:SEMANTIC_INVARIANT|AMBIGUITY_UNPROVEN)/u,
    );
  }
  assert.throws(() => parseValidatedCandidateSet([ambiguousA], []), /CLIENT_AMBIGUITY_UNPROVEN/u);

  const ambiguityBinding = fabricatedBinding(snapshot, [ambiguousA, ambiguousB], []);
  const falseAmbiguity = withHash({ ...ambiguousA, possible_matches: [] });
  assert.throws(
    () =>
      applyReviewedResolutions(
        documentFor(ambiguityBinding, [
          {
            type: 'client_identity',
            candidate_id: ambiguousA.candidate_id,
            candidate_hash: ambiguousA.hash,
            identity: { kind: 'create_new' },
          },
        ]),
        ambiguityBinding,
        snapshot,
        [falseAmbiguity, ambiguousB],
        [],
        [],
      ),
    /CLIENT_SEMANTIC_INVARIANT/u,
  );
  assert.throws(
    () =>
      applyReviewedResolutions(
        documentFor(ambiguityBinding, [
          {
            type: 'client_identity',
            candidate_id: ambiguousA.candidate_id,
            candidate_hash: ambiguousA.hash,
            identity: { kind: 'create_new' },
          },
        ]),
        ambiguityBinding,
        snapshot,
        [ambiguousA, ambiguousB],
        [],
        [],
      ),
    /P011_SOURCE_PROVENANCE_REQUIRED/u,
  );

  const existingClientId = '00000000-0000-4000-8000-000000000100';
  const clientSnapshot: ExistingSnapshot = {
    ...snapshot,
    clients: [
      {
        id: existingClientId,
        legal_name: ambiguousA.normalized_name,
        display_name: ambiguousA.normalized_name,
        tax_id: null,
        active: true,
        deleted_at: null,
        row_version: 1,
      },
    ],
  };
  const useExistingBinding = fabricatedBinding(clientSnapshot, [ambiguousA, ambiguousB], []);
  assert.throws(
    () =>
      applyReviewedResolutions(
        documentFor(useExistingBinding, [
          {
            type: 'client_identity',
            candidate_id: ambiguousA.candidate_id,
            candidate_hash: ambiguousA.hash,
            identity: { kind: 'use_existing', client_id: existingClientId },
          },
        ]),
        useExistingBinding,
        clientSnapshot,
        [ambiguousA, ambiguousB],
        [],
        [],
      ),
    /P011_SOURCE_PROVENANCE_REQUIRED/u,
  );

  const validClient = integrityClient({
    status: 'valid',
    action: 'insert',
    possible_matches: [],
    diagnostic_codes: [],
  });
  const insertProject = lineageProject({
    client_match_key: validClient.match_key,
    client_candidate_id: validClient.candidate_id,
    client_id: null,
    data_reference_date: '2024-01-01',
    diagnostic_codes: [],
  });
  const forgedConflict = withHash({
    ...insertProject,
    action: 'conflict',
    diagnostic_codes: ['PROTECTED_RECORD_CONFLICT'],
  });
  const forgedRejected = withHash({
    ...insertProject,
    action: 'rejected',
    diagnostic_codes: ['PROJECT_CLIENT_UNRESOLVED'],
  });
  const validInsertBinding = fabricatedBinding(snapshot, [validClient], [insertProject]);
  for (const [candidate, pattern] of [
    [forgedConflict, /PROJECT_CONFLICT_UNPROVEN/u],
    [forgedRejected, /PROJECT_DIAGNOSTIC_UNPROVEN/u],
  ] as Array<[ProjectCandidate, RegExp]>) {
    const before = canonicalJson({ candidate, validClient, snapshot });
    assert.throws(() => parseValidatedCandidateSet([validClient], [candidate], snapshot), pattern);
    assert.throws(
      () =>
        applyReviewedResolutions(
          documentFor(validInsertBinding),
          validInsertBinding,
          snapshot,
          [validClient],
          [candidate],
          [],
        ),
      pattern,
    );
    assert.throws(() => applyExistingSnapshot([validClient], [candidate], snapshot), pattern);
    assert.throws(
      () =>
        createReviewBinding(
          NORMALIZER_VERSION,
          'a'.repeat(64),
          'b'.repeat(64),
          snapshot,
          [validClient],
          [candidate],
        ),
      pattern,
    );
    assert.equal(canonicalJson({ candidate, validClient, snapshot }), before);
  }

  const conflictTarget = {
    id: '00000000-0000-4000-8000-000000000101',
    project_code: insertProject.project_code,
    project_name: 'Projeto protegido divergente',
    client_id: existingClientId,
    classification: insertProject.classification!,
    status: insertProject.operational_status!,
    base_currency: insertProject.currency!,
    contract_value: insertProject.contract_value!,
    data_reference_date: insertProject.data_reference_date,
    legacy_import_batch_id: null,
    deleted_at: null,
    version: 1,
  };
  const conflictSnapshot: ExistingSnapshot = {
    ...clientSnapshot,
    projects: [conflictTarget],
  };
  assert.equal(
    parseValidatedCandidateSet([validClient], [forgedConflict], conflictSnapshot).projects[0]
      ?.action,
    'conflict',
  );
  assert.equal(
    applyExistingSnapshot([validClient], [forgedConflict], conflictSnapshot).projects[0]?.action,
    'conflict',
  );
  const conflictBinding = fabricatedBinding(conflictSnapshot, [validClient], [forgedConflict]);
  assert.throws(
    () =>
      applyReviewedResolutions(
        documentFor(conflictBinding),
        conflictBinding,
        conflictSnapshot,
        [validClient],
        [forgedConflict],
        [],
      ),
    /P011_SOURCE_PROVENANCE_REQUIRED/u,
  );
  assert.throws(
    () =>
      applyReviewedResolutions(
        documentFor(conflictBinding, [
          {
            type: 'project',
            candidate_id: forgedConflict.candidate_id,
            candidate_hash: forgedConflict.hash,
            approved_name: 'Tentativa sem autorização',
          },
        ]),
        conflictBinding,
        conflictSnapshot,
        [validClient],
        [forgedConflict],
        [],
      ),
    /PROJECT_NAME_NOT_REVIEWABLE/u,
  );

  const existingClient = withHash({
    ...validClient,
    action: 'no_op',
    matched_client_id: existingClientId,
  });
  const equivalentConflict = withHash({
    ...forgedConflict,
    client_id: existingClientId,
    project_name_proposal: conflictTarget.project_name,
  });
  const equivalentSnapshot: ExistingSnapshot = {
    ...conflictSnapshot,
    clients: conflictSnapshot.clients.map((client) => ({
      ...client,
      legal_name: validClient.normalized_name,
      display_name: validClient.normalized_name,
    })),
  };
  assert.throws(
    () => parseValidatedCandidateSet([existingClient], [equivalentConflict], equivalentSnapshot),
    /PROJECT_CONFLICT_UNPROVEN/u,
  );
  assert.throws(
    () =>
      parseValidatedCandidateSet([validClient], [forgedConflict], {
        ...conflictSnapshot,
        projects: [],
      }),
    /PROJECT_CONFLICT_UNPROVEN/u,
  );

  const duplicateConflict = withHash({
    ...insertProject,
    action: 'conflict',
    diagnostic_codes: ['PROJECT_DUPLICATE_CONFLICT'],
  });
  const duplicateSnapshot: ExistingSnapshot = {
    ...conflictSnapshot,
    projects: [conflictTarget, { ...conflictTarget, id: '00000000-0000-4000-8000-000000000102' }],
  };
  assert.equal(
    parseValidatedCandidateSet([validClient], [duplicateConflict], duplicateSnapshot).projects[0]
      ?.action,
    'conflict',
  );

  const ambiguousProject = lineageProject({
    client_match_key: ambiguousA.match_key,
    client_candidate_id: ambiguousA.candidate_id,
    client_id: null,
    data_reference_date: '2024-01-01',
    action: 'rejected',
    diagnostic_codes: ['PROJECT_CLIENT_UNRESOLVED'],
  });
  assert.equal(
    parseValidatedCandidateSet([ambiguousA, ambiguousB], [ambiguousProject], snapshot).projects[0]
      ?.action,
    'rejected',
  );
  const rejectedBinding = fabricatedBinding(snapshot, [ambiguousA, ambiguousB], [ambiguousProject]);
  assert.throws(
    () =>
      applyReviewedResolutions(
        documentFor(rejectedBinding),
        rejectedBinding,
        snapshot,
        [ambiguousA, ambiguousB],
        [ambiguousProject],
        [],
      ),
    /P011_SOURCE_PROVENANCE_REQUIRED/u,
  );
  const clientResolutionConflictSnapshot: ExistingSnapshot = {
    ...conflictSnapshot,
    clients: [],
  };
  const clientResolutionConflictBinding = fabricatedBinding(
    clientResolutionConflictSnapshot,
    [ambiguousA, ambiguousB],
    [ambiguousProject],
  );

  const remainingBlocker = withHash({
    ...ambiguousProject,
    currency: null,
    diagnostic_codes: ['PROJECT_CLIENT_UNRESOLVED', 'PROJECT_CURRENCY_UNRESOLVED'],
  });
  const remainingBinding = fabricatedBinding(
    snapshot,
    [ambiguousA, ambiguousB],
    [remainingBlocker],
  );

  const reviewableRejected = withHash({
    ...ambiguousProject,
    project_name_mapping_status: 'pending_decision',
    operational_status: null,
  });
  const reviewableRejectedBinding = fabricatedBinding(
    snapshot,
    [ambiguousA, ambiguousB],
    [reviewableRejected],
  );
  assert.ok(clientResolutionConflictBinding.candidate_set_hash);
  assert.ok(remainingBinding.candidate_set_hash);
  assert.ok(reviewableRejectedBinding.candidate_set_hash);

  const pending = lineageProject({
    client_match_key: validClient.match_key,
    client_candidate_id: validClient.candidate_id,
    client_id: null,
    project_name_mapping_status: 'pending_decision',
    action: 'pending_decision',
    diagnostic_codes: ['PROJECT_DATA_REFERENCE_DATE_MISSING'],
  });
  assert.equal(
    parseValidatedCandidateSet([validClient], [pending]).projects[0]?.action,
    'pending_decision',
  );
  assert.throws(
    () =>
      parseValidatedCandidateSet(
        [],
        [
          withHash({
            ...insertProject,
            action: 'rejected',
            diagnostic_codes: ['RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE'],
          }),
        ],
      ),
    /PROJECT_SEMANTIC_INVARIANT/u,
  );
  assert.throws(
    () =>
      parseValidatedCandidateSet(
        [],
        [withHash({ ...insertProject, action: 'pending_decision', diagnostic_codes: [] })],
      ),
    /PROJECT_SEMANTIC_INVARIANT/u,
  );
});

test('D102 deriva blockers e reconcilia client insert contra candidate set e snapshot', () => {
  const snapshot = emptySnapshot();
  const withHash = <T extends ClientCandidate | ProjectCandidate>(candidate: T): T => ({
    ...candidate,
    hash: sha256Canonical({ ...candidate, hash: undefined }),
  });
  const documentFor = (
    binding: ReviewBinding,
    resolutions: ReviewedResolution[] = [],
  ): ReviewedResolutionDocument => ({
    contract: 'ltcm.p011.reviewed-resolutions.v1',
    normalizer_version: binding.normalizer_version,
    normalization_manifest_hash: binding.normalization_manifest_hash,
    p010_manifest_hash: binding.p010_manifest_hash,
    input_hash: binding.input_hash,
    snapshot_hash: binding.snapshot_hash,
    candidate_set_hash: binding.candidate_set_hash,
    resolutions,
  });
  const client = integrityClient({
    status: 'valid',
    action: 'insert',
    possible_matches: [],
    diagnostic_codes: [],
  });
  const project = lineageProject({
    client_match_key: client.match_key,
    client_candidate_id: client.candidate_id,
    client_id: null,
    data_reference_date: '2024-01-01',
    diagnostic_codes: [],
  });

  assert.equal(
    parseValidatedCandidateSet([client], [project], snapshot).clients[0]?.action,
    'insert',
  );
  const zeroMatchBinding = fabricatedBinding(snapshot, [client], [project]);
  assert.throws(
    () =>
      applyReviewedResolutions(
        documentFor(zeroMatchBinding),
        zeroMatchBinding,
        snapshot,
        [client],
        [project],
        [],
      ),
    /P011_SOURCE_PROVENANCE_REQUIRED/u,
  );

  const existingClientId = '00000000-0000-4000-8000-000000000102';
  const existingClient = {
    id: existingClientId,
    legal_name: client.normalized_name,
    display_name: client.normalized_name,
    tax_id: null,
    active: true,
    deleted_at: null,
    row_version: 1,
  };
  const oneMatchSnapshot: ExistingSnapshot = { ...snapshot, clients: [existingClient] };
  const oneMatchBefore = canonicalJson({ client, oneMatchSnapshot });
  assert.throws(
    () => parseValidatedCandidateSet([client], [], oneMatchSnapshot),
    /CLIENT_DERIVED_STATE_MISMATCH/u,
  );
  assert.throws(
    () =>
      createReviewBinding(
        NORMALIZER_VERSION,
        'a'.repeat(64),
        'b'.repeat(64),
        oneMatchSnapshot,
        [client],
        [],
      ),
    /CLIENT_DERIVED_STATE_MISMATCH/u,
  );
  const reconciled = applyExistingSnapshot([client], [], oneMatchSnapshot);
  assert.equal(reconciled.clients[0]?.action, 'no_op');
  assert.equal(reconciled.clients[0]?.matched_client_id, existingClientId);
  const reconciledBinding = fabricatedBinding(oneMatchSnapshot, reconciled.clients, []);
  assert.throws(
    () =>
      applyReviewedResolutions(
        documentFor(reconciledBinding),
        reconciledBinding,
        oneMatchSnapshot,
        reconciled.clients,
        [],
        [],
      ),
    /P011_SOURCE_PROVENANCE_REQUIRED/u,
  );
  assert.equal(canonicalJson({ client, oneMatchSnapshot }), oneMatchBefore);

  for (const invalidSnapshot of [
    { ...snapshot, clients: [{ ...existingClient, active: false }] },
    { ...snapshot, clients: [{ ...existingClient, deleted_at: '2026-08-13' }] },
    {
      ...snapshot,
      clients: [existingClient, { ...existingClient, id: '00000000-0000-4000-8000-000000000103' }],
    },
  ] as ExistingSnapshot[]) {
    assert.throws(
      () => applyExistingSnapshot([client], [], invalidSnapshot),
      /CLIENT_SNAPSHOT_MATCH_(?:UNAVAILABLE|AMBIGUOUS)/u,
    );
  }

  const familyA = integrityClient({
    candidate_id: createClientCandidateId('cliente d102 unidade a'),
    client_ref: 'client-d102-a',
    raw_names: ['Cliente D102 unidade A'],
    normalized_name: 'Cliente D102 unidade A',
    match_key: 'cliente d102 unidade a',
    status: 'valid',
    action: 'insert',
    possible_matches: [],
    diagnostic_codes: [],
  });
  const familyB = integrityClient({
    candidate_id: createClientCandidateId('cliente d102 unidade b'),
    client_ref: 'client-d102-b',
    raw_names: ['Cliente D102 unidade B'],
    normalized_name: 'Cliente D102 unidade B',
    match_key: 'cliente d102 unidade b',
    status: 'valid',
    action: 'insert',
    possible_matches: [],
    diagnostic_codes: [],
  });
  for (const clients of [
    [familyA, familyB],
    [familyB, familyA],
  ]) {
    assert.throws(
      () => parseValidatedCandidateSet(clients, [], snapshot),
      /CLIENT_AMBIGUITY_UNPROVEN/u,
    );
    assert.throws(
      () =>
        createReviewBinding(
          NORMALIZER_VERSION,
          'a'.repeat(64),
          'b'.repeat(64),
          snapshot,
          clients,
          [],
        ),
      /CLIENT_AMBIGUITY_UNPROVEN/u,
    );
  }

  const d02 = lineageProject({
    candidate_id: createProjectCandidateId('2026-04-16531'),
    raw_codes: ['2026-04-16531'],
    project_code: '2026-04-16531',
    client_match_key: client.match_key,
    client_candidate_id: client.candidate_id,
    client_id: null,
    contract_value: '168000',
    data_reference_date: '2024-01-01',
    action: 'insert',
    diagnostic_codes: [],
  });
  const validD02 = lineageProject({
    ...d02,
    contract_value: '164000',
    value_evidence: d02.value_evidence.map((evidence) => ({
      ...evidence,
      raw_number: 164000,
      decimal_round_trip_string: '164000',
      formatted_text: '164000',
    })),
  });
  const d06 = lineageProject({
    candidate_id: createProjectCandidateId('2099-01-00006'),
    raw_codes: ['2099-01-00006'],
    project_code: '2099-01-00006',
    client_match_key: client.match_key,
    client_candidate_id: client.candidate_id,
    client_id: null,
    raw_classifications: ['demanda', 'saldo'],
    classification: 'full_contract',
    data_reference_date: '2024-01-01',
    action: 'insert',
    diagnostic_codes: [],
  });
  const invalidProjects = [
    [d02, /PROJECT_DERIVED_STATE_MISMATCH/u],
    [d06, /PROJECT_CLASSIFICATION_DERIVATION_MISMATCH/u],
    [withHash({ ...project, origins: [] }), /CANDIDATE_ORIGIN_MISSING/u],
    [withHash({ ...project, value_evidence: [] }), /PROJECT_VALUE_EVIDENCE_UNPROVEN/u],
  ] as Array<[ProjectCandidate, RegExp]>;
  for (const [invalidProject, pattern] of invalidProjects) {
    const before = canonicalJson({ client, invalidProject, snapshot });
    assert.throws(() => parseValidatedCandidateSet([client], [invalidProject], snapshot), pattern);
    assert.throws(
      () =>
        createReviewBinding(
          NORMALIZER_VERSION,
          'a'.repeat(64),
          'b'.repeat(64),
          snapshot,
          [client],
          [invalidProject],
        ),
      pattern,
    );
    assert.throws(() => applyExistingSnapshot([client], [invalidProject], snapshot), pattern);
    let summaryCreated = false;
    assert.throws(() => {
      const result = applyReviewedResolutions(
        documentFor(zeroMatchBinding),
        zeroMatchBinding,
        snapshot,
        [client],
        [invalidProject],
        [],
      );
      summaryCreated = result.summary !== undefined;
    }, pattern);
    assert.equal(summaryCreated, false);
    assert.equal(canonicalJson({ client, invalidProject, snapshot }), before);
  }
  assert.equal(
    parseValidatedCandidateSet([client], [validD02], snapshot).projects[0]?.action,
    'insert',
  );
  const validD06 = lineageProject({
    ...d06,
    raw_classifications: ['demanda'],
    classification: 'demand',
  });
  assert.equal(
    parseValidatedCandidateSet([client], [validD06], snapshot).projects[0]?.action,
    'insert',
  );

  const otherSourceClient = withHash({ ...client, source_manifest_hash: 'c'.repeat(64) });
  const otherSourceProject = withHash({ ...project, source_manifest_hash: 'c'.repeat(64) });
  assert.equal(
    parseValidatedCandidateSet([otherSourceClient], [otherSourceProject], snapshot).projects.length,
    1,
  );
  assert.throws(
    () =>
      createReviewBinding(
        NORMALIZER_VERSION,
        'a'.repeat(64),
        'b'.repeat(64),
        snapshot,
        [otherSourceClient],
        [otherSourceProject],
      ),
    /CANDIDATE_SOURCE_MANIFEST_MISMATCH: binding/u,
  );

  const ambiguousA = withHash({
    ...familyA,
    status: 'ambiguous' as const,
    action: 'conflict' as const,
    possible_matches: [familyB.client_ref],
    diagnostic_codes: ['CLIENT_MATCH_AMBIGUOUS'],
  });
  const ambiguousB = withHash({
    ...familyB,
    status: 'ambiguous' as const,
    action: 'conflict' as const,
    possible_matches: [familyA.client_ref],
    diagnostic_codes: ['CLIENT_MATCH_AMBIGUOUS'],
  });
  const createNewSnapshot: ExistingSnapshot = {
    ...snapshot,
    clients: [
      {
        ...existingClient,
        legal_name: ambiguousA.normalized_name,
        display_name: ambiguousA.normalized_name,
      },
    ],
  };
  const ambiguityBinding = fabricatedBinding(createNewSnapshot, [ambiguousA, ambiguousB], []);
  const createNewResolution: ReviewedResolution = {
    type: 'client_identity',
    candidate_id: ambiguousA.candidate_id,
    candidate_hash: ambiguousA.hash,
    identity: { kind: 'create_new' },
  };
  let createNewSummary = false;
  assert.throws(() => {
    const result = applyReviewedResolutions(
      documentFor(ambiguityBinding, [createNewResolution]),
      ambiguityBinding,
      createNewSnapshot,
      [ambiguousA, ambiguousB],
      [],
      [],
    );
    createNewSummary = result.summary !== undefined;
  }, /P011_SOURCE_PROVENANCE_REQUIRED/u);
  assert.equal(createNewSummary, false);

  assert.throws(
    () =>
      applyReviewedResolutions(
        documentFor(ambiguityBinding, [
          {
            ...createNewResolution,
            identity: { kind: 'use_existing', client_id: existingClientId },
          },
        ]),
        ambiguityBinding,
        createNewSnapshot,
        [ambiguousA, ambiguousB],
        [],
        [],
      ),
    /P011_SOURCE_PROVENANCE_REQUIRED/u,
  );
});

test('D104 exige provenance runtime opaca e deriva currency sem escolha do caller', async () => {
  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const snapshot = emptySnapshot();
    const valid = normalizeP011(source, snapshot, '1970-01-01T00:00:00.000Z');
    assert.equal(valid.manifest['review_binding'] !== undefined, true);

    for (const reconstructed of [
      { ...source },
      Object.assign({}, source),
      JSON.parse(JSON.stringify(source)) as unknown,
      createValidatedSourceView(source),
    ]) {
      assert.throws(
        () =>
          normalizeP011(
            reconstructed as Parameters<typeof normalizeP011>[0],
            snapshot,
            '1970-01-01T00:00:00.000Z',
          ),
        /P011_SOURCE_PROVENANCE_REQUIRED/u,
      );
    }

    const originalManifestHash = source.manifestHash;
    source.manifestHash = 'f'.repeat(64);
    assert.equal(
      canonicalJson(normalizeP011(source, snapshot, '1970-01-01T00:00:00.000Z')),
      canonicalJson(valid),
    );
    source.manifestHash = originalManifestHash;

    const sourceRow = source.rows.get('monthly_revenue')?.[3];
    const sourceCell = sourceRow?.raw_payload.cells.find((candidate) => candidate.address === 'C4');
    assert.ok(sourceRow && sourceCell);
    const originalCellValue = sourceCell.value;
    const originalRowHash = sourceRow.row_hash;
    sourceCell.value = 'Cliente adulterado (demanda)';
    sourceRow.row_hash = sha256Canonical(sourceRow.raw_payload);
    assert.equal(
      canonicalJson(normalizeP011(source, snapshot, '1970-01-01T00:00:00.000Z')),
      canonicalJson(valid),
    );
    sourceCell.value = originalCellValue;
    sourceRow.row_hash = originalRowHash;

    const manualClients = structuredClone(valid.clients);
    const manualProjects = structuredClone(valid.projects);
    const project = manualProjects.find((candidate) => candidate.project_code === '2026-01-15797');
    assert.ok(project);
    project.raw_classifications = ['Contrato integral'];
    project.classification = 'full_contract';
    project.hash = sha256Canonical({ ...project, hash: undefined });
    const before = canonicalJson({ manualClients, manualProjects, snapshot });
    assert.throws(
      () =>
        createReviewBinding(
          {},
          NORMALIZER_VERSION,
          valid.manifest['p010_manifest_hash'],
          valid.manifest['input_hash'],
          snapshot,
          manualClients,
          manualProjects,
        ),
      /P011_SOURCE_PROVENANCE_REQUIRED/u,
    );

    const forgedBinding = fabricatedBinding(
      snapshot,
      manualClients,
      manualProjects,
      valid.manifest['p010_manifest_hash'] as string,
      valid.manifest['input_hash'] as string,
    );
    const forgedDocument: ReviewedResolutionDocument = {
      contract: 'ltcm.p011.reviewed-resolutions.v1',
      normalizer_version: forgedBinding.normalizer_version,
      normalization_manifest_hash: forgedBinding.normalization_manifest_hash,
      p010_manifest_hash: forgedBinding.p010_manifest_hash,
      input_hash: forgedBinding.input_hash,
      snapshot_hash: forgedBinding.snapshot_hash,
      candidate_set_hash: forgedBinding.candidate_set_hash,
      resolutions: [],
    };
    let summaryCreated = false;
    assert.throws(() => {
      const result = applyReviewedResolutions(
        {},
        forgedDocument,
        forgedBinding,
        snapshot,
        manualClients,
        manualProjects,
        [],
      );
      summaryCreated = result.summary !== undefined;
    }, /P011_SOURCE_PROVENANCE_REQUIRED/u);
    assert.equal(summaryCreated, false);
    assert.equal(canonicalJson({ manualClients, manualProjects, snapshot }), before);

    const client = integrityClient({
      status: 'valid',
      action: 'insert',
      possible_matches: [],
      diagnostic_codes: [],
    });
    const unresolvedCurrency = lineageProject({
      client_match_key: client.match_key,
      client_candidate_id: client.candidate_id,
      client_id: null,
      currency: null,
      data_reference_date: '2024-01-01',
      action: 'rejected',
      diagnostic_codes: ['PROJECT_CURRENCY_UNRESOLVED'],
    });
    assert.equal(
      parseValidatedCandidateSet([client], [unresolvedCurrency], snapshot).projects[0]?.action,
      'rejected',
    );
    for (const diagnostic of ['PROJECT_CURRENCY_MISSING', 'PROJECT_CURRENCY_AMBIGUOUS']) {
      const callerSelected = {
        ...unresolvedCurrency,
        diagnostic_codes: [diagnostic],
      };
      callerSelected.hash = sha256Canonical({ ...callerSelected, hash: undefined });
      assert.throws(
        () => parseValidatedCandidateSet([client], [callerSelected], snapshot),
        /PROJECT_SEMANTIC_INVARIANT/u,
      );
    }
  });

  await withFixture(
    async (root) => {
      const result = normalizeP011(
        await loadP010Source(root),
        emptySnapshot(),
        '1970-01-01T00:00:00.000Z',
      );
      const project = result.projects.find(
        (candidate) => candidate.project_code === '2024-10-12524',
      );
      assert.equal(project?.currency, null);
      assert.ok(project?.diagnostic_codes.includes('PROJECT_CURRENCY_UNRESOLVED'));
      assert.ok(!project?.diagnostic_codes.includes('PROJECT_CURRENCY_AMBIGUOUS'));
    },
    (rows) => {
      const row = rows.get('monthly_revenue')?.[3];
      const currency = row?.raw_payload.cells.find((candidate) => candidate.address === 'H4');
      assert.ok(currency);
      currency.value = 'USD';
    },
  );
});

test('D106 usa uma unica materializacao privada apesar de views publicas divergentes', async () => {
  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const snapshot = emptySnapshot();
    const expected = normalizeP011(source, snapshot, '1970-01-01T00:00:00.000Z');
    const expectedBytes = canonicalJson(expected);
    const publicRows = source.rows;
    const originalMonthly = Map.prototype.get.call(publicRows, 'monthly_revenue') as P010Row[];
    const forgedMonthly = structuredClone(originalMonthly);
    const forgedRow = forgedMonthly[45];
    const forgedCell = forgedRow?.raw_payload.cells.find(
      (candidate) => candidate.address === 'C46',
    );
    assert.ok(forgedRow && forgedCell);
    assert.equal(forgedCell.value, 'Empresa Unidade A (demanda)');
    forgedCell.value = 'Empresa Unidade A (saldo)';
    forgedRow.row_hash = sha256Canonical(forgedRow.raw_payload);

    const forgedRows = new Map<SheetKey, P010Row[]>(
      [...(Map.prototype.entries.call(publicRows) as IterableIterator<[SheetKey, P010Row[]]>)].map(
        ([key, rows]) => [key, key === 'monthly_revenue' ? forgedMonthly : rows],
      ),
    );
    const assertOriginalFacts = (): void => {
      const actual = normalizeP011(source, snapshot, '1970-01-01T00:00:00.000Z');
      assert.equal(canonicalJson(actual), expectedBytes);
      assert.equal(
        actual.projects.find((candidate) => candidate.project_code === '2026-01-15797')
          ?.classification,
        'demand',
      );
      assert.equal(actual.manifest['review_binding'] !== undefined, true);
      assert.equal(actual.resolutionSummary, undefined);
    };

    Object.defineProperty(publicRows, 'get', {
      configurable: true,
      value: (key: SheetKey) => Map.prototype.get.call(forgedRows, key) as P010Row[] | undefined,
    });
    assert.equal(
      publicRows
        .get('monthly_revenue')?.[45]
        ?.raw_payload.cells.find((candidate) => candidate.address === 'C46')?.value,
      'Empresa Unidade A (saldo)',
    );
    assertOriginalFacts();

    Object.defineProperty(publicRows, 'entries', {
      configurable: true,
      value: () =>
        Map.prototype.entries.call(forgedRows) as IterableIterator<[SheetKey, P010Row[]]>,
    });
    assertOriginalFacts();

    source.rows = forgedRows;
    assertOriginalFacts();

    const publicOriginalRow = originalMonthly[45];
    const publicOriginalCell = publicOriginalRow?.raw_payload.cells.find(
      (candidate) => candidate.address === 'C46',
    );
    assert.ok(publicOriginalRow && publicOriginalCell);
    publicOriginalCell.value = 'Empresa Unidade A (contrato)';
    publicOriginalRow.row_hash = sha256Canonical(publicOriginalRow.raw_payload);
    Map.prototype.set.call(publicRows, 'monthly_revenue', forgedMonthly);
    source.manifest = { artifact_contract: 'caller-owned' };
    source.manifestHash = 'f'.repeat(64);
    source.workbookHash = 'e'.repeat(64);
    source.inputHashes = { 'caller-owned.json': 'd'.repeat(64) };
    assertOriginalFacts();

    for (const reconstructed of [
      { ...source },
      Object.assign({}, source),
      JSON.parse(JSON.stringify(source)) as unknown,
    ]) {
      assert.throws(
        () =>
          normalizeP011(
            reconstructed as Parameters<typeof normalizeP011>[0],
            snapshot,
            '1970-01-01T00:00:00.000Z',
          ),
        /P011_SOURCE_PROVENANCE_REQUIRED/u,
      );
    }
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
  await withFixture(
    async (root) => {
      const source = await loadP010Source(root);
      const result = normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z');
      const d02 = result.projects.find((candidate) => candidate.project_code === '2026-04-16531');
      const dependent = result.projects.find(
        (candidate) => candidate.project_code === '2025-08-14656',
      );
      assert.equal(d02?.contract_value, null);
      assert.ok(d02?.diagnostic_codes.includes('PROJECT_VALUE_CONFLICT'));
      assert.equal(dependent?.action, 'rejected');
      assert.ok(dependent?.diagnostic_codes.includes('PROJECT_CURRENCY_UNRESOLVED'));
      assert.ok(dependent?.diagnostic_codes.includes('PROJECT_CLIENT_UNRESOLVED'));
      assert.equal(
        result.projects.find((candidate) => candidate.project_code === '2024-10-12524')?.action,
        'pending_decision',
      );
    },
    (rows) => {
      const projectRows = rows.get('project_values') ?? [];
      const value = projectRows[2]?.raw_payload.cells.find(
        (candidate) => candidate.address === 'K3',
      );
      assert.ok(value);
      value.value = 168000;
      value.round_trip_text = '168000';
      const monthlyRows = rows.get('monthly_revenue') ?? [];
      const betaRow = monthlyRows[48];
      assert.ok(betaRow);
      const currency = betaRow.raw_payload.cells.find((candidate) => candidate.address === 'H49');
      const client = betaRow.raw_payload.cells.find((candidate) => candidate.address === 'C49');
      assert.ok(currency && client);
      currency.value = null;
      client.value = null;
    },
  );
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
    project.legacy_import_batch_reference = null;
    project.action = 'insert';
    project.diagnostic_codes = project.diagnostic_codes.filter(
      (code) => code !== 'PROJECT_DATA_REFERENCE_DATE_MISSING',
    );
    const snapshot: ExistingSnapshot = {
      contract: 'ltcm.p011.existing-snapshot.v3',
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
      import_batches: [],
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
    project.hash = sha256Canonical({ ...project, hash: undefined });
    const applied = applyExistingSnapshot(result.clients, result.projects, snapshot);
    const appliedClient = applied.clients.find(
      (candidate) => candidate.candidate_id === client.candidate_id,
    );
    const appliedProject = applied.projects.find(
      (candidate) => candidate.candidate_id === project.candidate_id,
    );
    assert.equal(appliedClient?.action, 'no_op');
    assert.equal(appliedProject?.action, 'no_op');
    assert.equal(client.action, 'insert');
    assert.equal(project.action, 'insert');
    assert.ok(appliedProject);
    appliedProject.contract_value = '1001';
    appliedProject.value_evidence = appliedProject.value_evidence.map((evidence) => ({
      ...evidence,
      raw_number: 1001,
      decimal_round_trip_string: '1001',
      formatted_text: '1001',
    }));
    appliedProject.action = 'insert';
    appliedProject.hash = sha256Canonical({ ...appliedProject, hash: undefined });
    const conflicted = applyExistingSnapshot(applied.clients, applied.projects, snapshot);
    const conflictedProject = conflicted.projects.find(
      (candidate) => candidate.candidate_id === project.candidate_id,
    );
    assert.equal(conflictedProject?.action, 'conflict');
    assert.ok(conflictedProject?.diagnostic_codes.includes('PROTECTED_RECORD_CONFLICT'));
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

test('contrato de resoluções revisadas é estrito, versionado e aceita somente campos autorizados', async (context) => {
  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const base = normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z');
    const project = base.projects.find((candidate) => candidate.project_code === '2025-08-14656');
    assert.ok(project);
    const valid = reviewedDocument(base, [
      {
        type: 'project',
        candidate_id: project.candidate_id,
        candidate_hash: project.hash,
        approved_name: 'Projeto sintético aprovado',
        approved_status: 'active',
      },
    ]);
    assert.deepEqual(parseReviewedResolutionDocument(valid), valid);

    await context.test('nomes Unicode legítimos permanecem aceitos', () => {
      for (const approvedName of ['Projeto ASCII', 'Projeto Ação São José', 'Projeto Ωmega 東京']) {
        const document = structuredClone(valid);
        const resolution = document.resolutions[0];
        assert.equal(resolution?.type, 'project');
        if (resolution?.type === 'project') resolution.approved_name = approvedName;
        assert.deepEqual(parseReviewedResolutionDocument(document), document);
      }
    });
    for (const [label, approvedName] of [
      ['bidi override U+202E', 'A\u202eB'],
      ['zero width space U+200B', 'A\u200bB'],
      ['bidi isolate U+2066', 'A\u2066B'],
      ['pop bidi isolate U+2069', 'A\u2069B'],
      ['controle C0', 'A\u0007B'],
      ['somente whitespace/invisível', ' \u200b '],
    ] as const) {
      await context.test(`approved_name rejeita ${label}`, () => {
        const document = structuredClone(valid);
        const resolution = document.resolutions[0];
        assert.equal(resolution?.type, 'project');
        if (resolution?.type === 'project') resolution.approved_name = approvedName;
        assert.throws(() => parseReviewedResolutionDocument(document), /approved_name/u);
      });
    }

    await context.test('versão inválida', () => {
      assert.throws(
        () => parseReviewedResolutionDocument({ ...valid, contract: 'invalid.v2' }),
        /incompatível/u,
      );
    });
    await context.test('status fora do enum', () => {
      const invalid = structuredClone(valid) as unknown as Record<string, unknown>;
      (invalid['resolutions'] as Array<Record<string, unknown>>)[0]!['approved_status'] = 'deleted';
      assert.throws(() => parseReviewedResolutionDocument(invalid), /approved_status/u);
    });
    await context.test('campo não autorizado', () => {
      const invalid = structuredClone(valid) as unknown as Record<string, unknown>;
      (invalid['resolutions'] as Array<Record<string, unknown>>)[0]!['currency'] = 'USD';
      assert.throws(() => parseReviewedResolutionDocument(invalid), /não autorizados=currency/u);
    });
    await context.test('identidade de cliente inválida', () => {
      const invalid = structuredClone(valid) as unknown as Record<string, unknown>;
      invalid['resolutions'] = [
        {
          type: 'client_identity',
          candidate_id: SYNTHETIC_CLIENT_CANDIDATE_ID,
          candidate_hash: 'a'.repeat(64),
          identity: { kind: 'use_existing', client_id: 'invalid' },
        },
      ];
      assert.throws(() => parseReviewedResolutionDocument(invalid), /UUID inválido/u);
    });
  });
});

test('binding rejeita replay, candidato adulterado, inexistente e resolução duplicada', async (context) => {
  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const base = normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z');
    const project = base.projects.find((candidate) => candidate.project_code === '2025-08-14656');
    assert.ok(project);
    const entry: ReviewedResolution = {
      type: 'project',
      candidate_id: project.candidate_id,
      candidate_hash: project.hash,
      approved_name: 'Projeto sintético aprovado',
    };
    const valid = reviewedDocument(base, [entry]);

    await context.test('outro manifesto de normalização', () => {
      assert.throws(
        () =>
          normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z', {
            ...valid,
            normalization_manifest_hash: '0'.repeat(64),
          }),
        /BINDING_MISMATCH: normalization_manifest_hash/u,
      );
    });
    await context.test('outro manifesto', () => {
      assert.throws(
        () =>
          normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z', {
            ...valid,
            p010_manifest_hash: '0'.repeat(64),
          }),
        /BINDING_MISMATCH: p010_manifest_hash/u,
      );
    });
    await context.test('outro conjunto de candidatos', () => {
      assert.throws(
        () =>
          normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z', {
            ...valid,
            candidate_set_hash: '0'.repeat(64),
          }),
        /BINDING_MISMATCH: candidate_set_hash/u,
      );
    });
    await context.test('candidato alterado depois da revisão', () => {
      assert.throws(
        () =>
          normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z', {
            ...valid,
            resolutions: [{ ...entry, candidate_hash: '0'.repeat(64) }],
          }),
        /CANDIDATE_HASH_MISMATCH/u,
      );
    });
    await context.test('candidato inexistente', () => {
      assert.throws(
        () =>
          normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z', {
            ...valid,
            resolutions: [{ ...entry, candidate_id: `project-${'f'.repeat(24)}` }],
          }),
        /CANDIDATE_NOT_FOUND/u,
      );
    });
    await context.test('resolução duplicada', () => {
      assert.throws(
        () =>
          normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z', {
            ...valid,
            resolutions: [entry, entry],
          }),
        /RESOLUTION_DUPLICATE/u,
      );
    });
  });
});

test('binding inclui snapshot canônico, rejeita replay e ignora ordem incidental', async () => {
  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const clientA = {
      id: '00000000-0000-4000-8000-000000000071',
      legal_name: 'Cliente sintético externo A',
      display_name: 'Cliente sintético externo A',
      tax_id: null,
      active: true,
      deleted_at: null,
      row_version: 1,
    };
    const clientB = {
      ...clientA,
      id: '00000000-0000-4000-8000-000000000072',
      legal_name: 'Cliente sintético externo B',
      display_name: 'Cliente sintético externo B',
    };
    const snapshotA: ExistingSnapshot = {
      ...emptySnapshot(),
      currencies: [
        { code: 'ZZZ', active: true },
        { code: 'YYY', active: false },
      ],
      clients: [clientA, clientB],
    };
    const reordered: ExistingSnapshot = {
      ...snapshotA,
      currencies: [...snapshotA.currencies].reverse(),
      clients: [...snapshotA.clients].reverse(),
    };
    const snapshotB: ExistingSnapshot = {
      ...snapshotA,
      clients: snapshotA.clients.map((client) =>
        client.id === clientA.id ? { ...client, active: false } : client,
      ),
    };
    assert.equal(createSnapshotHash(snapshotA), createSnapshotHash(reordered));
    assert.notEqual(createSnapshotHash(snapshotA), createSnapshotHash(snapshotB));
    const base = normalizeP011(source, snapshotA, '1970-01-01T00:00:00.000Z');
    const project = base.projects.find((candidate) => candidate.project_code === '2025-08-14656');
    assert.ok(project);
    const document = reviewedDocument(base, [
      {
        type: 'project',
        candidate_id: project.candidate_id,
        candidate_hash: project.hash,
        approved_name: 'Projeto sintético aprovado',
      },
    ]);
    assert.throws(
      () => normalizeP011(source, snapshotB, '1970-01-01T00:00:00.000Z', document),
      /BINDING_MISMATCH: snapshot_hash/u,
    );
    assert.doesNotThrow(() =>
      normalizeP011(source, reordered, '1970-01-01T00:00:00.000Z', document),
    );
  });
});

test('identidade revisada exige evidência compatível do snapshot para use_existing', async () => {
  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const base = normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z');
    const ambiguous = base.clients.find((candidate) => candidate.status === 'ambiguous');
    const validClient = base.clients.find((candidate) => candidate.status === 'valid');
    assert.ok(ambiguous && validClient);
    const createNew = normalizeP011(
      source,
      emptySnapshot(),
      '1970-01-01T00:00:00.000Z',
      reviewedDocument(base, [
        {
          type: 'client_identity',
          candidate_id: ambiguous.candidate_id,
          candidate_hash: ambiguous.hash,
          identity: { kind: 'create_new' },
        },
      ]),
    );
    assert.equal(
      createNew.clients.find((candidate) => candidate.candidate_id === ambiguous.candidate_id)
        ?.action,
      'insert',
    );

    const existingId = '00000000-0000-4000-8000-000000000069';
    assert.throws(
      () =>
        normalizeP011(
          source,
          emptySnapshot(),
          '1970-01-01T00:00:00.000Z',
          reviewedDocument(base, [
            {
              type: 'client_identity',
              candidate_id: ambiguous.candidate_id,
              candidate_hash: ambiguous.hash,
              identity: { kind: 'use_existing', client_id: existingId },
            },
          ]),
        ),
      /SNAPSHOT_INSUFFICIENT/u,
    );
    const compatibleSnapshot: ExistingSnapshot = {
      ...emptySnapshot(),
      clients: [
        {
          id: existingId,
          legal_name: ambiguous.normalized_name,
          display_name: ambiguous.normalized_name,
          tax_id: null,
          active: true,
          deleted_at: null,
          row_version: 1,
        },
      ],
    };
    const compatibleBase = normalizeP011(source, compatibleSnapshot, '1970-01-01T00:00:00.000Z');
    const compatibleCandidate = compatibleBase.clients.find(
      (candidate) => candidate.candidate_id === ambiguous.candidate_id,
    );
    assert.ok(compatibleCandidate);
    const useExisting = normalizeP011(
      source,
      compatibleSnapshot,
      '1970-01-01T00:00:00.000Z',
      reviewedDocument(compatibleBase, [
        {
          type: 'client_identity',
          candidate_id: compatibleCandidate.candidate_id,
          candidate_hash: compatibleCandidate.hash,
          identity: { kind: 'use_existing', client_id: existingId },
        },
      ]),
    );
    assert.equal(
      useExisting.clients.find((candidate) => candidate.candidate_id === ambiguous.candidate_id)
        ?.matched_client_id,
      existingId,
    );
    assert.equal(
      useExisting.clients.find(
        (candidate) => candidate.candidate_id === compatibleCandidate.candidate_id,
      )?.action,
      'no_op',
    );
    for (const [snapshot, pattern] of [
      [
        {
          ...compatibleSnapshot,
          clients: [
            { ...compatibleSnapshot.clients[0]!, id: '00000000-0000-4000-8000-000000000070' },
          ],
        },
        /EXISTING_CLIENT_NOT_FOUND/u,
      ],
      [
        {
          ...compatibleSnapshot,
          clients: [
            {
              ...compatibleSnapshot.clients[0]!,
              legal_name: 'Cliente sintético incompatível',
              display_name: 'Cliente sintético incompatível',
            },
          ],
        },
        /EXISTING_CLIENT_INCOMPATIBLE/u,
      ],
      [
        {
          ...compatibleSnapshot,
          clients: [{ ...compatibleSnapshot.clients[0]!, active: false }],
        },
        /EXISTING_CLIENT_INCOMPATIBLE/u,
      ],
      [
        {
          ...compatibleSnapshot,
          clients: [{ ...compatibleSnapshot.clients[0]!, deleted_at: '2026-08-12T00:00:00.000Z' }],
        },
        /EXISTING_CLIENT_INCOMPATIBLE/u,
      ],
    ] as Array<[ExistingSnapshot, RegExp]>) {
      const snapshotBase = normalizeP011(source, snapshot, '1970-01-01T00:00:00.000Z');
      const snapshotCandidate: ClientCandidate | undefined = snapshotBase.clients.find(
        (candidate) => candidate.candidate_id === ambiguous.candidate_id,
      );
      assert.ok(snapshotCandidate);
      assert.throws(
        () =>
          normalizeP011(
            source,
            snapshot,
            '1970-01-01T00:00:00.000Z',
            reviewedDocument(snapshotBase, [
              {
                type: 'client_identity',
                candidate_id: snapshotCandidate.candidate_id,
                candidate_hash: snapshotCandidate.hash,
                identity: { kind: 'use_existing', client_id: existingId },
              },
            ]),
          ),
        pattern,
      );
    }
    assert.throws(
      () =>
        normalizeP011(
          source,
          emptySnapshot(),
          '1970-01-01T00:00:00.000Z',
          reviewedDocument(base, [
            {
              type: 'client_identity',
              candidate_id: validClient.candidate_id,
              candidate_hash: validClient.hash,
              identity: { kind: 'create_new' },
            },
          ]),
        ),
      /CLIENT_NOT_REVIEWABLE/u,
    );
  });
});

test('reconciliação D38 exige evidência única de lote planned para produzir no_op', async () => {
  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const emptyBase = normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z');
    const ambiguous = emptyBase.clients.find((candidate) => candidate.status === 'ambiguous');
    const project = emptyBase.projects.find(
      (candidate) => candidate.client_candidate_id === ambiguous?.candidate_id,
    );
    assert.ok(
      ambiguous && project && project.classification && project.currency && project.contract_value,
    );
    const clientId = '00000000-0000-4000-8000-000000000073';
    const clientSnapshot: ExistingSnapshot = {
      ...emptySnapshot(),
      clients: [
        {
          id: clientId,
          legal_name: ambiguous.normalized_name,
          display_name: ambiguous.normalized_name,
          tax_id: null,
          active: true,
          deleted_at: null,
          row_version: 1,
        },
      ],
    };
    const resolveAgainst = (snapshot: ExistingSnapshot) => {
      const base = normalizeP011(source, snapshot, '1970-01-01T00:00:00.000Z');
      const client = base.clients.find(
        (candidate) => candidate.candidate_id === ambiguous.candidate_id,
      );
      const boundProject = base.projects.find(
        (candidate) => candidate.candidate_id === project.candidate_id,
      );
      assert.ok(client && boundProject);
      const document = reviewedDocument(base, [
        {
          type: 'client_identity',
          candidate_id: client.candidate_id,
          candidate_hash: client.hash,
          identity: { kind: 'use_existing', client_id: clientId },
        },
        {
          type: 'project',
          candidate_id: boundProject.candidate_id,
          candidate_hash: boundProject.hash,
          approved_name: 'Projeto sintético reconciliado',
          approved_status: 'active',
        },
      ]);
      return {
        document,
        result: normalizeP011(source, snapshot, '1970-01-01T00:00:00.000Z', document),
      };
    };
    const withoutExisting = resolveAgainst(clientSnapshot).result.projects.find(
      (candidate) => candidate.candidate_id === project.candidate_id,
    );
    assert.equal(withoutExisting?.action, 'insert');

    const plannedReference = project.legacy_import_batch_reference;
    assert.equal(plannedReference?.kind, 'planned');
    if (plannedReference?.kind !== 'planned') throw new Error('Fixture D38 sem lote planned.');
    const batchId = '00000000-0000-4000-8000-000000000075';
    const existingProject = {
      id: '00000000-0000-4000-8000-000000000074',
      project_code: project.project_code,
      project_name: 'Projeto sintético reconciliado',
      client_id: clientId,
      classification: project.classification,
      status: 'active' as const,
      base_currency: project.currency,
      contract_value: project.contract_value,
      data_reference_date: null,
      legacy_import_batch_id: batchId,
      deleted_at: null,
      version: 1,
    };
    const batchEvidence = {
      id: batchId,
      idempotency_key: plannedReference.idempotency_key,
      source_hash: plannedReference.source_hash,
    };
    const unrelatedBatchEvidence = {
      id: '00000000-0000-4000-8000-000000000077',
      idempotency_key: 'ltcm-p011:' + 'd'.repeat(64),
      source_hash: 'e'.repeat(64),
    };
    const equivalentSnapshot: ExistingSnapshot = {
      ...clientSnapshot,
      import_batches: [batchEvidence, unrelatedBatchEvidence],
      projects: [existingProject],
    };
    const equivalent = resolveAgainst(equivalentSnapshot);
    const reconciled = equivalent.result.projects.find(
      (candidate) => candidate.candidate_id === project.candidate_id,
    );
    assert.equal(reconciled?.action, 'no_op');
    assert.deepEqual(reconciled?.legacy_import_batch_reference, {
      kind: 'existing',
      import_batch_id: batchId,
    });

    const divergentSnapshot: ExistingSnapshot = {
      ...equivalentSnapshot,
      import_batches: [{ ...batchEvidence, source_hash: '0'.repeat(64) }, unrelatedBatchEvidence],
    };
    const divergentIdempotencyKeySnapshot: ExistingSnapshot = {
      ...equivalentSnapshot,
      import_batches: [
        { ...batchEvidence, idempotency_key: 'ltcm-p011:' + '0'.repeat(64) },
        unrelatedBatchEvidence,
      ],
    };
    const absentEvidenceSnapshot: ExistingSnapshot = {
      ...equivalentSnapshot,
      import_batches: [],
    };
    const arbitraryUuidSnapshot: ExistingSnapshot = {
      ...equivalentSnapshot,
      projects: [
        {
          ...existingProject,
          legacy_import_batch_id: '00000000-0000-4000-8000-000000000076',
        },
      ],
    };
    for (const snapshot of [
      divergentSnapshot,
      divergentIdempotencyKeySnapshot,
      absentEvidenceSnapshot,
      arbitraryUuidSnapshot,
    ]) {
      const reconciledCandidate: ProjectCandidate | undefined = resolveAgainst(
        snapshot,
      ).result.projects.find((entry) => entry.candidate_id === project.candidate_id);
      assert.equal(reconciledCandidate?.action, 'conflict');
      assert.ok(reconciledCandidate);
      assert.ok(reconciledCandidate.diagnostic_codes.includes('PROTECTED_RECORD_CONFLICT'));
    }
    for (const [snapshot, pattern] of [
      [
        {
          ...equivalentSnapshot,
          import_batches: [
            batchEvidence,
            {
              ...batchEvidence,
              id: '00000000-0000-4000-8000-000000000076',
              source_hash: 'f'.repeat(64),
            },
          ],
        },
        /idempotency_key duplicada/u,
      ],
      [
        {
          ...equivalentSnapshot,
          import_batches: [
            batchEvidence,
            { ...batchEvidence, id: '00000000-0000-4000-8000-000000000076' },
          ],
        },
        /idempotency_key duplicada/u,
      ],
      [
        {
          ...equivalentSnapshot,
          import_batches: [batchEvidence, batchEvidence],
        },
        /id duplicado/u,
      ],
      [
        {
          ...equivalentSnapshot,
          import_batches: [
            batchEvidence,
            {
              ...batchEvidence,
              idempotency_key: 'ltcm-p011:' + 'f'.repeat(64),
            },
          ],
        },
        /id duplicado/u,
      ],
    ] as Array<[ExistingSnapshot, RegExp]>) {
      assert.throws(() => resolveAgainst(snapshot), pattern);
    }
    assert.notEqual(createSnapshotHash(equivalentSnapshot), createSnapshotHash(divergentSnapshot));
    assert.notEqual(
      createSnapshotHash(equivalentSnapshot),
      createSnapshotHash(divergentIdempotencyKeySnapshot),
    );
    assert.notEqual(
      createSnapshotHash(equivalentSnapshot),
      createSnapshotHash({
        ...equivalentSnapshot,
        import_batches: equivalentSnapshot.import_batches.slice(0, 1),
      }),
    );
    assert.equal(
      createSnapshotHash(equivalentSnapshot),
      createSnapshotHash({
        ...equivalentSnapshot,
        import_batches: [...equivalentSnapshot.import_batches].reverse(),
      }),
    );
    assert.throws(
      () =>
        createSnapshotHash({
          ...equivalentSnapshot,
          import_batches: [...equivalentSnapshot.import_batches, unrelatedBatchEvidence],
        }),
      /id duplicado/u,
    );
    assert.throws(
      () =>
        normalizeP011(source, divergentSnapshot, '1970-01-01T00:00:00.000Z', equivalent.document),
      /BINDING_MISMATCH: snapshot_hash/u,
    );
  });
});

test('validação integral ocorre antes de qualquer mutação observável', async () => {
  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const snapshot = emptySnapshot();
    const base = normalizeP011(source, snapshot, '1970-01-01T00:00:00.000Z');
    const ambiguous = base.clients.find((candidate) => candidate.status === 'ambiguous');
    const d39 = base.projects.find((candidate) => candidate.project_code === '2024-02-10990');
    assert.ok(ambiguous && d39);
    const clients = structuredClone(base.clients);
    const projects = structuredClone(base.projects);
    const mappings = structuredClone(base.mappings);
    const before = canonicalJson({ clients, projects, mappings });
    assert.throws(
      () =>
        applyReviewedResolutions(
          reviewedDocument(base, [
            {
              type: 'client_identity',
              candidate_id: ambiguous.candidate_id,
              candidate_hash: ambiguous.hash,
              identity: { kind: 'create_new' },
            },
            {
              type: 'project',
              candidate_id: d39.candidate_id,
              candidate_hash: d39.hash,
              approved_name: 'Tentativa sintética inválida',
            },
          ]),
          base.manifest['review_binding'] as ReviewBinding,
          snapshot,
          clients,
          projects,
          mappings,
        ),
      /PROJECT_NAME_NOT_REVIEWABLE/u,
    );
    assert.equal(canonicalJson({ clients, projects, mappings }), before);
    assert.equal(base.resolutionSummary, undefined);
  });
});

test('resolução parcial mantém revisão e resolução completa torna somente projeto elegível', async () => {
  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const base = normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z');
    const project = base.projects.find((candidate) => candidate.project_code === '2025-08-14656');
    assert.ok(project);
    const partial = normalizeP011(
      source,
      emptySnapshot(),
      '1970-01-01T00:00:00.000Z',
      reviewedDocument(base, [
        {
          type: 'project',
          candidate_id: project.candidate_id,
          candidate_hash: project.hash,
          approved_name: 'Projeto sintético aprovado',
        },
      ]),
    );
    const partialProject = partial.projects.find(
      (candidate) => candidate.candidate_id === project.candidate_id,
    );
    assert.equal(partialProject?.action, 'pending_decision');
    assert.equal(
      partial.importPlan.operations.find(
        (operation) => operation.natural_key === project.project_code,
      )?.status,
      'requires_review',
    );

    const complete = normalizeP011(
      source,
      emptySnapshot(),
      '1970-01-01T00:00:00.000Z',
      reviewedDocument(base, [
        {
          type: 'project',
          candidate_id: project.candidate_id,
          candidate_hash: project.hash,
          approved_name: 'Projeto sintético aprovado',
          approved_status: 'active',
        },
      ]),
    );
    const completeProject = complete.projects.find(
      (candidate) => candidate.candidate_id === project.candidate_id,
    );
    assert.equal(completeProject?.action, 'insert');
    assert.equal(completeProject?.currency, project.currency);
    assert.equal(completeProject?.contract_value, project.contract_value);
    assert.equal(completeProject?.classification, project.classification);
    assert.equal(completeProject?.data_reference_date, null);
    assert.equal(completeProject?.legacy_import_batch_reference?.kind, 'planned');
    assert.equal(complete.resolutionSummary?.applied_project_names, 1);
    assert.equal(complete.resolutionSummary?.applied_project_statuses, 1);
  });
});

test('resoluções não sobrescrevem erro normativo, D02-D06, D38-D41 ou D39', async () => {
  await withFixture(
    async (root) => {
      const source = await loadP010Source(root);
      const base = normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z');
      const invalid = base.projects.find((candidate) => candidate.project_code === '2026-04-16531');
      assert.ok(invalid);
      const resolved = normalizeP011(
        source,
        emptySnapshot(),
        '1970-01-01T00:00:00.000Z',
        reviewedDocument(base, [
          {
            type: 'project',
            candidate_id: invalid.candidate_id,
            candidate_hash: invalid.hash,
            approved_name: 'Projeto sintético inválido',
            approved_status: 'active',
          },
        ]),
      );
      const stillInvalid = resolved.projects.find(
        (candidate) => candidate.candidate_id === invalid.candidate_id,
      );
      assert.equal(stillInvalid?.action, 'rejected');
      assert.equal(stillInvalid?.contract_value, null);
      assert.ok(stillInvalid?.diagnostic_codes.includes('PROJECT_VALUE_CONFLICT'));
      assert.ok(
        resolved.projects.every(
          (candidate) =>
            candidate.data_reference_date === null &&
            candidate.legacy_import_batch_reference?.kind === 'planned' &&
            !('import_batch_id' in candidate.legacy_import_batch_reference),
        ),
      );

      const d39 = base.projects.find((candidate) => candidate.project_code === '2024-02-10990');
      assert.ok(d39);
      assert.throws(
        () =>
          normalizeP011(
            source,
            emptySnapshot(),
            '1970-01-01T00:00:00.000Z',
            reviewedDocument(base, [
              {
                type: 'project',
                candidate_id: d39.candidate_id,
                candidate_hash: d39.hash,
                approved_name: 'Tentativa de sobrescrever D39',
              },
            ]),
          ),
        /PROJECT_NAME_NOT_REVIEWABLE/u,
      );
    },
    (rows) => {
      const projectRows = rows.get('project_values') ?? [];
      const value = projectRows[2]?.raw_payload.cells.find(
        (candidate) => candidate.address === 'K3',
      );
      assert.ok(value);
      value.value = 168000;
      value.round_trip_text = '168000';
    },
  );
});

test('arquivo local e CLI integram resoluções sem URL, banco, rede ou apply', async () => {
  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const base = normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z');
    const project = base.projects.find((candidate) => candidate.project_code === '2025-08-14656');
    assert.ok(project);
    const document = reviewedDocument(base, [
      {
        type: 'project',
        candidate_id: project.candidate_id,
        candidate_hash: project.hash,
        approved_name: 'Projeto sintético aprovado',
        approved_status: 'active',
      },
    ]);
    const file = path.join(root, 'reviewed-resolutions.json');
    await writeFile(file, prettyCanonicalJson(document));
    const loaded = await loadReviewedResolutions(file);
    assert.deepEqual(loaded, document);
    assert.deepEqual(await loadReviewedResolutions(path.relative(process.cwd(), file)), document);
    const options = parseArguments([
      '--input-dir',
      root,
      '--output-dir',
      path.resolve('.artifacts', 'p011-synthetic'),
      '--reviewed-resolutions',
      file,
    ]);
    assert.notEqual(options, 'help');
    if (options !== 'help') assert.equal(options.reviewedResolutions, file);
    const without = parseArguments([
      '--input-dir',
      root,
      '--output-dir',
      path.resolve('.artifacts', 'p011-synthetic'),
    ]);
    assert.notEqual(without, 'help');
    if (without !== 'help') assert.equal(without.reviewedResolutions, undefined);
    assert.throws(
      () =>
        parseArguments([
          '--input-dir',
          root,
          '--output-dir',
          path.resolve('.artifacts', 'p011-synthetic'),
          '--reviewed-resolutions',
          'https://example.invalid/resolutions.json',
        ]),
      /somente arquivo local/u,
    );
    await assert.rejects(loadReviewedResolutions(path.join(root, 'missing.json')), /ENOENT/u);
    const corrupted = path.join(root, 'corrupted-reviewed-resolutions.json');
    await writeFile(corrupted, '{');
    await assert.rejects(loadReviewedResolutions(corrupted), /JSON corrompido/u);
    const oversized = path.join(root, 'oversized-reviewed-resolutions.json');
    await writeFile(oversized, Buffer.alloc(5 * 1024 * 1024 + 1));
    await assert.rejects(loadReviewedResolutions(oversized), /acima do limite/u);
    await assert.rejects(loadReviewedResolutions('https://example.invalid/a.json'), /nunca URL/u);
    await assert.rejects(loadReviewedResolutions('http://example.invalid/a.json'), /nunca URL/u);
    await assert.rejects(loadReviewedResolutions('file:///tmp/a.json'), /nunca URL/u);
    await assert.rejects(
      loadReviewedResolutions(String.raw`\\server\share\reviewed-resolutions.json`),
      /somente arquivo local/u,
    );
    await assert.rejects(
      loadReviewedResolutions('//server/share/reviewed-resolutions.json'),
      /somente arquivo local/u,
    );
    await assert.rejects(
      loadReviewedResolutions(String.raw`\\?\C:\reviewed-resolutions.json`),
      /somente arquivo local/u,
    );

    const targetDirectory = path.join(root, 'reviewed-target');
    await mkdir(targetDirectory);
    await writeFile(
      path.join(targetDirectory, 'reviewed-resolutions.json'),
      prettyCanonicalJson(document),
    );
    const finalLink = path.join(root, 'reviewed-resolutions-link.json');
    await symlink(targetDirectory, finalLink, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(loadReviewedResolutions(finalLink), /symlink/u);

    const ancestorLink = path.join(root, 'reviewed-link');
    await symlink(targetDirectory, ancestorLink, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(
      loadReviewedResolutions(path.join(ancestorLink, 'reviewed-resolutions.json')),
      /symlink/u,
    );

    const directoryAsJson = path.join(root, 'directory.json');
    await mkdir(directoryAsJson);
    await assert.rejects(loadReviewedResolutions(directoryAsJson), /inseguro/u);
    assert.throws(() => parseArguments(['--apply']), /REMOTE_APPLY_NOT_AUTHORIZED/u);
    const integrated = normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z', loaded);
    assert.equal(integrated.validationSummary['remote_access'], false);
    assert.equal(integrated.resolutionSummary?.document_hash, sha256Canonical(document));
  });
});

test('resoluções mantêm determinismo de objetos e artefatos byte a byte', async () => {
  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const base = normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z');
    const project = base.projects.find((candidate) => candidate.project_code === '2025-08-14656');
    assert.ok(project);
    const document = reviewedDocument(base, [
      {
        type: 'project',
        candidate_id: project.candidate_id,
        candidate_hash: project.hash,
        approved_name: 'Projeto sintético aprovado',
        approved_status: 'active',
      },
    ]);
    const first = normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z', document);
    const second = normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z', document);
    assert.equal(canonicalJson(first), canonicalJson(second));
    const parent = await mkdtemp(path.join(os.tmpdir(), 'ltcm-p011-d69-write-'));
    try {
      const outputA = path.join(parent, 'a');
      const outputB = path.join(parent, 'b');
      await writeP011Artifacts(outputA, structuredClone(first));
      await writeP011Artifacts(outputB, structuredClone(second));
      const names = (await readdir(outputA)).sort();
      assert.deepEqual(names, (await readdir(outputB)).sort());
      assert.ok(names.includes('resolution-summary.json'));
      for (const name of names) {
        assert.deepEqual(
          await readFile(path.join(outputA, name)),
          await readFile(path.join(outputB, name)),
        );
      }
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

function resolvedBetaArtifacts(
  source: Awaited<ReturnType<typeof loadP010Source>>,
  snapshot: ExistingSnapshot = emptySnapshot(),
) {
  const base = normalizeP011(source, snapshot, '1970-01-01T00:00:00.000Z');
  const project = base.projects.find((candidate) => candidate.project_code === '2025-08-14656');
  assert.ok(project);
  return normalizeP011(
    source,
    snapshot,
    '1970-01-01T00:00:00.000Z',
    reviewedDocument(base, [
      {
        type: 'project',
        candidate_id: project.candidate_id,
        candidate_hash: project.hash,
        approved_name: 'Projeto sintético P012',
        approved_status: 'active',
      },
    ]),
  );
}

function p012Snapshot(
  project: ProjectCandidate,
  projectId: string,
  items: P012ExistingItemsSnapshot['items'] = [],
): P012ExistingItemsSnapshot {
  assert.ok(project.currency);
  return {
    ...emptyP012ExistingItemsSnapshot(),
    projects: [
      {
        id: projectId,
        project_candidate_id: project.candidate_id,
        project_code: project.project_code,
        currency_code: project.currency,
        active: true,
        deleted_at: null,
      },
    ],
    items,
  };
}

function snapshotItem(
  candidate: ItemCandidate,
  projectId: string,
  itemId = '00000000-0000-4000-8000-000000000091',
): P012ExistingItemsSnapshot['items'][number] {
  assert.ok(
    candidate.quantity &&
      candidate.unit_code &&
      candidate.currency_code &&
      candidate.unit_price &&
      candidate.total_amount,
  );
  return {
    id: itemId,
    project_id: projectId,
    source_line_key: candidate.source_line_key,
    line_number: candidate.line_number,
    item_code: candidate.item_code,
    description: candidate.description,
    quantity: candidate.quantity,
    unit_code: candidate.unit_code,
    currency_code: candidate.currency_code,
    unit_price: candidate.unit_price,
    total_amount: candidate.total_amount,
    active: true,
    deleted_at: null,
    row_version: 1,
  };
}

function rehashP012CandidateSet(candidateSet: P012ItemCandidateSet): void {
  for (const candidate of candidateSet.candidates) {
    candidate.candidate_hash = sha256Canonical({ ...candidate, candidate_hash: undefined });
  }
  candidateSet.candidate_set_hash = sha256Canonical(
    candidateSet.candidates.map(({ candidate_id, candidate_hash }) => ({
      candidate_id,
      candidate_hash,
    })),
  );
}

test('P012 source_line_key, candidate ID, decimals e aliases são exatos e determinísticos', () => {
  const key = createSourceLineKey('2025-08-14656', 46);
  assert.match(key, /^p012-item-v1:[0-9a-f]{64}$/u);
  assert.equal(key.length, 77);
  assert.equal(key, createSourceLineKey('2025-08-14656', 46));
  assert.notEqual(key, createSourceLineKey('2025-08-14656', 47));
  assert.notEqual(key, createSourceLineKey('2024-10-12524', 46));
  assert.throws(
    () => assertSourceLineKey(key.toUpperCase(), '2025-08-14656', 46),
    /P012_SOURCE_LINE_KEY_INVALID/u,
  );
  const candidateId = createItemCandidateId(createProjectCandidateId('2025-08-14656'), key);
  assert.match(candidateId, /^item-[0-9a-f]{24}$/u);
  assert.equal(
    assertItemCandidateId(candidateId, createProjectCandidateId('2025-08-14656'), key),
    candidateId,
  );
  assert.throws(
    () =>
      assertItemCandidateId(
        candidateId.toUpperCase(),
        createProjectCandidateId('2025-08-14656'),
        key,
      ),
    /P012_CANDIDATE_ID_INVALID/u,
  );
  const reidentifiedKey = createSourceLineKey('2025-08-14656', 47);
  assert.throws(
    () =>
      assertItemCandidateId(
        candidateId,
        createProjectCandidateId('2025-08-14656'),
        reidentifiedKey,
      ),
    /P012_CANDIDATE_ID_INVALID/u,
  );

  for (const [input, canonical] of [
    ['1', '1.0000'],
    ['1.0', '1.0000'],
    ['1.0000', '1.0000'],
    ['0.0001', '0.0001'],
    ['9999999999999999.9999', '9999999999999999.9999'],
  ]) {
    assert.equal(parseQuantity(input).canonical, canonical);
  }
  for (const input of ['0', '-1', '-0.0001', '0.00001', '1e3', 'NaN', 'Infinity', '1,2', '01']) {
    assert.throws(() => parseQuantity(input), /P012_DECIMAL_INVALID/u);
  }
  for (const [input, canonical] of [
    ['0', '0.0000'],
    ['0.0000', '0.0000'],
    ['1', '1.0000'],
    ['1.2345', '1.2345'],
    ['9999999999999999.9999', '9999999999999999.9999'],
  ]) {
    assert.equal(parseUnitPrice(input).canonical, canonical);
  }
  for (const input of ['-1', '1.23456', '1e3', 'NaN', 'Infinity', '1,2']) {
    assert.throws(() => parseUnitPrice(input), /P012_DECIMAL_INVALID/u);
  }
  assert.equal(deriveTotalAmount(parseQuantity('1'), parseUnitPrice('1.2344')), '1.23');
  assert.equal(deriveTotalAmount(parseQuantity('1'), parseUnitPrice('1.2350')), '1.24');
  assert.equal(deriveTotalAmount(parseQuantity('1'), parseUnitPrice('1.2351')), '1.24');
  assert.equal(deriveTotalAmount(parseQuantity('1'), parseUnitPrice('9.9999')), '10.00');
  assert.throws(
    () =>
      deriveTotalAmount(
        parseQuantity('9999999999999999.9999'),
        parseUnitPrice('9999999999999999.9999'),
      ),
    /overflow/u,
  );

  for (const [input, expected] of [
    ['UN', 'UN'],
    ['Unidade', 'UN'],
    [' unidade ', 'UN'],
    ['SERV', 'SERV'],
    ['Serviço', 'SERV'],
    ['SERVIÇO'.normalize('NFC'), 'SERV'],
    ['US', 'US'],
    ['Unidade e Serviço', 'US'],
  ]) {
    assert.equal(normalizeUnit(input), expected);
  }
  for (const input of ['UND', 'Servico', 'unit', 'Unidade/Serviço']) {
    assert.throws(() => normalizeUnit(input), /P012_UNIT_UNRESOLVED/u);
  }
});

test('P012 D05 restringe emissor P011 e reemissao por clones hashes e replay', async () => {
  const provenanceModule = await import('../src/p011-artifacts-provenance.js');
  assert.deepEqual(Object.keys(provenanceModule), ['createValidatedP011ProjectView']);
  const itemModule = await import('../src/item-normalizer.js');
  assert.equal(Object.hasOwn(itemModule, 'assertP012ItemCandidateIntegrity'), false);

  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const artifacts = resolvedBetaArtifacts(source);
    const legitimate = normalizeP012Items(source, artifacts, emptyP012ExistingItemsSnapshot());
    assert.equal(createValidatedP012CandidateView(source, artifacts, legitimate).length, 48);

    const forgedArtifacts: unknown[] = [
      { ...artifacts },
      Object.assign({}, artifacts),
      JSON.parse(JSON.stringify(artifacts)),
      structuredClone(artifacts),
      {
        manifest: structuredClone(artifacts.manifest),
        projects: structuredClone(artifacts.projects),
      },
      {},
    ];
    for (const forged of forgedArtifacts) {
      const before = canonicalJson(forged);
      assert.throws(
        () =>
          normalizeP012Items(source, forged as typeof artifacts, emptyP012ExistingItemsSnapshot()),
        /P012_PROJECT_PROVENANCE_REQUIRED/u,
      );
      assert.equal(canonicalJson(forged), before);
    }

    const unresolvedArtifacts = normalizeP011(source, emptySnapshot(), '1970-01-01T00:00:00.000Z');
    for (const blockedAction of ['pending_decision', 'rejected'] as const) {
      const forged = structuredClone(unresolvedArtifacts);
      const project = forged.projects.find(({ action }) => action === blockedAction);
      assert.ok(project);
      project.action = 'insert';
      project.hash = sha256Canonical({ ...project, hash: undefined });
      const binding = forged.manifest['review_binding'] as Record<string, unknown>;
      binding['candidate_set_hash'] = sha256Canonical({
        clients: forged.clients,
        projects: forged.projects,
      });
      const before = canonicalJson(forged);
      assert.throws(
        () => normalizeP012Items(source, forged, emptyP012ExistingItemsSnapshot()),
        /P012_PROJECT_PROVENANCE_REQUIRED/u,
      );
      assert.equal(canonicalJson(forged), before);
    }

    const alternateSnapshot = emptySnapshot();
    alternateSnapshot.currencies = [...alternateSnapshot.currencies, { code: 'USD', active: true }];
    const alternateArtifacts = normalizeP011(source, alternateSnapshot, '1970-01-01T00:00:00.000Z');
    const snapshotReplay = structuredClone(artifacts);
    snapshotReplay.manifest['review_binding'] = structuredClone(
      alternateArtifacts.manifest['review_binding'],
    );
    assert.throws(
      () => normalizeP012Items(source, snapshotReplay, emptyP012ExistingItemsSnapshot()),
      /P012_PROJECT_PROVENANCE_REQUIRED/u,
    );
    const bindingReplay = structuredClone(artifacts);
    const replayedBinding = bindingReplay.manifest['review_binding'] as Record<string, unknown>;
    replayedBinding['normalization_manifest_hash'] = 'f'.repeat(64);
    assert.throws(
      () => normalizeP012Items(source, bindingReplay, emptyP012ExistingItemsSnapshot()),
      /P012_PROJECT_PROVENANCE_REQUIRED/u,
    );
  });

  await withFixture(async (rootA) => {
    await withFixture(async (rootB) => {
      const sourceA = await loadP010Source(rootA);
      const sourceB = await loadP010Source(rootB);
      const artifactsA = resolvedBetaArtifacts(sourceA);
      assert.throws(
        () => normalizeP012Items(sourceB, artifactsA, emptyP012ExistingItemsSnapshot()),
        /P012_PROJECT_PROVENANCE_REQUIRED/u,
      );
    });
  });
});

test('P012 D05 fecha diagnostics e rederiva action status antes da view', async () => {
  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const artifacts = resolvedBetaArtifacts(source);
    const mutateInsert = (mutation: (candidate: ItemCandidate) => void, expected: RegExp): void => {
      const candidateSet = normalizeP012Items(source, artifacts, emptyP012ExistingItemsSnapshot());
      const candidate = candidateSet.candidates.find(({ action }) => action === 'insert');
      assert.ok(candidate);
      mutation(candidate);
      rehashP012CandidateSet(candidateSet);
      const before = canonicalJson(candidateSet);
      assert.throws(
        () => createValidatedP012CandidateView(source, artifacts, candidateSet),
        expected,
      );
      assert.equal(canonicalJson(candidateSet), before);
    };

    mutateInsert((candidate) => {
      (candidate.diagnostic_codes as string[]).push('P012_INVENTED_DIAGNOSTIC');
    }, /P012_CANDIDATE_SCHEMA_INVALID/u);
    mutateInsert((candidate) => {
      candidate.action = 'rejected';
      candidate.status = 'rejected';
      candidate.diagnostic_codes = [];
    }, /P012_CANDIDATE_SCHEMA_INVALID: state-causality/u);
    mutateInsert((candidate) => {
      candidate.action = 'pending_decision';
      candidate.status = 'requires_review';
      candidate.diagnostic_codes = [];
    }, /P012_CANDIDATE_SCHEMA_INVALID: state-causality/u);
    mutateInsert((candidate) => {
      candidate.action = 'conflict';
      candidate.status = 'blocked';
      candidate.diagnostic_codes = [];
    }, /P012_CANDIDATE_SCHEMA_INVALID: state-causality/u);
    mutateInsert((candidate) => {
      candidate.diagnostic_codes = ['P012_UNIT_CATALOG_UNAVAILABLE'];
    }, /P012_CANDIDATE_SCHEMA_INVALID: state-causality/u);
    mutateInsert((candidate) => {
      candidate.action = 'pending_decision';
      candidate.status = 'requires_review';
      candidate.diagnostic_codes = ['P012_UNIT_CATALOG_UNAVAILABLE'];
    }, /P012_SOURCE_PROVENANCE_MISMATCH: contextual-declaration/u);
    mutateInsert((candidate) => {
      candidate.action = 'rejected';
      candidate.status = 'rejected';
      candidate.diagnostic_codes = ['P012_TEXT_INVALID'];
    }, /P012_SOURCE_PROVENANCE_MISMATCH: contextual-declaration/u);
    mutateInsert((candidate) => {
      candidate.action = 'no_op';
      candidate.status = 'unchanged';
      candidate.target_id = null;
    }, /P012_CANDIDATE_SCHEMA_INVALID/u);
    mutateInsert((candidate) => {
      candidate.status = 'blocked';
    }, /P012_CANDIDATE_SCHEMA_INVALID/u);

    const staleHash = normalizeP012Items(source, artifacts, emptyP012ExistingItemsSnapshot());
    const staleCandidate = staleHash.candidates.find(({ action }) => action === 'insert');
    assert.ok(staleCandidate);
    staleCandidate.action = 'pending_decision';
    staleCandidate.status = 'requires_review';
    staleCandidate.diagnostic_codes = ['P012_UNIT_CATALOG_UNAVAILABLE'];
    assert.throws(
      () => createValidatedP012CandidateView(source, artifacts, staleHash),
      /P012_SOURCE_PROVENANCE_MISMATCH: contextual-declaration/u,
    );

    const legitimate = normalizeP012Items(source, artifacts, emptyP012ExistingItemsSnapshot());
    const view = createValidatedP012CandidateView(source, artifacts, legitimate);
    assert.ok(view.some(({ action }) => action === 'insert'));
    assert.ok(view.some(({ action }) => action === 'pending_decision'));
    assert.ok(view.some(({ action }) => action === 'rejected'));
  });
});

test('P012 D05 rejeita Cc Cf antes de trim e permite somente espaco ASCII periferico', async () => {
  for (const value of [
    '\tUN\t',
    '\nUN\n',
    '\rUN\r',
    'U\tN',
    'U\nN',
    'U\rN',
    'UN\u0000',
    'UN\u200B',
    'UN\u200C',
    'UN\u200D',
    'UN\u2060',
    '\u202EUN',
  ]) {
    assert.throws(() => normalizeUnit(value), /P012_UNIT_UNRESOLVED/u);
  }
  for (const value of [
    '\tABC\t',
    '\nABC\n',
    '\rABC\r',
    'A\tB',
    'A\nB',
    'A\rB',
    'ABC\u0000',
    'ABC\u200B',
    'ABC\u200C',
    'ABC\u200D',
    'ABC\u2060',
    '\u202EABC',
  ]) {
    assert.throws(() => normalizeOptionalItemText(value, 'description'), /P012_TEXT_INVALID/u);
  }
  for (const value of ['\tBRL', 'BRL\t', 'B\rRL', 'BRL\u200B', '\u202EBRL']) {
    assert.throws(() => parseCanonicalCurrency(value), /P012_CURRENCY_UNRESOLVED/u);
  }
  for (const value of ['\t1', '1\t', '1\n2', '1\u200B', '\u202E1']) {
    assert.throws(() => parseSourceItemNumber(value), /P012_SOURCE_ITEM_NUMBER_INVALID/u);
  }
  for (const projectCode of [
    '\t2025-08-14656',
    '2025-08-14656\r',
    '2025-08-\n14656',
    '2025-08-14656\u200B',
    '\u202E2025-08-14656',
    'arbitrary-project',
  ]) {
    assert.throws(() => createSourceLineKey(projectCode, 1), /P012_SOURCE_LINE_KEY_INVALID/u);
  }
  assert.equal(normalizeUnit(' UN '), 'UN');
  assert.equal(normalizeOptionalItemText(' ABC ', 'description'), 'ABC');
  assert.equal(normalizeUnit('Servic\u0327o'), 'SERV');
  assert.equal(normalizeOptionalItemText('Portugu\u00eas', 'description'), 'Portugu\u00eas');
  assert.equal(normalizeOptionalItemText('Portugue\u0302s', 'description'), 'Portugu\u00eas');
  assert.equal(
    normalizeOptionalItemText('\u03b5\u03bb\u03bb\u03b7\u03bd\u03b9\u03ba\u03ac', 'description'),
    '\u03b5\u03bb\u03bb\u03b7\u03bd\u03b9\u03ba\u03ac',
  );
  assert.equal(normalizeOptionalItemText('\u4e2d\u6587', 'description'), '\u4e2d\u6587');

  await withFixture(
    async (root) => {
      const source = await loadP010Source(root);
      const artifacts = resolvedBetaArtifacts(source);
      const result = normalizeP012Items(source, artifacts, emptyP012ExistingItemsSnapshot());
      const rejected = result.candidates.find(
        ({ source_item_number }) => source_item_number === 46,
      );
      assert.equal(rejected?.action, 'rejected');
      assert.ok(rejected?.diagnostic_codes.includes('P012_TEXT_INVALID'));
      assert.equal(createValidatedP012CandidateView(source, artifacts, result).length, 48);
    },
    (rows) => {
      const row = rows.get('monthly_revenue')?.[48];
      const itemCode = row?.raw_payload.cells.find(({ column_letter }) => column_letter === 'D');
      assert.ok(itemCode);
      itemCode.value = '\tITEM-46\t';
    },
  );
});

test('P012 deriva 48 tentativas da autoridade P010 e fecha provenance P011/P012', async () => {
  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const artifacts = resolvedBetaArtifacts(source);
    const publicRows = source.rows;
    const publicMonthly = Map.prototype.get.call(publicRows, 'monthly_revenue') as P010Row[];
    const publicQuantity = publicMonthly[3]?.raw_payload.cells.find(
      ({ column_letter }) => column_letter === 'F',
    );
    assert.ok(publicQuantity);
    publicQuantity.value = 999;
    publicQuantity.round_trip_text = '999';
    (publicRows as unknown as { get: () => P010Row[] }).get = () => [];
    (publicRows as unknown as { entries: () => IterableIterator<[SheetKey, P010Row[]]> }).entries =
      function* () {
        yield ['monthly_revenue', []];
      };

    const result = normalizeP012Items(source, artifacts, emptyP012ExistingItemsSnapshot());
    assert.equal(result.summary.attempted_rows, 48);
    assert.equal(result.candidates.length, 48);
    assert.equal(new Set(result.candidates.map(({ source_line_key }) => source_line_key)).size, 48);
    assert.ok(new Set(result.candidates.map(({ item_code }) => item_code)).size < 48);
    assert.equal(
      result.candidates.find(({ source_item_number }) => source_item_number === 1)?.quantity,
      '1.0000',
    );
    const incomplete = result.candidates.find(
      ({ source_item_number }) => source_item_number === 45,
    );
    assert.equal(incomplete?.item_code, null);
    assert.equal(incomplete?.description, null);
    assert.equal(createValidatedP012CandidateView(source, artifacts, result).length, 48);

    for (const forgedSource of [
      { ...source },
      Object.assign({}, source),
      JSON.parse(JSON.stringify(source)) as unknown,
      { manifest: source.manifest, rows: source.rows },
    ]) {
      assert.throws(
        () =>
          normalizeP012Items(
            forgedSource as typeof source,
            artifacts,
            emptyP012ExistingItemsSnapshot(),
          ),
        /P011_SOURCE_PROVENANCE_REQUIRED/u,
      );
    }
    for (const forgedArtifacts of [
      { ...artifacts },
      Object.assign({}, artifacts),
      JSON.parse(JSON.stringify(artifacts)) as unknown,
      {},
    ]) {
      assert.throws(
        () =>
          normalizeP012Items(
            source,
            forgedArtifacts as typeof artifacts,
            emptyP012ExistingItemsSnapshot(),
          ),
        /P012_PROJECT_PROVENANCE_REQUIRED/u,
      );
    }
    const rebuilt = structuredClone(result);
    assert.throws(
      () => createValidatedP012CandidateView(source, artifacts, rebuilt),
      /P012_SOURCE_PROVENANCE_REQUIRED/u,
    );
    const withExtra = normalizeP012Items(source, artifacts, emptyP012ExistingItemsSnapshot());
    Object.assign(withExtra.candidates[0]!, { caller_field: true });
    assert.throws(
      () => createValidatedP012CandidateView(source, artifacts, withExtra),
      /P012_CANDIDATE_SCHEMA_INVALID/u,
    );
    const withNestedExtra = normalizeP012Items(source, artifacts, emptyP012ExistingItemsSnapshot());
    Object.assign(withNestedExtra.candidates[0]!.project, { caller_field: true });
    assert.throws(
      () => createValidatedP012CandidateView(source, artifacts, withNestedExtra),
      /P012_CANDIDATE_SCHEMA_INVALID/u,
    );

    const authentic = result.candidates[0];
    assert.ok(authentic?.origins[0]);
    authentic.origins[0].row_hash = 'f'.repeat(64);
    authentic.candidate_hash = sha256Canonical({ ...authentic, candidate_hash: undefined });
    result.candidate_set_hash = sha256Canonical(
      result.candidates.map(({ candidate_id, candidate_hash }) => ({
        candidate_id,
        candidate_hash,
      })),
    );
    assert.throws(
      () => createValidatedP012CandidateView(source, artifacts, result),
      /P012_(?:SOURCE_PROVENANCE_MISMATCH|CANDIDATE_SCHEMA_INVALID)/u,
    );
  });
});

test('P012 rejeita duplicidade estrutural e erros factuais sem reparar a fonte', async () => {
  await withFixture(
    async (root) => {
      const source = await loadP010Source(root);
      const artifacts = resolvedBetaArtifacts(source);
      assert.throws(
        () => normalizeP012Items(source, artifacts, emptyP012ExistingItemsSnapshot()),
        /P012_SOURCE_LINE_DUPLICATE/u,
      );
    },
    (rows) => {
      const monthly = rows.get('monthly_revenue') ?? [];
      const first = monthly[3]?.raw_payload.cells.find(
        ({ column_letter }) => column_letter === 'A',
      );
      const second = monthly[4]?.raw_payload.cells.find(
        ({ column_letter }) => column_letter === 'A',
      );
      assert.ok(first && second);
      second.value = first.value;
      if (first.round_trip_text === undefined) delete second.round_trip_text;
      else second.round_trip_text = first.round_trip_text;
    },
  );

  for (const [column, value, roundTrip, expected, rowIndex, itemNumber] of [
    ['F', 0.00001, '0.00001', 'P012_DECIMAL_INVALID', 48, 46],
    ['I', 1000, '1e3', 'P012_DECIMAL_INVALID', 48, 46],
    ['H', 'USD', undefined, 'P012_CURRENCY_UNRESOLVED', 3, 1],
    ['G', 'UND', undefined, 'P012_UNIT_UNRESOLVED', 48, 46],
  ] as const) {
    await withFixture(
      async (root) => {
        const source = await loadP010Source(root);
        const artifacts = resolvedBetaArtifacts(source);
        const result = normalizeP012Items(source, artifacts, emptyP012ExistingItemsSnapshot());
        const candidate = result.candidates.find(
          ({ source_item_number }) => source_item_number === itemNumber,
        );
        assert.equal(candidate?.action, 'rejected');
        assert.equal(createValidatedP012CandidateView(source, artifacts, result).length, 48);
        assert.ok(candidate?.diagnostic_codes.includes(expected));
      },
      (rows) => {
        const target = rows
          .get('monthly_revenue')
          ?.[rowIndex]?.raw_payload.cells.find(({ column_letter }) => column_letter === column);
        assert.ok(target);
        target.value = value;
        if (roundTrip === undefined) delete target.round_trip_text;
        else target.round_trip_text = roundTrip;
      },
    );
  }
});

test('P012 snapshot fechado reconcilia insert, no_op e conflict sem update/delete', async () => {
  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const insertedArtifacts = resolvedBetaArtifacts(source);
    const insertedProject = insertedArtifacts.projects.find(
      ({ project_code }) => project_code === '2025-08-14656',
    );
    const insertedClient = insertedArtifacts.clients.find(
      ({ candidate_id }) => candidate_id === insertedProject?.client_candidate_id,
    );
    assert.ok(
      insertedProject &&
        insertedClient &&
        insertedProject.classification &&
        insertedProject.currency &&
        insertedProject.contract_value,
    );
    assert.equal(insertedProject.action, 'insert');
    assert.equal(insertedProject.legacy_import_batch_reference?.kind, 'planned');
    if (insertedProject.legacy_import_batch_reference?.kind !== 'planned') {
      throw new Error('Fixture P012 sem lote planejado.');
    }
    const clientId = '00000000-0000-4000-8000-000000000081';
    const projectId = '00000000-0000-4000-8000-000000000082';
    const batchId = '00000000-0000-4000-8000-000000000083';
    const p011Snapshot: ExistingSnapshot = {
      ...emptySnapshot(),
      clients: [
        {
          id: clientId,
          legal_name: insertedClient.normalized_name,
          display_name: insertedClient.normalized_name,
          tax_id: null,
          active: true,
          deleted_at: null,
          row_version: 1,
        },
      ],
      import_batches: [
        {
          id: batchId,
          idempotency_key: insertedProject.legacy_import_batch_reference.idempotency_key,
          source_hash: insertedProject.legacy_import_batch_reference.source_hash,
        },
      ],
      projects: [
        {
          id: projectId,
          project_code: insertedProject.project_code,
          project_name: 'Projeto sintético P012',
          client_id: clientId,
          classification: insertedProject.classification,
          status: 'active',
          base_currency: insertedProject.currency,
          contract_value: insertedProject.contract_value,
          data_reference_date: null,
          legacy_import_batch_id: batchId,
          deleted_at: null,
          version: 1,
        },
      ],
    };
    const persistedArtifacts = resolvedBetaArtifacts(source, p011Snapshot);
    const persistedProject = persistedArtifacts.projects.find(
      ({ project_code }) => project_code === insertedProject.project_code,
    );
    assert.ok(persistedProject);
    assert.equal(persistedProject.action, 'no_op');
    const emptyItemSnapshot = p012Snapshot(persistedProject, projectId);
    const first = normalizeP012Items(source, persistedArtifacts, emptyItemSnapshot);
    const insert = first.candidates.find(({ source_item_number }) => source_item_number === 46);
    assert.ok(insert);
    assert.equal(insert.action, 'insert');
    assert.equal(createValidatedP012CandidateView(source, persistedArtifacts, first).length, 48);

    const existing = snapshotItem(insert, projectId);
    const identicalSnapshot = p012Snapshot(persistedProject, projectId, [existing]);
    const snapshotBefore = canonicalJson(identicalSnapshot);
    const identical = normalizeP012Items(source, persistedArtifacts, identicalSnapshot);
    assert.equal(canonicalJson(identicalSnapshot), snapshotBefore);
    const noOp = identical.candidates.find(
      ({ candidate_id }) => candidate_id === insert.candidate_id,
    );
    assert.equal(noOp?.action, 'no_op');
    assert.equal(
      createValidatedP012CandidateView(source, persistedArtifacts, identical).length,
      48,
    );
    assert.equal(noOp?.target_id, existing.id);

    const conflictSnapshot = p012Snapshot(persistedProject, projectId, [
      { ...existing, description: `${existing.description ?? ''} divergente` },
    ]);
    const conflicted = normalizeP012Items(source, persistedArtifacts, conflictSnapshot);
    assert.equal(
      conflicted.candidates.find(({ candidate_id }) => candidate_id === insert.candidate_id)
        ?.action,
      'conflict',
    );
    assert.equal(
      createValidatedP012CandidateView(source, persistedArtifacts, conflicted).length,
      48,
    );

    for (const invalid of [
      { ...identicalSnapshot, unexpected: true },
      {
        ...identicalSnapshot,
        items: [existing, { ...existing, id: '00000000-0000-4000-8000-000000000092' }],
      },
      {
        ...identicalSnapshot,
        projects: [
          {
            ...identicalSnapshot.projects[0]!,
            id: 'AAAAAAAA-0000-4000-8000-000000000082',
          },
        ],
        items: [{ ...existing, project_id: 'AAAAAAAA-0000-4000-8000-000000000082' }],
      },
      { ...identicalSnapshot, items: [{ ...existing, line_number: existing.line_number + 1 }] },
      { ...identicalSnapshot, items: [{ ...existing, total_amount: '1.00' }] },
      {
        ...identicalSnapshot,
        currencies: [...identicalSnapshot.currencies, { code: 'USD', active: true }],
        items: [{ ...existing, currency_code: 'USD' }],
      },
      {
        ...identicalSnapshot,
        items: [
          {
            ...existing,
            source_line_key: createSourceLineKey(persistedProject.project_code, 47),
          },
          {
            ...existing,
            id: '00000000-0000-4000-8000-000000000092',
            line_number: 47,
          },
        ],
      },
    ]) {
      assert.throws(() => parseP012ExistingItemsSnapshot(invalid), /P012_SNAPSHOT_INVALID/u);
    }

    for (const divergent of [
      { ...existing, quantity: '2.0000' },
      { ...existing, unit_code: 'US' as const },
      { ...existing, unit_price: '1.0000', total_amount: '1.00' },
      { ...existing, active: false },
      { ...existing, deleted_at: '2026-08-14T00:00:00.000Z' },
    ]) {
      const result = normalizeP012Items(
        source,
        persistedArtifacts,
        p012Snapshot(persistedProject, projectId, [divergent]),
      );
      assert.equal(
        result.candidates.find(({ candidate_id }) => candidate_id === insert.candidate_id)?.action,
        'conflict',
      );
    }
  });
});

test('P012 ignora fatos P013 na identidade e bloqueia catálogo indisponível', async () => {
  const run = async (p013Value: number) =>
    withFixture(
      async (root) => {
        const source = await loadP010Source(root);
        const artifacts = resolvedBetaArtifacts(source);
        return normalizeP012Items(
          source,
          artifacts,
          emptyP012ExistingItemsSnapshot(),
        ).candidates.find(({ source_item_number }) => source_item_number === 46);
      },
      (rows) => {
        const row = rows.get('monthly_revenue')?.[48];
        assert.ok(row);
        row.raw_payload.cells.push(rawCell('K', 49, p013Value));
      },
    );
  const left = await run(10);
  const right = await run(20);
  assert.ok(left && right);
  assert.equal(left.source_line_key, right.source_line_key);
  assert.deepEqual(
    {
      item_code: left.item_code,
      description: left.description,
      quantity: left.quantity,
      unit_code: left.unit_code,
      currency_code: left.currency_code,
      unit_price: left.unit_price,
      total_amount: left.total_amount,
    },
    {
      item_code: right.item_code,
      description: right.description,
      quantity: right.quantity,
      unit_code: right.unit_code,
      currency_code: right.currency_code,
      unit_price: right.unit_price,
      total_amount: right.total_amount,
    },
  );

  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const artifacts = resolvedBetaArtifacts(source);
    const snapshot = emptyP012ExistingItemsSnapshot();
    snapshot.units = snapshot.units.map((entry) =>
      entry.code === 'SERV' ? { ...entry, active: false } : entry,
    );
    const result = normalizeP012Items(source, artifacts, snapshot);
    const blocked = result.candidates.find(({ source_item_number }) => source_item_number === 46);
    assert.equal(blocked?.action, 'pending_decision');
    assert.ok(blocked?.diagnostic_codes.includes('P012_UNIT_CATALOG_UNAVAILABLE'));
    assert.equal(createValidatedP012CandidateView(source, artifacts, result).length, 48);

    const currencySnapshot = emptyP012ExistingItemsSnapshot();
    currencySnapshot.currencies = [{ code: 'BRL', active: false }];
    const currencyResult = normalizeP012Items(source, artifacts, currencySnapshot);
    const currencyBlocked = currencyResult.candidates.find(
      ({ source_item_number }) => source_item_number === 46,
    );
    assert.equal(currencyBlocked?.action, 'pending_decision');
    assert.ok(currencyBlocked?.diagnostic_codes.includes('P012_CURRENCY_CATALOG_UNAVAILABLE'));
    assert.equal(createValidatedP012CandidateView(source, artifacts, currencyResult).length, 48);
  });
});

test('contratos v3 validam snapshot e referência de lote sem inferir data artificial', () => {
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
  assert.equal(v1.contract, 'ltcm.p011.existing-snapshot.v3');
  assert.deepEqual(v1.import_batches, []);
  assert.equal(v1.projects[0]?.legacy_import_batch_id, null);
  const v2 = parseExistingSnapshot({
    contract: 'ltcm.p011.existing-snapshot.v2',
    currencies: [],
    clients: [],
    projects: [{ ...project, data_reference_date: null, legacy_import_batch_id: batchId }],
  });
  assert.equal(v2.contract, 'ltcm.p011.existing-snapshot.v3');
  assert.deepEqual(v2.import_batches, []);
  assert.equal(v2.projects[0]?.legacy_import_batch_id, batchId);
  const v3 = parseExistingSnapshot({
    contract: 'ltcm.p011.existing-snapshot.v3',
    currencies: [],
    clients: [],
    import_batches: [
      {
        id: batchId,
        idempotency_key: 'ltcm-p011:' + 'a'.repeat(64),
        source_hash: 'b'.repeat(64),
      },
    ],
    projects: [{ ...project, data_reference_date: null, legacy_import_batch_id: batchId }],
  });
  assert.equal(v3.import_batches[0]?.id, batchId);
  assert.throws(
    () =>
      parseExistingSnapshot({
        contract: 'ltcm.p011.existing-snapshot.v3',
        currencies: [],
        clients: [],
        import_batches: [],
        projects: [],
        extra: true,
      }),
    /não autorizados=extra/u,
  );
  assert.throws(
    () =>
      parseExistingSnapshot({
        contract: 'ltcm.p011.existing-snapshot.v3',
        currencies: [],
        clients: [],
        import_batches: [
          {
            id: batchId,
            idempotency_key: 'ltcm-p011:' + 'a'.repeat(64),
            source_hash: 'b'.repeat(64),
            extra: true,
          },
        ],
        projects: [],
      }),
    /não autorizados=extra/u,
  );
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

test('APIs programáticas aplicam o preflight normativo sem bypass D83', () => {
  const batchId = '00000000-0000-4000-8000-000000000075';
  const otherBatchId = '00000000-0000-4000-8000-000000000076';
  const idempotencyKey = `ltcm-p011:${'a'.repeat(64)}`;
  const sourceHash = 'b'.repeat(64);
  const batch = { id: batchId, idempotency_key: idempotencyKey, source_hash: sourceHash };
  const target: ExistingSnapshot['projects'][number] = {
    id: '00000000-0000-4000-8000-000000000077',
    project_code: 'SYNTHETIC-001',
    project_name: 'Projeto sintetico valido',
    client_id: '00000000-0000-4000-8000-000000000086',
    classification: 'full_contract',
    status: 'active',
    base_currency: 'BRL',
    contract_value: '1000',
    data_reference_date: null,
    legacy_import_batch_id: batchId,
    deleted_at: null,
    version: 1,
  };
  const baseSnapshot: ExistingSnapshot = {
    contract: 'ltcm.p011.existing-snapshot.v3',
    currencies: [],
    clients: [],
    import_batches: [batch],
    projects: [target],
  };
  const duplicateKeySnapshot: ExistingSnapshot = {
    ...baseSnapshot,
    import_batches: [
      batch,
      {
        id: otherBatchId,
        idempotency_key: idempotencyKey,
        source_hash: 'c'.repeat(64),
      },
    ],
  };
  const duplicateUuidSnapshot: ExistingSnapshot = {
    ...baseSnapshot,
    import_batches: [batch, { id: batchId, idempotency_key: 'other', source_hash: 'c'.repeat(64) }],
  };
  const topLevelExtraSnapshot = {
    ...baseSnapshot,
    extra: true,
  } as ExistingSnapshot;
  const batchExtraSnapshot = {
    ...baseSnapshot,
    import_batches: [{ ...batch, extra: true }],
  } as unknown as ExistingSnapshot;
  for (const [snapshot, pattern] of [
    [duplicateKeySnapshot, /idempotency_key duplicada/u],
    [duplicateUuidSnapshot, /id duplicado/u],
    [topLevelExtraSnapshot, /não autorizados=extra/u],
    [batchExtraSnapshot, /não autorizados=extra/u],
  ] as Array<[ExistingSnapshot, RegExp]>) {
    assert.throws(
      () => createReviewBinding('2.0.0', 'd'.repeat(64), 'e'.repeat(64), snapshot, [], []),
      pattern,
    );
    assert.throws(() => createSnapshotHash(snapshot), pattern);
  }

  const binding = fabricatedBinding(baseSnapshot, [], [], 'd'.repeat(64), 'e'.repeat(64));
  const document: ReviewedResolutionDocument = {
    contract: 'ltcm.p011.reviewed-resolutions.v1',
    normalizer_version: binding.normalizer_version,
    normalization_manifest_hash: binding.normalization_manifest_hash,
    p010_manifest_hash: binding.p010_manifest_hash,
    input_hash: binding.input_hash,
    snapshot_hash: binding.snapshot_hash,
    candidate_set_hash: binding.candidate_set_hash,
    resolutions: [],
  };
  const clients: ClientCandidate[] = [];
  const projects: ProjectCandidate[] = [];
  const mappings: MappingEvidence[] = [];
  const before = canonicalJson({ clients, projects, mappings });
  let summaryCreated = false;
  assert.throws(() => {
    const result = applyReviewedResolutions(
      document,
      binding,
      duplicateKeySnapshot,
      clients,
      projects,
      mappings,
    );
    summaryCreated = result.summary !== undefined;
  }, /idempotency_key duplicada/u);
  assert.equal(summaryCreated, false);
  assert.equal(canonicalJson({ clients, projects, mappings }), before);

  const plannedProject = lineageProject({
    legacy_import_batch_reference: {
      kind: 'planned',
      planned_key: 'p011-batch-synthetic',
      idempotency_key: idempotencyKey,
      source_manifest_hash: 'a'.repeat(64),
      source_hash: sourceHash,
    },
  });
  assert.equal(matchProjectLineage(plannedProject, target, baseSnapshot).equivalent, true);
  assert.throws(
    () => matchProjectLineage(plannedProject, target, duplicateKeySnapshot),
    /idempotency_key duplicada/u,
  );

  for (const legacySnapshot of [
    parseExistingSnapshot({
      contract: 'ltcm.p011.existing-snapshot.v1',
      currencies: [],
      clients: [],
      projects: [],
    }),
    parseExistingSnapshot({
      contract: 'ltcm.p011.existing-snapshot.v2',
      currencies: [],
      clients: [],
      projects: [],
    }),
  ]) {
    assert.throws(() => matchProjectLineage(plannedProject, target, legacySnapshot), /target/u);
  }
});

test('applyReviewedResolutions vincula o binding ao snapshot efetivamente recebido', () => {
  const snapshotA = emptySnapshot();
  const snapshotB: ExistingSnapshot = {
    ...snapshotA,
    currencies: [{ code: 'USD', active: true }],
  };
  const bindingA = fabricatedBinding(snapshotA, [], []);
  assert.notEqual(bindingA.snapshot_hash, createSnapshotHash(snapshotB));
  const document: ReviewedResolutionDocument = {
    contract: 'ltcm.p011.reviewed-resolutions.v1',
    normalizer_version: bindingA.normalizer_version,
    normalization_manifest_hash: bindingA.normalization_manifest_hash,
    p010_manifest_hash: bindingA.p010_manifest_hash,
    input_hash: bindingA.input_hash,
    snapshot_hash: bindingA.snapshot_hash,
    candidate_set_hash: bindingA.candidate_set_hash,
    resolutions: [],
  };
  const clients: ClientCandidate[] = [];
  const projects: ProjectCandidate[] = [];
  const mappings: MappingEvidence[] = [];
  const before = canonicalJson({ clients, projects, mappings });
  let summaryCreated = false;
  assert.throws(() => {
    const result = applyReviewedResolutions(
      document,
      bindingA,
      snapshotB,
      clients,
      projects,
      mappings,
    );
    summaryCreated = result.summary !== undefined;
  }, /BINDING_MISMATCH: snapshot_hash/u);
  assert.equal(summaryCreated, false);
  assert.equal(canonicalJson({ clients, projects, mappings }), before);

  const unexpectedClients = [
    integrityClient({
      candidate_id: createClientCandidateId('cliente inesperado'),
      raw_names: ['Cliente inesperado'],
      normalized_name: 'Cliente inesperado',
      match_key: 'cliente inesperado',
      status: 'valid',
      action: 'insert',
      possible_matches: [],
      diagnostic_codes: [],
    }),
  ];
  const unexpectedBefore = canonicalJson(unexpectedClients);
  assert.throws(
    () =>
      applyReviewedResolutions(
        document,
        bindingA,
        snapshotA,
        unexpectedClients,
        projects,
        mappings,
      ),
    /BINDING_MISMATCH: candidate_set_hash/u,
  );
  assert.equal(canonicalJson(unexpectedClients), unexpectedBefore);
});

test('preflight runtime fecha currencies, clients e projects em todas as APIs públicas', () => {
  const batchId = '00000000-0000-4000-8000-000000000085';
  const clientId = '00000000-0000-4000-8000-000000000086';
  const projectId = '00000000-0000-4000-8000-000000000087';
  const idempotencyKey = `ltcm-p011:${'a'.repeat(64)}`;
  const sourceHash = 'b'.repeat(64);
  const currency = { code: 'BRL', active: true };
  const client = {
    id: clientId,
    legal_name: 'Cliente sintético válido',
    display_name: 'Cliente sintético válido',
    tax_id: null,
    active: true,
    deleted_at: null,
    row_version: 1,
  };
  const project = {
    id: projectId,
    project_code: 'SYNTHETIC-001',
    project_name: 'Projeto sintético válido',
    client_id: clientId,
    classification: 'full_contract' as const,
    status: 'active' as const,
    base_currency: 'BRL',
    contract_value: '1000',
    data_reference_date: null,
    legacy_import_batch_id: batchId,
    deleted_at: null,
    version: 1,
  };
  const batch = { id: batchId, idempotency_key: idempotencyKey, source_hash: sourceHash };
  const validSnapshot: ExistingSnapshot = {
    contract: 'ltcm.p011.existing-snapshot.v3',
    currencies: [currency],
    clients: [client],
    import_batches: [batch],
    projects: [project],
  };
  const binding = fabricatedBinding(validSnapshot, [], [], 'c'.repeat(64), 'd'.repeat(64));
  const document: ReviewedResolutionDocument = {
    contract: 'ltcm.p011.reviewed-resolutions.v1',
    normalizer_version: binding.normalizer_version,
    normalization_manifest_hash: binding.normalization_manifest_hash,
    p010_manifest_hash: binding.p010_manifest_hash,
    input_hash: binding.input_hash,
    snapshot_hash: binding.snapshot_hash,
    candidate_set_hash: binding.candidate_set_hash,
    resolutions: [],
  };
  const projectWithoutName = Object.fromEntries(
    Object.entries(project).filter(([key]) => key !== 'project_name'),
  );
  const malformedSnapshots = [
    { ...validSnapshot, currencies: [{ ...currency, extra: true }] },
    { ...validSnapshot, currencies: [{ code: 'BRL' }] },
    { ...validSnapshot, clients: [{ ...client, id: 'invalid' }] },
    { ...validSnapshot, clients: [{ ...client, extra: true }] },
    { ...validSnapshot, clients: [{ ...client, active: 'true' }] },
    { ...validSnapshot, projects: [{ ...project, extra: true }] },
    { ...validSnapshot, projects: [projectWithoutName] },
    { ...validSnapshot, projects: [{ ...project, version: '1' }] },
  ] as unknown as ExistingSnapshot[];
  const plannedProject = lineageProject({
    legacy_import_batch_reference: {
      kind: 'planned',
      planned_key: 'p011-batch-synthetic',
      idempotency_key: idempotencyKey,
      source_manifest_hash: 'a'.repeat(64),
      source_hash: sourceHash,
    },
  });

  assert.equal(createSnapshotHash(validSnapshot), binding.snapshot_hash);
  assert.equal(
    matchProjectLineage(plannedProject, validSnapshot.projects[0]!, validSnapshot).equivalent,
    true,
  );
  assert.throws(
    () => applyReviewedResolutions(document, binding, validSnapshot, [], [], []),
    /P011_SOURCE_PROVENANCE_REQUIRED/u,
  );
  for (const snapshot of malformedSnapshots) {
    assert.throws(() => parseExistingSnapshot(snapshot));
    assert.throws(() => createSnapshotHash(snapshot));
    assert.throws(() =>
      createReviewBinding('2.0.0', 'c'.repeat(64), 'd'.repeat(64), snapshot, [], []),
    );
    assert.throws(() => applyReviewedResolutions(document, binding, snapshot, [], [], []));
    assert.throws(() => matchProjectLineage(plannedProject, validSnapshot.projects[0]!, snapshot));
  }
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
