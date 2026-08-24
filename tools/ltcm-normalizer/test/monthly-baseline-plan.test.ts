import assert from 'node:assert/strict';
import { appendFile, chmod, copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  loadP013CertifiedMonthlySource,
  readP013CertifiedMonthlySourceFacts,
  type P013CertifiedMonthlySource,
} from '@ltcm/extractor/p013';

import { createSourceLineKey } from '../src/item-contracts.js';
import {
  assertP013CertifiedMonthlyBaselinePlan,
  createP013LocalPostgresDryRunAdapter,
  deriveP013MonthlyBaselinePreviewForTest,
  parseP013MonthlySnapshot,
  runP013MonthlyBaselineDryRun,
} from '../src/monthly-baseline-plan.js';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const PLAN_ID = '00000000-0000-4000-8000-000000013301';

async function localSource(context: {
  skip(message?: string): void;
}): Promise<P013CertifiedMonthlySource | null> {
  const directory = path.join(ROOT, '.local-source');
  const name = (await readdir(directory).catch(() => [])).find((candidate) =>
    candidate.endsWith('.xlsx'),
  );
  if (name === undefined) {
    context.skip('Fonte P013 D01A local indisponível.');
    return null;
  }
  return loadP013CertifiedMonthlySource(path.join(directory, name));
}

function fixtureUuid(group: number, index: number): string {
  return `00000000-0000-4000-${group.toString().padStart(4, '0')}-${index.toString().padStart(12, '0')}`;
}

function readySnapshot(source: P013CertifiedMonthlySource): Record<string, unknown> {
  const facts = readP013CertifiedMonthlySourceFacts(source);
  const identities = [
    ...new Map(
      facts.cells.map((cell) => [`${cell.project_code}\0${cell.source_item_number}`, cell]),
    ).values(),
  ];
  const codes = [...new Set(identities.map(({ project_code }) => project_code))].sort();
  const projects = codes.map((projectCode, index) => ({
    id: fixtureUuid(4300, index + 1),
    project_code: projectCode,
    status: 'active',
    deleted_at: null,
  }));
  const byCode = new Map(projects.map((project) => [project.project_code, project]));
  const projectItems = identities.map((identity, index) => {
    const project = byCode.get(identity.project_code)!;
    const lineNumber = Number(identity.source_item_number);
    return {
      id: fixtureUuid(4400, index + 1),
      project_id: project.id,
      source_line_key: createSourceLineKey(identity.project_code, lineNumber),
      line_number: lineNumber,
      active: true,
      deleted_at: null,
    };
  });
  return {
    contract: 'ltcm.p013.monthly-baseline-snapshot.v1',
    target_plan_version: { id: PLAN_ID, status: 'draft', is_baseline: true },
    projects,
    project_items: projectItems,
    plan_scopes: projects.map(({ id }) => ({
      project_id: id,
      metric_type: 'billing_planned',
      planning_level: 'item',
      currency_code: 'BRL',
    })),
    existing_baselines: [],
    existing_cells: [],
    existing_plan_lines: [],
    existing_artifacts: [],
    existing_executions: [],
    read_scope: { project_codes: codes, target_plan_version_id: PLAN_ID },
  };
}

function preview(source: P013CertifiedMonthlySource, snapshot = readySnapshot(source)) {
  return deriveP013MonthlyBaselinePreviewForTest({ source, snapshot });
}

function matchingExistingSnapshot(
  source: P013CertifiedMonthlySource,
  plan: NonNullable<ReturnType<typeof preview>['plan']>,
): Record<string, unknown> {
  const snapshot = readySnapshot(source);
  const baselineId = fixtureUuid(4500, 2);
  const lineIds = new Map(
    plan.material_lines.map((line, index) => [
      `${line.project_item_id}\0${line.competence_month}`,
      fixtureUuid(4700, index + 1),
    ]),
  );
  snapshot['existing_baselines'] = [
    {
      id: baselineId,
      plan_version_id: PLAN_ID,
      metric_type: 'billing_planned',
      planning_level: 'item',
      semantic_fingerprint: plan.baseline_semantic_fingerprint,
    },
  ];
  snapshot['existing_plan_lines'] = plan.material_lines.map((line) => ({
    id: lineIds.get(`${line.project_item_id}\0${line.competence_month}`),
    project_id: line.project_id,
    project_item_id: line.project_item_id,
    competence_month: line.competence_month,
    amount: line.amount,
    currency_code: line.currency_code,
  }));
  snapshot['existing_cells'] = plan.cells.map((cell) => ({
    baseline_id: baselineId,
    project_id: cell.project_id,
    project_item_id: cell.project_item_id,
    competence_month: cell.competence_month,
    source_line_key: cell.source_line_key,
    source_item_number: cell.source_item_number,
    source_row_number: cell.source_row_number,
    source_column: cell.source_column,
    source_cell_reference: cell.source_cell_reference,
    declaration_state: cell.declaration_state,
    source_numeric_text: cell.source_numeric_text,
    source_value_hash: cell.source_value_hash,
    canonical_amount: cell.canonical_amount,
    financial_plan_line_id:
      cell.declaration_state === 'blank'
        ? null
        : lineIds.get(`${cell.project_item_id}\0${cell.competence_month}`),
  }));
  snapshot['existing_artifacts'] = [
    {
      source_sha256: source.source_sha256,
      source_semantic_fingerprint: source.source_semantic_fingerprint,
    },
  ];
  snapshot['existing_executions'] = [
    {
      source_sha256: source.source_sha256,
      baseline_id: baselineId,
      baseline_semantic_fingerprint: plan.baseline_semantic_fingerprint,
      plan_version_id: PLAN_ID,
    },
  ];
  return snapshot;
}

test('D03 gera plano canônico completo, determinístico e sem escrita para as 432 posições', async (context) => {
  const source = await localSource(context);
  if (source === null) return;
  const first = preview(source);
  const second = preview(source);
  assert.equal(first.status, 'ready');
  assert.ok(first.plan);
  assert.equal(first.plan.cells.length, 432);
  assert.equal(first.plan.material_lines.length, 102);
  assert.equal(first.plan.item_reconciliation.length, 48);
  assert.deepEqual(first.plan.global_reconciliation, {
    position_count: 432,
    blank_count: 330,
    explicit_zero_count: 1,
    non_zero_count: 101,
    material_line_count: 102,
    canonical_total: '2800460.18',
    aggregate_raw_rounded_total: '2800460.15',
    rounding_residual: '0.03',
  });
  assert.equal(first.plan.plan_hash, second.plan?.plan_hash);
  assert.equal(first.snapshot.snapshot_fingerprint, second.snapshot.snapshot_fingerprint);
  const reorderedRaw = readySnapshot(source);
  for (const key of ['projects', 'project_items', 'plan_scopes'] as const) {
    (reorderedRaw[key] as unknown[]).reverse();
  }
  const reordered = preview(source, reorderedRaw);
  assert.equal(reordered.plan?.plan_hash, first.plan.plan_hash);
  assert.throws(
    () =>
      assertP013CertifiedMonthlyBaselinePlan({
        plan: first.plan!,
        source,
        snapshot: first.snapshot,
      }),
    /P013_PLAN_AUTHORITY_REQUIRED/u,
  );
});

test('D03 classifica baseline semanticamente idêntico como no_op_candidate', async (context) => {
  const source = await localSource(context);
  if (source === null) return;
  const first = preview(source);
  assert.ok(first.plan);
  const result = preview(source, matchingExistingSnapshot(source, first.plan));
  assert.equal(result.status, 'no_op_candidate');
  assert.equal(result.plan?.material_lines.length, 102);
});

test('D03 falha fechado para cruzamentos, inatividade, exclusão e ambiguidade de identidade', async (context) => {
  const source = await localSource(context);
  if (source === null) return;
  const mutations: Array<[string, (raw: Record<string, unknown>) => void]> = [
    [
      'wrong-source-key',
      (raw) =>
        ((raw['project_items'] as Array<Record<string, unknown>>)[0]!['source_line_key'] =
          `p012-item-v1:${'f'.repeat(64)}`),
    ],
    [
      'wrong-item-number',
      (raw) => ((raw['project_items'] as Array<Record<string, unknown>>)[0]!['line_number'] = 999),
    ],
    [
      'inactive',
      (raw) => ((raw['project_items'] as Array<Record<string, unknown>>)[0]!['active'] = false),
    ],
    [
      'deleted',
      (raw) =>
        ((raw['project_items'] as Array<Record<string, unknown>>)[0]!['deleted_at'] =
          '2026-08-20T00:00:00.000Z'),
    ],
    [
      'project-crossing',
      (raw) => {
        const items = raw['project_items'] as Array<Record<string, unknown>>;
        const crossed = items.find((item) => item['project_id'] !== items[0]!['project_id']);
        assert.ok(crossed);
        items[0]!['project_id'] = crossed['project_id'];
      },
    ],
    [
      'uuid-crossing',
      (raw) => {
        const items = raw['project_items'] as Array<Record<string, unknown>>;
        items[0]!['id'] = items[1]!['id'];
      },
    ],
    [
      'ambiguous-project',
      (raw) => {
        const projects = raw['projects'] as Array<Record<string, unknown>>;
        projects.push({ ...projects[0]!, id: fixtureUuid(4600, 1) });
      },
    ],
  ];
  for (const [name, mutate] of mutations) {
    const raw = readySnapshot(source);
    mutate(raw);
    try {
      const result = preview(source, raw);
      assert.equal(result.status, 'pending_decision', name);
      assert.equal(result.plan, null, name);
    } catch (error) {
      assert.equal(name, 'uuid-crossing');
      assert.match(String(error), /P013_SNAPSHOT_INVALID:item-id/u);
    }
  }
});

test('D03 representa NB01 como pending_decision e não produz plano apply-ready', async (context) => {
  const source = await localSource(context);
  if (source === null) return;
  const raw = readySnapshot(source);
  (raw['project_items'] as unknown[]).pop();
  const result = preview(source, raw);
  assert.equal(result.status, 'pending_decision');
  assert.equal(result.plan, null);
  assert.match(result.diagnostics.join('\n'), /P013_NB01_ITEM_UNRESOLVED/u);
});

test('D03 rejeita autoridade forjada por cópia, JSON, structuredClone, spread e rehash', async (context) => {
  const source = await localSource(context);
  if (source === null) return;
  assert.throws(
    () => readP013CertifiedMonthlySourceFacts({ ...source }),
    /P013_SOURCE_AUTHORITY_REQUIRED/u,
  );
  assert.throws(
    () =>
      readP013CertifiedMonthlySourceFacts(
        JSON.parse(JSON.stringify(source)) as P013CertifiedMonthlySource,
      ),
    /P013_SOURCE_AUTHORITY_REQUIRED/u,
  );
  const facts = readP013CertifiedMonthlySourceFacts(source);
  const originalFirstCell = structuredClone(facts.cells[0]);
  assert.throws(() => ((facts as unknown as { cells: unknown[] }).cells = []), TypeError);
  assert.throws(() => (facts.cells as unknown[]).push({}), TypeError);
  assert.throws(
    () =>
      ((facts.cells[0] as unknown as { project_code: string }).project_code =
        'P013-FORGED-PROJECT'),
    TypeError,
  );
  assert.deepEqual(readP013CertifiedMonthlySourceFacts(source).cells[0], originalFirstCell);
  assert.equal(Object.getOwnPropertyDescriptor(facts, 'cells')?.writable, false);
  assert.throws(() => Object.setPrototypeOf(facts, { cells: [] }), TypeError);
  assert.throws(
    () => readP013CertifiedMonthlySourceFacts(new Proxy(source, {}) as P013CertifiedMonthlySource),
    /P013_SOURCE_AUTHORITY_REQUIRED/u,
  );
  assert.throws(
    () =>
      readP013CertifiedMonthlySourceFacts({
        ...source,
        source_sha256: 'a'.repeat(64),
      } as P013CertifiedMonthlySource),
    /P013_SOURCE_AUTHORITY_REQUIRED/u,
  );
  const result = preview(source);
  assert.ok(result.plan);
  for (const forged of [
    { ...result.plan },
    structuredClone(result.plan),
    Object.assign({}, result.plan),
  ]) {
    assert.throws(
      () =>
        assertP013CertifiedMonthlyBaselinePlan({
          plan: forged,
          source,
          snapshot: result.snapshot,
        }),
      /P013_PLAN_AUTHORITY_REQUIRED/u,
    );
  }
  const actor = {
    app_user_id: fixtureUuid(4800, 1),
    auth_subject: 'auth0|p013-d04a-unit',
    request_id: 'p013-d04a-unit',
    justification: null,
    source: 'import' as const,
  };
  const forgedAdapters = [
    Object.freeze({ contract: 'ltcm.p013.local-postgres-dry-run-adapter.v1' }),
    { connect: () => ({ query: () => ({ rows: [] }) }) },
    { query: () => ({ rows: [] }) },
    { callback: () => readySnapshot(source) },
  ];
  for (const adapter of forgedAdapters) {
    await assert.rejects(
      runP013MonthlyBaselineDryRun({
        source,
        adapter: adapter as never,
        actor,
        targetPlanVersionId: PLAN_ID,
      }),
      /P013_ADAPTER_AUTHORITY_REQUIRED/u,
    );
  }
  const stale = structuredClone(result.snapshot) as unknown as Record<string, unknown>;
  (stale['projects'] as Array<Record<string, unknown>>)[0]!['status'] = 'draft';
  assert.throws(() => parseP013MonthlySnapshot(stale), /P013_SNAPSHOT_STALE_OR_FORGED/u);
  const sentinel = 'P013_D04A_SYNTHETIC_PASSWORD_SENTINEL';
  assert.throws(
    () =>
      createP013LocalPostgresDryRunAdapter(
        Object.defineProperty({}, 'databaseUrl', {
          get: () => {
            throw new Error(sentinel);
          },
        }) as { databaseUrl: string },
      ),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'P013_LOCAL_DATABASE_NOT_AUTHORIZED' &&
      !String(error).includes(sentinel),
  );
  const optionsSentinel = 'P013_D04A_PROXY_PASSWORD_SENTINEL';
  await assert.rejects(
    runP013MonthlyBaselineDryRun(
      new Proxy(
        {},
        {
          get: () => {
            throw new Error(optionsSentinel);
          },
        },
      ) as Parameters<typeof runP013MonthlyBaselineDryRun>[0],
    ),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'P013_DRY_RUN_FAILED' &&
      !String(error).includes(optionsSentinel),
  );
});

test('D04A sanitizes filesystem errors without exposing an absolute path', async () => {
  const sentinelPath = path.join(os.tmpdir(), 'P013_D04A_ABSOLUTE_PATH_SENTINEL', 'missing.xlsx');
  await assert.rejects(
    loadP013CertifiedMonthlySource(sentinelPath),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'P013_SOURCE_READ_FAILED' &&
      !String(error).includes(sentinelPath),
  );
});

test('D04A does not publish planner or test support through the package boundary', async () => {
  for (const specifier of [
    '@ltcm/normalizer',
    '@ltcm/normalizer/monthly-baseline-plan',
    '@ltcm/normalizer/test-support',
  ]) {
    await assert.rejects(
      import(specifier),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    );
  }
});

test('D03 conserva equivalência semântica entre SHAs distintos sem duplicar chaves materiais', async (context) => {
  const source = await localSource(context);
  if (source === null) return;
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'ltcm-p013-d03-'));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const copy = path.join(temporary, 'equivalent.xlsx');
  const sourceDirectory = path.join(ROOT, '.local-source');
  const sourceName = (await readdir(sourceDirectory)).find((candidate) =>
    candidate.endsWith('.xlsx'),
  )!;
  await copyFile(path.join(sourceDirectory, sourceName), copy);
  await chmod(copy, 0o666);
  await appendFile(copy, Buffer.from('P013-D03-COSMETIC-ZIP-TRAILER', 'utf8'));
  const equivalent = await loadP013CertifiedMonthlySource(copy);
  assert.notEqual(source.source_sha256, equivalent.source_sha256);
  assert.equal(source.source_semantic_fingerprint, equivalent.source_semantic_fingerprint);
  const left = preview(source);
  const right = preview(equivalent);
  assert.equal(left.plan?.baseline_semantic_fingerprint, right.plan?.baseline_semantic_fingerprint);
  assert.deepEqual(
    left.plan?.material_lines.map(({ line_key }) => line_key),
    right.plan?.material_lines.map(({ line_key }) => line_key),
  );
});

test('D03 deriva conflito de baseline divergente e falha fechado para escopo ou plano inválido', async (context) => {
  const source = await localSource(context);
  if (source === null) return;
  const initial = preview(source);
  assert.ok(initial.plan);
  const conflict = matchingExistingSnapshot(source, initial.plan);
  (conflict['existing_baselines'] as Array<Record<string, unknown>>)[0]!['semantic_fingerprint'] =
    'f'.repeat(64);
  const conflictResult = preview(source, conflict);
  assert.equal(conflictResult.status, 'conflict');
  assert.match(conflictResult.diagnostics.join('\n'), /P013_EXISTING_BASELINE_CONFLICT/u);
  const missingScope = readySnapshot(source);
  (missingScope['plan_scopes'] as unknown[]).pop();
  const pending = preview(source, missingScope);
  assert.equal(pending.status, 'pending_decision');
  assert.match(pending.diagnostics.join('\n'), /P013_PLAN_SCOPE_MISSING/u);
  const invalidPlan = readySnapshot(source);
  invalidPlan['target_plan_version'] = { id: PLAN_ID, status: 'approved', is_baseline: true };
  const rejected = preview(source, invalidPlan);
  assert.equal(rejected.status, 'pending_decision');
  assert.match(rejected.diagnostics.join('\n'), /P013_TARGET_PLAN_VERSION_NOT_DRAFT_BASELINE/u);
});

function snapshotRows(raw: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  return raw[key] as Array<Record<string, unknown>>;
}

function setFirstSnapshotValue(
  raw: Record<string, unknown>,
  key: string,
  field: string,
  value: unknown,
): void {
  snapshotRows(raw, key)[0]![field] = value;
}

test('D04A rejects false no-op across baseline, cell, line, and execution', async (context) => {
  const source = await localSource(context);
  if (source === null) return;
  const initial = preview(source);
  assert.ok(initial.plan);
  const mutations: Array<[string, (raw: Record<string, unknown>) => void]> = [
    [
      'baseline-plan-version',
      (raw) =>
        setFirstSnapshotValue(raw, 'existing_baselines', 'plan_version_id', fixtureUuid(4900, 1)),
    ],
    [
      'baseline-fingerprint',
      (raw) =>
        setFirstSnapshotValue(raw, 'existing_baselines', 'semantic_fingerprint', 'e'.repeat(64)),
    ],
    ['missing-cell', (raw) => snapshotRows(raw, 'existing_cells').pop()],
    [
      'extra-cell',
      (raw) =>
        snapshotRows(raw, 'existing_cells').push({
          ...snapshotRows(raw, 'existing_cells')[0]!,
          competence_month: '2099-01-01',
          source_cell_reference: 'Q999',
        }),
    ],
    [
      'duplicate-cell',
      (raw) =>
        snapshotRows(raw, 'existing_cells').push({ ...snapshotRows(raw, 'existing_cells')[0]! }),
    ],
    [
      'cell-competence',
      (raw) => setFirstSnapshotValue(raw, 'existing_cells', 'competence_month', '2099-01-01'),
    ],
    [
      'cell-item',
      (raw) =>
        setFirstSnapshotValue(raw, 'existing_cells', 'project_item_id', fixtureUuid(4900, 2)),
    ],
    [
      'cell-project',
      (raw) => setFirstSnapshotValue(raw, 'existing_cells', 'project_id', fixtureUuid(4900, 7)),
    ],
    [
      'cell-amount',
      (raw) => {
        const cell = snapshotRows(raw, 'existing_cells').find(
          (row) => row['declaration_state'] !== 'blank',
        )!;
        cell['canonical_amount'] = '999.99';
      },
    ],
    [
      'cell-state',
      (raw) => {
        const cell = snapshotRows(raw, 'existing_cells').find(
          (row) => row['declaration_state'] === 'value',
        )!;
        cell['declaration_state'] = 'explicit_zero';
        cell['source_numeric_text'] = '0';
        cell['canonical_amount'] = '0.00';
      },
    ],
    [
      'explicit-zero-amount',
      (raw) => {
        const cell = snapshotRows(raw, 'existing_cells').find(
          (row) => row['declaration_state'] === 'explicit_zero',
        )!;
        cell['source_numeric_text'] = '0.01';
        cell['canonical_amount'] = '0.01';
      },
    ],
    [
      'cell-source-line',
      (raw) =>
        setFirstSnapshotValue(
          raw,
          'existing_cells',
          'source_line_key',
          `p012-item-v1:${'d'.repeat(64)}`,
        ),
    ],
    ['missing-line', (raw) => snapshotRows(raw, 'existing_plan_lines').pop()],
    [
      'extra-line',
      (raw) =>
        snapshotRows(raw, 'existing_plan_lines').push({
          ...snapshotRows(raw, 'existing_plan_lines')[0]!,
          id: fixtureUuid(4900, 3),
          competence_month: '2099-01-01',
        }),
    ],
    [
      'duplicate-line',
      (raw) =>
        snapshotRows(raw, 'existing_plan_lines').push({
          ...snapshotRows(raw, 'existing_plan_lines')[0]!,
          id: fixtureUuid(4900, 4),
        }),
    ],
    [
      'line-competence',
      (raw) => setFirstSnapshotValue(raw, 'existing_plan_lines', 'competence_month', '2099-01-01'),
    ],
    [
      'line-item',
      (raw) =>
        setFirstSnapshotValue(raw, 'existing_plan_lines', 'project_item_id', fixtureUuid(4900, 5)),
    ],
    ['line-amount', (raw) => setFirstSnapshotValue(raw, 'existing_plan_lines', 'amount', '999.99')],
    [
      'crossed-baseline-id',
      (raw) => setFirstSnapshotValue(raw, 'existing_cells', 'baseline_id', fixtureUuid(4900, 6)),
    ],
    [
      'crossed-financial-line',
      (raw) => {
        const cells = snapshotRows(raw, 'existing_cells').filter(
          (row) => row['financial_plan_line_id'] !== null,
        );
        cells[0]!['financial_plan_line_id'] = cells[1]!['financial_plan_line_id'];
      },
    ],
    [
      'execution-artifact-chain',
      (raw) => setFirstSnapshotValue(raw, 'existing_executions', 'source_sha256', 'c'.repeat(64)),
    ],
  ];
  for (const [name, mutate] of mutations) {
    const raw = matchingExistingSnapshot(source, initial.plan);
    mutate(raw);
    try {
      const result = preview(source, raw);
      assert.equal(result.status, 'conflict', name);
      assert.match(result.diagnostics.join('\n'), /P013_(EXISTING_BASELINE_CONFLICT|ORPHAN)/u);
    } catch (error) {
      assert.match(String(error), /P013_SNAPSHOT_(INVALID|STALE_OR_FORGED)/u, name);
    }
  }
});
