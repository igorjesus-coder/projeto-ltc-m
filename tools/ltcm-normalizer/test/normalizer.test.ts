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
  parseExistingSnapshot,
  parseReviewedResolutionDocument,
  plannedLegacyImportBatchReference,
} from '../src/contracts.js';
import {
  applyExistingSnapshot,
  clientMatchKey,
  normalizeClientName,
  normalizeP011,
} from '../src/normalizer.js';
import { applyReviewedResolutions, createSnapshotHash } from '../src/reviewed-resolutions.js';
import {
  executePreparedBatch,
  preparePersistenceBatch,
  type LtcmPersistencePort,
} from '../src/persistence.js';
import {
  assertSafeOutput,
  emptySnapshot,
  loadP010Source,
  loadReviewedResolutions,
} from '../src/source-reader.js';
import {
  EXPECTED_PROJECT_CODES,
  P010_WORKBOOK_SHA256,
  type ClientCandidate,
  type ExistingSnapshot,
  type P010Row,
  type RawCell,
  type ReviewBinding,
  type ReviewedResolution,
  type ReviewedResolutionDocument,
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
          candidate_id: 'client-synthetic',
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
            resolutions: [{ ...entry, candidate_id: 'project-inexistente' }],
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

test('projeto resolvido é reconciliado novamente contra snapshot antes da ação final', async () => {
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
      return normalizeP011(
        source,
        snapshot,
        '1970-01-01T00:00:00.000Z',
        reviewedDocument(base, [
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
        ]),
      ).projects.find((candidate) => candidate.candidate_id === boundProject.candidate_id);
    };
    assert.equal(resolveAgainst(clientSnapshot)?.action, 'insert');

    const existingSnapshot: ExistingSnapshot = {
      ...clientSnapshot,
      projects: [
        {
          id: '00000000-0000-4000-8000-000000000074',
          project_code: project.project_code,
          project_name: 'Projeto sintético reconciliado',
          client_id: clientId,
          classification: project.classification,
          status: 'active',
          base_currency: project.currency,
          contract_value: project.contract_value,
          data_reference_date: null,
          legacy_import_batch_id: '00000000-0000-4000-8000-000000000075',
          deleted_at: null,
          version: 1,
        },
      ],
    };
    const reconciled = resolveAgainst(existingSnapshot);
    assert.equal(reconciled?.action, 'conflict');
    assert.ok(reconciled?.diagnostic_codes.includes('PROTECTED_RECORD_CONFLICT'));
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
  await withFixture(async (root) => {
    const source = await loadP010Source(root);
    const projectRows = source.rows.get('project_values') ?? [];
    const value = projectRows[2]?.raw_payload.cells.find((candidate) => candidate.address === 'K3');
    assert.ok(value);
    value.value = 168000;
    value.round_trip_text = '168000';
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
  });
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
