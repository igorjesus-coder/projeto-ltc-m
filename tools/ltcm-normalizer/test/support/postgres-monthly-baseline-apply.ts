import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { appendFile, chmod, copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import nodeTest from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  loadP013CertifiedMonthlySource,
  readP013CertifiedMonthlySourceFacts,
  type P013CertifiedMonthlySource,
} from '@ltcm/extractor/p013';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

import { sha256Canonical } from '../../src/canonical-json.js';
import { createSourceLineKey } from '../../src/item-contracts.js';
import {
  assertP013CertifiedMonthlyBaselinePlan,
  createP013LocalPostgresDryRunAdapter,
  deriveP013MonthlyBaselinePreviewForTest,
  runP013MonthlyBaselineDryRun,
  type P013ActorContext,
  type P013CanonicalPlanCell,
  type P013LocalPostgresDryRunAdapter,
  type P013MonthlyBaselinePlan,
  type P013MonthlyDryRunResult,
} from '../../src/monthly-baseline-plan.js';
import { parseP012LoopbackDatabaseUrlForTestHarness } from './postgres-item-persistence.js';

function isExplicitNodeTestEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  return (
    entrypoint !== undefined &&
    process.env['NODE_TEST_CONTEXT'] !== undefined &&
    path.resolve(entrypoint) === fileURLToPath(import.meta.url)
  );
}

// Importing this file only evaluates private definitions. Test registration is
// delegated to node:test exclusively when this file is the explicit test-worker
// entrypoint; environment flags cannot turn a filesystem import into execution.
const test = isExplicitNodeTestEntrypoint()
  ? nodeTest
  : ((() => undefined) as unknown as typeof nodeTest);

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_ATTEMPTS = 2;

type P013ApplyErrorCode =
  | 'P013_APPLY_LOCAL_DATABASE_NOT_AUTHORIZED'
  | 'P013_APPLY_INPUT_INVALID'
  | 'P013_APPLY_CAPABILITY_REQUIRED'
  | 'P013_APPLY_PLAN_NOT_READY'
  | 'P013_APPLY_STALE_PLAN'
  | 'P013_APPLY_CONFLICT'
  | 'P013_APPLY_IDENTITY_CONFLICT'
  | 'P013_APPLY_RETRY_EXHAUSTED'
  | 'P013_APPLY_TRANSACTION_FAILED';

class P013ApplyError extends Error {
  readonly code: P013ApplyErrorCode;

  constructor(code: P013ApplyErrorCode) {
    super(code);
    this.name = 'P013ApplyError';
    this.code = code;
  }
}

interface P013MonthlyBaselineApplyReceipt {
  readonly contract: 'ltcm.p013.monthly-baseline-local-apply-receipt.v1';
  readonly status: 'inserted' | 'no_op';
  readonly committed: true;
  readonly plan_version_id: string;
  readonly baseline_id: string;
  readonly import_batch_id: string;
  readonly execution_id: string;
  readonly source_artifact_id: string;
  readonly artifact_outcome: 'inserted' | 'reused';
  readonly baseline_outcome: 'inserted' | 'reused';
  readonly position_count: number;
  readonly blank_count: number;
  readonly explicit_zero_count: number;
  readonly non_zero_count: number;
  readonly financial_line_count: number;
  readonly canonical_total: string;
  readonly transaction_isolation: 'serializable';
  readonly runtime_role: 'ltc_m_runtime';
  readonly advisory_lock_count: number;
  readonly attempts: number;
}

interface P013MonthlyBaselineLocalApplyHarness {
  readonly contract: 'ltcm.p013.monthly-baseline-local-apply-harness.v1';
  dryRun(options: {
    source: P013CertifiedMonthlySource;
    actor: P013ActorContext;
    targetPlanVersionId: string;
  }): Promise<P013MonthlyDryRunResult>;
  apply(result: P013MonthlyDryRunResult): Promise<P013MonthlyBaselineApplyReceipt>;
  close(): Promise<void>;
}

type TestFault = '40001_once' | '40P01_once' | '23505_once' | 'late_failure_once';

interface HarnessState {
  pool: Pool;
  adapter: P013LocalPostgresDryRunAdapter;
  databaseName: string;
  closed: boolean;
  fault: TestFault | null;
  faultConsumed: boolean;
}

interface ApplyAuthority {
  harness: P013MonthlyBaselineLocalApplyHarness;
  source: P013CertifiedMonthlySource;
  actor: P013ActorContext;
  result: P013MonthlyDryRunResult;
  plan: P013MonthlyBaselinePlan;
}

const harnessStates = new WeakMap<object, HarnessState>();
const applyAuthorities = new WeakMap<object, ApplyAuthority>();

function fail(code: P013ApplyErrorCode): never {
  throw new P013ApplyError(code);
}

function rawHostname(value: string): string {
  const protocolEnd = value.indexOf('://');
  const endings = [
    value.indexOf('/', protocolEnd + 3),
    value.indexOf('?', protocolEnd + 3),
    value.indexOf('#', protocolEnd + 3),
  ].filter((index) => index >= 0);
  const authorityEnd = endings.length === 0 ? value.length : Math.min(...endings);
  const authority = value.slice(protocolEnd + 3, authorityEnd);
  const hostAndPort = authority.slice(authority.lastIndexOf('@') + 1);
  if (hostAndPort.startsWith('[')) {
    const closing = hostAndPort.indexOf(']');
    return closing < 0 ? hostAndPort : hostAndPort.slice(0, closing + 1);
  }
  const colon = hostAndPort.lastIndexOf(':');
  return colon < 0 ? hostAndPort : hostAndPort.slice(0, colon);
}

function authorizeLocalUrl(value: string): { databaseName: string } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail('P013_APPLY_LOCAL_DATABASE_NOT_AUTHORIZED');
  }
  const hostname = parsed.hostname.toLowerCase();
  const suppliedHostname = rawHostname(value).toLowerCase();
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const port = parsed.port === '' ? 5432 : Number(parsed.port);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(hostname) ||
    suppliedHostname !== hostname ||
    databaseName !== 'ltcm_test' ||
    parsed.pathname !== `/${encodeURIComponent(databaseName)}` ||
    port !== 5432 ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    fail('P013_APPLY_LOCAL_DATABASE_NOT_AUTHORIZED');
  }
  return { databaseName };
}

function assertLoopbackPeer(client: PoolClient): void {
  const remoteAddress = (
    client as PoolClient & { connection?: { stream?: { remoteAddress?: unknown } } }
  ).connection?.stream?.remoteAddress;
  if (
    typeof remoteAddress !== 'string' ||
    !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress.toLowerCase())
  ) {
    fail('P013_APPLY_LOCAL_DATABASE_NOT_AUTHORIZED');
  }
}

function field(row: QueryResultRow | undefined, key: string): unknown {
  return row?.[key];
}

async function attestSession(client: PoolClient, databaseName: string): Promise<void> {
  assertLoopbackPeer(client);
  const result = await client.query(`select current_database() as database_name,
    current_user, session_user, current_setting('server_version_num') as server_version_num,
    roles.rolsuper, roles.rolbypassrls,
    pg_catalog.pg_has_role(session_user, 'ltc_m_runtime', 'set') as can_set_runtime
    from pg_catalog.pg_roles as roles where roles.rolname = session_user`);
  const row = result.rows[0];
  if (
    result.rowCount !== 1 ||
    field(row, 'database_name') !== databaseName ||
    field(row, 'current_user') !== field(row, 'session_user') ||
    !String(field(row, 'server_version_num')).startsWith('17') ||
    field(row, 'rolsuper') !== false ||
    field(row, 'rolbypassrls') !== false ||
    field(row, 'can_set_runtime') !== true
  ) {
    fail('P013_APPLY_LOCAL_DATABASE_NOT_AUTHORIZED');
  }
}

async function establishRuntimeActor(client: PoolClient, actor: P013ActorContext): Promise<void> {
  await client.query('set local role ltc_m_runtime');
  await client.query(
    `select ltc_m.set_actor_context($1::uuid, $2::text, $3::text, $4::text, $5::text, false)`,
    [actor.app_user_id, actor.auth_subject, actor.request_id, actor.justification, actor.source],
  );
  const result = await client.query(`select current_user, session_user,
    current_setting('transaction_isolation') as transaction_isolation,
    roles.rolsuper, roles.rolbypassrls, auth.app_user_id::text as app_user_id,
    auth.app_role::text as app_role
    from pg_catalog.pg_roles as roles cross join ltc_m.authorization_context() as auth
    where roles.rolname = current_user`);
  const row = result.rows[0];
  if (
    result.rowCount !== 1 ||
    field(row, 'current_user') !== 'ltc_m_runtime' ||
    field(row, 'current_user') === field(row, 'session_user') ||
    field(row, 'transaction_isolation') !== 'serializable' ||
    field(row, 'rolsuper') !== false ||
    field(row, 'rolbypassrls') !== false ||
    field(row, 'app_user_id') !== actor.app_user_id ||
    !['admin', 'editor'].includes(String(field(row, 'app_role')))
  ) {
    fail('P013_APPLY_LOCAL_DATABASE_NOT_AUTHORIZED');
  }
  const rls = await client.query(
    `select count(*)::integer as count
    from pg_catalog.pg_class as classes
    join pg_catalog.pg_namespace as namespaces on namespaces.oid = classes.relnamespace
    where namespaces.nspname = 'ltc_m'
      and classes.relname = any($1::text[])
      and classes.relrowsecurity and classes.relforcerowsecurity`,
    [
      [
        'monthly_source_artifacts',
        'monthly_plan_baselines',
        'monthly_plan_import_executions',
        'monthly_plan_cells',
      ],
    ],
  );
  if (field(rls.rows[0], 'count') !== 4) fail('P013_APPLY_LOCAL_DATABASE_NOT_AUTHORIZED');
}

const SNAPSHOT_SQL = `
select jsonb_build_object(
  'contract', 'ltcm.p013.monthly-baseline-snapshot.v1',
  'target_plan_version', (select jsonb_build_object('id', id::text, 'status', status::text,
    'is_baseline', is_baseline) from ltc_m.plan_versions where id = $1::uuid),
  'projects', coalesce((select jsonb_agg(jsonb_build_object('id', id::text,
    'project_code', project_code, 'status', status::text, 'deleted_at',
    case when deleted_at is null then null else to_char(deleted_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end) order by project_code collate "C", id)
    from ltc_m.projects where project_code = any($2::text[])), '[]'::jsonb),
  'project_items', coalesce((select jsonb_agg(jsonb_build_object('id', items.id::text,
    'project_id', items.project_id::text, 'source_line_key', items.source_line_key,
    'line_number', items.line_number, 'active', items.active, 'deleted_at',
    case when items.deleted_at is null then null else to_char(items.deleted_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end) order by items.project_id,
    items.source_line_key collate "C", items.id) from ltc_m.project_items as items
    join ltc_m.projects as projects on projects.id = items.project_id
    where projects.project_code = any($2::text[])), '[]'::jsonb),
  'plan_scopes', coalesce((select jsonb_agg(jsonb_build_object('project_id', project_id::text,
    'metric_type', metric_type::text, 'planning_level', planning_level::text,
    'currency_code', currency_code) order by project_id) from ltc_m.financial_plan_scopes
    where plan_version_id = $1::uuid and metric_type = 'billing_planned'
      and project_id in (select id from ltc_m.projects where project_code = any($2::text[]))),
    '[]'::jsonb),
  'existing_baselines', coalesce((select jsonb_agg(jsonb_build_object('id', id::text,
    'plan_version_id', plan_version_id::text, 'metric_type', metric_type::text,
    'planning_level', planning_level::text, 'semantic_fingerprint', semantic_fingerprint)
    order by id) from ltc_m.monthly_plan_baselines where plan_version_id = $1::uuid
    and metric_type = 'billing_planned'), '[]'::jsonb),
  'existing_cells', coalesce((select jsonb_agg(jsonb_build_object('baseline_id', baseline_id::text,
    'project_id', project_id::text, 'project_item_id', project_item_id::text,
    'competence_month', competence_month::text, 'source_line_key', source_line_key,
    'source_item_number', source_item_number, 'source_row_number', source_row_number,
    'source_column', source_column, 'source_cell_reference', source_cell_reference,
    'declaration_state', declaration_state, 'source_numeric_text', source_numeric_text,
    'source_value_hash', source_value_hash, 'canonical_amount', canonical_amount::text,
    'financial_plan_line_id', financial_plan_line_id::text) order by baseline_id,
    project_item_id, competence_month) from ltc_m.monthly_plan_cells
    where plan_version_id = $1::uuid and metric_type = 'billing_planned'), '[]'::jsonb),
  'existing_plan_lines', coalesce((select jsonb_agg(jsonb_build_object('id', id::text,
    'project_id', project_id::text, 'project_item_id', project_item_id::text,
    'competence_month', competence_month::text, 'amount', amount::text,
    'currency_code', currency_code) order by project_item_id, competence_month)
    from ltc_m.financial_plan_lines where plan_version_id = $1::uuid
    and metric_type = 'billing_planned'), '[]'::jsonb),
  'existing_artifacts', coalesce((select jsonb_agg(jsonb_build_object('source_sha256',
    source_sha256, 'source_semantic_fingerprint', source_semantic_fingerprint)
    order by source_sha256) from ltc_m.monthly_source_artifacts
    where source_sha256 = $3::text or source_semantic_fingerprint = $4::text), '[]'::jsonb),
  'existing_executions', coalesce((select jsonb_agg(jsonb_build_object('source_sha256',
    source_sha256, 'baseline_id', baseline_id::text, 'baseline_semantic_fingerprint',
    baseline_semantic_fingerprint, 'plan_version_id', plan_version_id::text) order by source_sha256)
    from ltc_m.monthly_plan_import_executions where plan_version_id = $1::uuid), '[]'::jsonb),
  'read_scope', jsonb_build_object('project_codes', to_jsonb($2::text[]),
    'target_plan_version_id', $1::text)
) as snapshot`;

function planMaterialHash(plan: P013MonthlyBaselinePlan): string {
  return sha256Canonical({
    target_plan_version_id: plan.target_plan_version_id,
    metric_type: plan.metric_type,
    planning_level: plan.planning_level,
    baseline_semantic_fingerprint: plan.baseline_semantic_fingerprint,
    idempotency_key: plan.idempotency_key,
    cells: plan.cells,
    material_lines: plan.material_lines,
    item_reconciliation: plan.item_reconciliation,
    global_reconciliation: plan.global_reconciliation,
  });
}

async function acquireLocks(client: PoolClient, plan: P013MonthlyBaselinePlan): Promise<number> {
  const projectIds = [...new Set(plan.cells.map(({ project_id }) => project_id))].sort((a, b) =>
    a.localeCompare(b, 'en'),
  );
  const keys = [
    `ltc_m.p013.plan:${plan.target_plan_version_id}`,
    ...projectIds.map((id) => `ltc_m.p013.project:${id}`),
  ];
  for (const key of keys) {
    await client.query(
      `select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0))`,
      [key],
    );
  }
  return keys.length;
}

async function readFreshPlan(
  client: PoolClient,
  authority: ApplyAuthority,
): Promise<P013MonthlyBaselinePlan> {
  const sourceFacts = readP013CertifiedMonthlySourceFacts(authority.source);
  const projectCodes = [...new Set(sourceFacts.cells.map(({ project_code }) => project_code))].sort(
    (a, b) => a.localeCompare(b, 'en'),
  );
  const result = await client.query(SNAPSHOT_SQL, [
    authority.plan.target_plan_version_id,
    projectCodes,
    authority.source.source_sha256,
    authority.source.source_semantic_fingerprint,
  ]);
  const preview = deriveP013MonthlyBaselinePreviewForTest({
    source: authority.source,
    snapshot: result.rows[0]?.['snapshot'],
  });
  if (preview.plan === null || !['ready', 'no_op_candidate'].includes(preview.status)) {
    if (preview.status === 'conflict') fail('P013_APPLY_CONFLICT');
    fail('P013_APPLY_STALE_PLAN');
  }
  if (planMaterialHash(preview.plan) !== planMaterialHash(authority.plan)) {
    fail('P013_APPLY_STALE_PLAN');
  }
  return preview.plan;
}

async function persistArtifact(
  client: PoolClient,
  source: P013CertifiedMonthlySource,
  actorId: string,
): Promise<{ id: string; outcome: 'inserted' | 'reused' }> {
  const existing = await client.query(
    `select id::text as id, source_sha256, source_size_bytes::text as source_size_bytes,
      source_mime_type, source_name, source_contract_version, worksheet_key, worksheet_name,
      structural_range, source_semantic_fingerprint from ltc_m.monthly_source_artifacts
      where source_sha256 = $1::text`,
    [source.source_sha256],
  );
  if (existing.rowCount === 1) {
    const row = existing.rows[0];
    if (
      field(row, 'source_size_bytes') !== String(source.source_size_bytes) ||
      field(row, 'source_mime_type') !== MIME ||
      field(row, 'source_name') !== source.source_name ||
      field(row, 'source_contract_version') !== 'ltcm.p013.source-artifact.v1' ||
      field(row, 'worksheet_key') !== source.worksheet_key ||
      field(row, 'worksheet_name') !== source.worksheet_name ||
      field(row, 'structural_range') !== source.structural_range ||
      field(row, 'source_semantic_fingerprint') !== source.source_semantic_fingerprint
    ) {
      fail('P013_APPLY_CONFLICT');
    }
    return { id: String(field(row, 'id')), outcome: 'reused' };
  }
  if (existing.rowCount !== 0) fail('P013_APPLY_CONFLICT');
  const inserted = await client.query(
    `insert into ltc_m.monthly_source_artifacts
      (source_sha256, source_size_bytes, source_mime_type, source_name,
       source_contract_version, worksheet_key, worksheet_name, structural_range,
       source_semantic_fingerprint, created_by_user_id)
     values ($1::text, $2::bigint, $3::text, $4::text, 'ltcm.p013.source-artifact.v1',
       'monthly_revenue', 'Prev. Receita Mensal', 'A1:T52', $5::text, $6::uuid)
     returning id::text as id`,
    [
      source.source_sha256,
      source.source_size_bytes,
      MIME,
      source.source_name,
      source.source_semantic_fingerprint,
      actorId,
    ],
  );
  if (inserted.rowCount !== 1) fail('P013_APPLY_TRANSACTION_FAILED');
  return { id: String(field(inserted.rows[0], 'id')), outcome: 'inserted' };
}

async function existingReceipt(
  client: PoolClient,
  plan: P013MonthlyBaselinePlan,
): Promise<{ baselineId: string; batchId: string; executionId: string }> {
  const result = await client.query(
    `select baselines.id::text as baseline_id, executions.import_batch_id::text as batch_id,
      executions.id::text as execution_id
      from ltc_m.monthly_plan_baselines as baselines
      join ltc_m.monthly_plan_import_executions as executions
        on executions.baseline_id = baselines.id
      where baselines.plan_version_id = $1::uuid
        and baselines.metric_type = 'billing_planned'
        and baselines.semantic_fingerprint = $2::text
      order by executions.created_at, executions.id limit 2`,
    [plan.target_plan_version_id, plan.baseline_semantic_fingerprint],
  );
  if (result.rowCount !== 1) fail('P013_APPLY_CONFLICT');
  return {
    baselineId: String(field(result.rows[0], 'baseline_id')),
    batchId: String(field(result.rows[0], 'batch_id')),
    executionId: String(field(result.rows[0], 'execution_id')),
  };
}

function rowsBySource(plan: P013MonthlyBaselinePlan): Array<{
  source_row_number: number;
  source_row_hash: string;
  project_item_id: string;
  cells: P013CanonicalPlanCell[];
}> {
  const groups = new Map<number, P013CanonicalPlanCell[]>();
  for (const cell of plan.cells) {
    groups.set(cell.source_row_number, [...(groups.get(cell.source_row_number) ?? []), cell]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([sourceRowNumber, cells]) => {
      const hashes = new Set(cells.map(({ source_row_hash }) => source_row_hash));
      const items = new Set(cells.map(({ project_item_id }) => project_item_id));
      if (cells.length !== 9 || hashes.size !== 1 || items.size !== 1) fail('P013_APPLY_CONFLICT');
      return {
        source_row_number: sourceRowNumber,
        source_row_hash: cells[0]!.source_row_hash,
        project_item_id: cells[0]!.project_item_id,
        cells,
      };
    });
}

async function insertFirstApply(
  client: PoolClient,
  authority: ApplyAuthority,
  plan: P013MonthlyBaselinePlan,
  artifactId: string,
): Promise<{ baselineId: string; batchId: string; executionId: string }> {
  const actorId = authority.actor.app_user_id;
  const source = authority.source;
  const rows = rowsBySource(plan);
  if (rows.length !== 48 || plan.cells.length !== 432 || plan.material_lines.length !== 102) {
    fail('P013_APPLY_CONFLICT');
  }
  const preexistingBatch = await client.query(
    `select id from ltc_m.import_batches where idempotency_key = $1::text for share`,
    [plan.idempotency_key],
  );
  if (preexistingBatch.rowCount !== 0) fail('P013_APPLY_CONFLICT');
  const batch = await client.query(
    `insert into ltc_m.import_batches
      (source_name, source_hash, source_size_bytes, source_mime_type, idempotency_key,
       request_id, status, received_rows, accepted_rows, rejected_rows, sheet_count,
       staged_rows, valid_rows, error_count, metadata, submitted_by_user_id)
     values ($1::text, $2::text, $3::bigint, $4::text, $5::text, $6::text,
       'loaded', 48, 48, 0, 1, 48, 48, 0, $7::jsonb, $8::uuid)
     returning id::text as id`,
    [
      source.source_name,
      source.source_sha256,
      source.source_size_bytes,
      MIME,
      plan.idempotency_key,
      authority.actor.request_id,
      JSON.stringify({
        contract: 'ltcm.p013.monthly-import-batch.v1',
        source_semantic_fingerprint: source.source_semantic_fingerprint,
      }),
      actorId,
    ],
  );
  const batchId = String(field(batch.rows[0], 'id'));
  const sheet = await client.query(
    `insert into ltc_m.import_batch_sheets
      (import_batch_id, sheet_key, sheet_name, sheet_index, detected_range, first_row,
       last_row, found_rows, staged_rows, rejected_rows, content_hash, status, metadata,
       created_by_user_id, request_id)
     values ($1::uuid, 'monthly_revenue', 'Prev. Receita Mensal', 1, 'A1:T52', 1, 52,
       48, 48, 0, $2::text, 'completed', $3::jsonb, $4::uuid, $5::text)
     returning id::text as id`,
    [
      batchId,
      source.source_semantic_fingerprint,
      JSON.stringify({ contract: 'ltcm.p013.monthly-import-sheet.v1' }),
      actorId,
      authority.actor.request_id,
    ],
  );
  const sheetId = String(field(sheet.rows[0], 'id'));
  const stagingInput = rows.map((row) => ({
    source_row_number: row.source_row_number,
    source_range: `A${row.source_row_number}:T${row.source_row_number}`,
    row_hash: row.source_row_hash,
    project_item_id: row.project_item_id,
    raw_payload: {
      contract: 'ltcm.p013.monthly-staging-row.v1',
      source_row_number: row.source_row_number,
      source_row_hash: row.source_row_hash,
      source_cells: row.cells.map((cell) => ({
        reference: cell.source_cell_reference,
        fingerprint: cell.source_cell_fingerprint,
      })),
    },
  }));
  const staging = await client.query(
    `with input as (select * from jsonb_to_recordset($1::jsonb) as value(
       source_row_number integer, source_range text, row_hash text,
       project_item_id uuid, raw_payload jsonb))
     insert into ltc_m.import_staging_rows
       (import_batch_sheet_id, source_row_number, source_range, row_kind, raw_payload,
        row_hash, status, validation_attempt, target_table, target_record_id,
        validated_at, processed_at, created_by_user_id, request_id)
     select $2::uuid, source_row_number, source_range, 'data', raw_payload, row_hash,
       'processed', 1, 'project_items', project_item_id, clock_timestamp(),
       clock_timestamp(), $3::uuid, $4::text from input
     returning id::text as id, source_row_number`,
    [JSON.stringify(stagingInput), sheetId, actorId, authority.actor.request_id],
  );
  if (staging.rowCount !== 48) fail('P013_APPLY_TRANSACTION_FAILED');
  const stagingByRow = new Map(
    staging.rows.map((row) => [Number(field(row, 'source_row_number')), String(field(row, 'id'))]),
  );
  const baseline = await client.query(
    `insert into ltc_m.monthly_plan_baselines
      (plan_version_id, metric_type, planning_level, semantic_contract_version,
       semantic_fingerprint, created_by_user_id)
     values ($1::uuid, 'billing_planned', 'item',
       'ltcm.p013.monthly-baseline-semantic.v1', $2::text, $3::uuid)
     returning id::text as id`,
    [plan.target_plan_version_id, plan.baseline_semantic_fingerprint, actorId],
  );
  const baselineId = String(field(baseline.rows[0], 'id'));
  const lineInput = plan.material_lines.map((line) => ({
    line_key: line.line_key,
    plan_version_id: line.plan_version_id,
    project_id: line.project_id,
    project_item_id: line.project_item_id,
    competence_month: line.competence_month,
    amount: line.amount,
    currency_code: line.currency_code,
  }));
  const lines = await client.query(
    `with input as (select * from jsonb_to_recordset($1::jsonb) as value(
       line_key text, plan_version_id uuid, project_id uuid, project_item_id uuid,
       competence_month date, amount numeric, currency_code text))
     insert into ltc_m.financial_plan_lines
       (plan_version_id, project_id, project_item_id, metric_type, planning_level,
        competence_month, amount, currency_code, notes, created_by_user_id)
     select plan_version_id, project_id, project_item_id, 'billing_planned', 'item',
       competence_month, amount, currency_code, line_key, $2::uuid from input
     returning id::text as id, project_item_id::text as project_item_id,
       competence_month::text as competence_month`,
    [JSON.stringify(lineInput), actorId],
  );
  if (lines.rowCount !== plan.material_lines.length) fail('P013_APPLY_TRANSACTION_FAILED');
  const lineByGrain = new Map(
    lines.rows.map((row) => [
      `${String(field(row, 'project_item_id'))}\0${String(field(row, 'competence_month'))}`,
      String(field(row, 'id')),
    ]),
  );
  const execution = await client.query(
    `insert into ltc_m.monthly_plan_import_executions
      (import_batch_id, source_artifact_id, source_sha256, baseline_id,
       baseline_semantic_fingerprint, plan_version_id, metric_type, planning_level,
       created_by_user_id)
     values ($1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::uuid,
       'billing_planned', 'item', $7::uuid) returning id::text as id`,
    [
      batchId,
      artifactId,
      source.source_sha256,
      baselineId,
      plan.baseline_semantic_fingerprint,
      plan.target_plan_version_id,
      actorId,
    ],
  );
  const executionId = String(field(execution.rows[0], 'id'));
  const cellInput = plan.cells.map((cell) => ({
    import_staging_row_id: stagingByRow.get(cell.source_row_number),
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
        : lineByGrain.get(`${cell.project_item_id}\0${cell.competence_month}`),
  }));
  if (
    cellInput.some(
      (cell) =>
        cell.import_staging_row_id === undefined ||
        (cell.declaration_state !== 'blank' && cell.financial_plan_line_id === undefined),
    )
  ) {
    fail('P013_APPLY_TRANSACTION_FAILED');
  }
  const cells = await client.query(
    `with input as (select * from jsonb_to_recordset($1::jsonb) as value(
       import_staging_row_id uuid, project_id uuid, project_item_id uuid,
       competence_month date, source_line_key text, source_item_number text,
       source_row_number integer, source_column text, source_cell_reference text,
       declaration_state text, source_numeric_text text, source_value_hash text,
       canonical_amount numeric, financial_plan_line_id uuid))
     insert into ltc_m.monthly_plan_cells
       (import_batch_id, import_batch_sheet_id, import_staging_row_id, baseline_id,
        baseline_semantic_fingerprint, plan_version_id, project_id, project_item_id,
        metric_type, planning_level, competence_month, source_line_key, source_item_number,
        source_row_number, source_column, source_cell_reference, declaration_state,
        source_numeric_text, source_value_hash, canonical_amount, financial_plan_line_id,
        created_by_user_id)
     select $2::uuid, $3::uuid, import_staging_row_id, $4::uuid, $5::text, $6::uuid,
       project_id, project_item_id, 'billing_planned', 'item', competence_month,
       source_line_key, source_item_number, source_row_number, source_column,
       source_cell_reference, declaration_state, source_numeric_text, source_value_hash,
       canonical_amount, financial_plan_line_id, $7::uuid from input
     returning id`,
    [
      JSON.stringify(cellInput),
      batchId,
      sheetId,
      baselineId,
      plan.baseline_semantic_fingerprint,
      plan.target_plan_version_id,
      actorId,
    ],
  );
  if (cells.rowCount !== 432) fail('P013_APPLY_TRANSACTION_FAILED');
  return { baselineId, batchId, executionId };
}

function pgCode(error: unknown): string | null {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

function injectFault(state: HarnessState, stage: 'before_write' | 'late'): void {
  if (state.fault === null || state.faultConsumed) return;
  const isLate = state.fault === 'late_failure_once';
  if ((stage === 'late') !== isLate) return;
  state.faultConsumed = true;
  if (isLate) throw new Error('synthetic late failure');
  const error = new Error('synthetic PostgreSQL retry signal') as Error & { code: string };
  error.code = state.fault.replace('_once', '');
  throw error;
}

function receipt(options: {
  status: 'inserted' | 'no_op';
  plan: P013MonthlyBaselinePlan;
  artifactId: string;
  artifactOutcome: 'inserted' | 'reused';
  baselineId: string;
  batchId: string;
  executionId: string;
  lockCount: number;
  attempt: number;
}): P013MonthlyBaselineApplyReceipt {
  return Object.freeze({
    contract: 'ltcm.p013.monthly-baseline-local-apply-receipt.v1' as const,
    status: options.status,
    committed: true as const,
    plan_version_id: options.plan.target_plan_version_id,
    baseline_id: options.baselineId,
    import_batch_id: options.batchId,
    execution_id: options.executionId,
    source_artifact_id: options.artifactId,
    artifact_outcome: options.artifactOutcome,
    baseline_outcome: options.status === 'inserted' ? ('inserted' as const) : ('reused' as const),
    position_count: options.plan.global_reconciliation.position_count,
    blank_count: options.plan.global_reconciliation.blank_count,
    explicit_zero_count: options.plan.global_reconciliation.explicit_zero_count,
    non_zero_count: options.plan.global_reconciliation.non_zero_count,
    financial_line_count: options.plan.global_reconciliation.material_line_count,
    canonical_total: options.plan.global_reconciliation.canonical_total,
    transaction_isolation: 'serializable' as const,
    runtime_role: 'ltc_m_runtime' as const,
    advisory_lock_count: options.lockCount,
    attempts: options.attempt,
  });
}

async function applyAttempt(options: {
  state: HarnessState;
  authority: ApplyAuthority;
  uniqueRecoveryOnly: boolean;
  attempt: number;
}): Promise<P013MonthlyBaselineApplyReceipt> {
  const client = await options.state.pool.connect();
  let open = false;
  try {
    await attestSession(client, options.state.databaseName);
    await client.query('begin transaction isolation level serializable');
    open = true;
    await establishRuntimeActor(client, options.authority.actor);
    const lockCount = await acquireLocks(client, options.authority.plan);
    const freshPlan = await readFreshPlan(client, options.authority);
    injectFault(options.state, 'before_write');
    const artifact = await persistArtifact(
      client,
      options.authority.source,
      options.authority.actor.app_user_id,
    );
    let persisted: { baselineId: string; batchId: string; executionId: string };
    let status: 'inserted' | 'no_op';
    if (freshPlan.status === 'no_op_candidate') {
      persisted = await existingReceipt(client, freshPlan);
      status = 'no_op';
    } else {
      if (options.uniqueRecoveryOnly) fail('P013_APPLY_IDENTITY_CONFLICT');
      persisted = await insertFirstApply(client, options.authority, freshPlan, artifact.id);
      status = 'inserted';
    }
    injectFault(options.state, 'late');
    await client.query('commit');
    open = false;
    return receipt({
      status,
      plan: freshPlan,
      artifactId: artifact.id,
      artifactOutcome: artifact.outcome,
      baselineId: persisted.baselineId,
      batchId: persisted.batchId,
      executionId: persisted.executionId,
      lockCount,
      attempt: options.attempt,
    });
  } catch (error) {
    if (open) await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function applyAuthorized(
  state: HarnessState,
  authority: ApplyAuthority,
): Promise<P013MonthlyBaselineApplyReceipt> {
  let uniqueRecoveryOnly = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await applyAttempt({ state, authority, uniqueRecoveryOnly, attempt });
    } catch (error) {
      if (error instanceof P013ApplyError) throw error;
      const code = pgCode(error);
      if (code === '23505') {
        if (attempt < MAX_ATTEMPTS) {
          uniqueRecoveryOnly = true;
          continue;
        }
        fail('P013_APPLY_IDENTITY_CONFLICT');
      }
      if (code === '40001' || code === '40P01') {
        if (attempt < MAX_ATTEMPTS) continue;
        fail('P013_APPLY_RETRY_EXHAUSTED');
      }
      fail('P013_APPLY_TRANSACTION_FAILED');
    }
  }
  fail('P013_APPLY_RETRY_EXHAUSTED');
}

interface ConfinedHarnessOptions {
  databaseUrl: string;
  testFault: TestFault | null;
}

function readConfinedHarnessOptions(value: unknown): ConfinedHarnessOptions {
  try {
    if (typeof value !== 'object' || value === null) {
      fail('P013_APPLY_LOCAL_DATABASE_NOT_AUTHORIZED');
    }
    const databaseUrl = Reflect.get(value, 'databaseUrl') as unknown;
    const testFault = Reflect.get(value, 'testFault') as unknown;
    if (typeof databaseUrl !== 'string') {
      fail('P013_APPLY_LOCAL_DATABASE_NOT_AUTHORIZED');
    }
    if (
      testFault !== undefined &&
      !['40001_once', '40P01_once', '23505_once', 'late_failure_once'].includes(testFault as string)
    ) {
      fail('P013_APPLY_LOCAL_DATABASE_NOT_AUTHORIZED');
    }
    return { databaseUrl, testFault: (testFault as TestFault | undefined) ?? null };
  } catch (error) {
    if (error instanceof P013ApplyError) throw error;
    fail('P013_APPLY_LOCAL_DATABASE_NOT_AUTHORIZED');
  }
}

function readConfinedDryRunOptions(value: unknown): {
  source: P013CertifiedMonthlySource;
  actor: P013ActorContext;
  targetPlanVersionId: string;
} {
  try {
    if (typeof value !== 'object' || value === null) fail('P013_APPLY_INPUT_INVALID');
    const source = Reflect.get(value, 'source') as P013CertifiedMonthlySource;
    const rawActor = Reflect.get(value, 'actor') as unknown;
    const targetPlanVersionId = Reflect.get(value, 'targetPlanVersionId') as unknown;
    if (
      typeof rawActor !== 'object' ||
      rawActor === null ||
      typeof targetPlanVersionId !== 'string'
    ) {
      fail('P013_APPLY_INPUT_INVALID');
    }
    const appUserId = Reflect.get(rawActor, 'app_user_id') as unknown;
    const authSubject = Reflect.get(rawActor, 'auth_subject') as unknown;
    const requestId = Reflect.get(rawActor, 'request_id') as unknown;
    const justification = Reflect.get(rawActor, 'justification') as unknown;
    const actorSource = Reflect.get(rawActor, 'source') as unknown;
    if (
      typeof appUserId !== 'string' ||
      typeof authSubject !== 'string' ||
      typeof requestId !== 'string' ||
      (justification !== null && typeof justification !== 'string') ||
      actorSource !== 'import'
    ) {
      fail('P013_APPLY_INPUT_INVALID');
    }
    return {
      source,
      actor: Object.freeze({
        app_user_id: appUserId,
        auth_subject: authSubject,
        request_id: requestId,
        justification,
        source: actorSource,
      }),
      targetPlanVersionId,
    };
  } catch (error) {
    if (error instanceof P013ApplyError) throw error;
    fail('P013_APPLY_INPUT_INVALID');
  }
}

/**
 * The authority emitter is deliberately lexical to this test-suite module. Importing either the
 * source or compiled file yields an empty namespace and cannot retrieve this closure.
 */
function openConfinedHarness(options: unknown): P013MonthlyBaselineLocalApplyHarness {
  const confined = readConfinedHarnessOptions(options);
  const target = authorizeLocalUrl(confined.databaseUrl);
  const adapter = createP013LocalPostgresDryRunAdapter({ databaseUrl: confined.databaseUrl });
  const pool = new Pool({ connectionString: confined.databaseUrl, max: 6 });
  const harness: P013MonthlyBaselineLocalApplyHarness = Object.freeze({
    contract: 'ltcm.p013.monthly-baseline-local-apply-harness.v1' as const,
    async dryRun(dryRunOptions: unknown): Promise<P013MonthlyDryRunResult> {
      const state = harnessStates.get(harness);
      if (state === undefined || state.closed) fail('P013_APPLY_CAPABILITY_REQUIRED');
      const confinedOptions = readConfinedDryRunOptions(dryRunOptions);
      const result = await runP013MonthlyBaselineDryRun({
        source: confinedOptions.source,
        adapter: state.adapter,
        actor: confinedOptions.actor,
        targetPlanVersionId: confinedOptions.targetPlanVersionId,
      });
      if (result.plan !== null && ['ready', 'no_op_candidate'].includes(result.plan.status)) {
        assertP013CertifiedMonthlyBaselinePlan({
          plan: result.plan,
          source: confinedOptions.source,
          snapshot: result.snapshot,
        });
        applyAuthorities.set(result, {
          harness,
          source: confinedOptions.source,
          actor: confinedOptions.actor,
          result,
          plan: result.plan,
        });
      }
      return result;
    },
    async apply(result: P013MonthlyDryRunResult): Promise<P013MonthlyBaselineApplyReceipt> {
      const state = harnessStates.get(harness);
      const authority = applyAuthorities.get(result);
      if (
        state === undefined ||
        state.closed ||
        authority === undefined ||
        authority.harness !== harness ||
        authority.result !== result ||
        result.plan !== authority.plan
      ) {
        fail('P013_APPLY_CAPABILITY_REQUIRED');
      }
      try {
        assertP013CertifiedMonthlyBaselinePlan({
          plan: authority.plan,
          source: authority.source,
          snapshot: result.snapshot,
        });
      } catch {
        fail('P013_APPLY_CAPABILITY_REQUIRED');
      }
      if (!['ready', 'no_op_candidate'].includes(authority.plan.status)) {
        fail('P013_APPLY_PLAN_NOT_READY');
      }
      return applyAuthorized(state, authority);
    },
    async close(): Promise<void> {
      const state = harnessStates.get(harness);
      if (state === undefined || state.closed) return;
      state.closed = true;
      await Promise.all([state.adapter.close(), state.pool.end()]);
    },
  });
  harnessStates.set(harness, {
    pool,
    adapter,
    databaseName: target.databaseName,
    closed: false,
    fault: confined.testFault,
    faultConsumed: false,
  });
  return harness;
}

const LOCAL_URL = 'postgresql://synthetic:synthetic@[::1]:5432/ltcm_test';

test('D05 local apply harness rejects non-local database targets without opening a connection', () => {
  const rejected = [
    'postgresql://u:p@10.0.0.1:5432/ltcm_test',
    'postgresql://u:p@172.16.0.1:5432/ltcm_test',
    'postgresql://u:p@192.168.0.1:5432/ltcm_test',
    'postgresql://u:p@[fd00::1]:5432/ltcm_test',
    'postgresql://u:p@example.com:5432/ltcm_test',
    'postgresql://u:p@localhost.evil:5432/ltcm_test',
    'postgresql://u:p@127.0.0.1.evil:5432/ltcm_test',
    'postgresql://u:p@localhost.:5432/ltcm_test',
    'postgresql://u:p@127%2e0%2e0%2e1:5432/ltcm_test',
    'postgresql://u:p@127.0.0.1:5432/postgres',
    'postgresql://u:p@127.0.0.1:5433/ltcm_test',
    'postgresql://u:p@127.0.0.1:5432/ltcm_test?sslmode=disable',
    'postgresql://u:p@127.0.0.1:5432/ltcm_test#fragment',
    'postgresql:///ltcm_test',
  ];
  for (const databaseUrl of rejected) {
    assert.throws(
      () => openConfinedHarness({ databaseUrl }),
      /P013_APPLY_LOCAL_DATABASE_NOT_AUTHORIZED/u,
    );
  }
});

test('D05 apply authority cannot be reconstructed, cloned, proxied, or moved across harnesses', async () => {
  const first = openConfinedHarness({ databaseUrl: LOCAL_URL });
  const second = openConfinedHarness({ databaseUrl: LOCAL_URL });
  const forged = Object.freeze({ plan: null, snapshot: {}, receipt: {} });
  const attacks = [
    forged,
    { ...forged },
    Object.assign({}, forged),
    JSON.parse(JSON.stringify(forged)),
    structuredClone(forged),
    Object.create(forged),
    new Proxy(forged, {}),
  ];
  try {
    for (const attack of attacks) {
      await assert.rejects(first.apply(attack as never), /P013_APPLY_CAPABILITY_REQUIRED/u);
      await assert.rejects(second.apply(attack as never), /P013_APPLY_CAPABILITY_REQUIRED/u);
    }
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

test('D05 test support exposes no pool, client, SQL callback, writer, or capability mint', async () => {
  const harness = openConfinedHarness({ databaseUrl: LOCAL_URL });
  try {
    assert.deepEqual(Object.keys(harness).sort(), ['apply', 'close', 'contract', 'dryRun']);
    for (const forbidden of [
      'pool',
      'client',
      'query',
      'transaction',
      'writer',
      'mint',
      'authorize',
    ]) {
      assert.equal(forbidden in harness, false);
    }
    assert.equal(Object.isFrozen(harness), true);
  } finally {
    await harness.close();
  }
});

test('D05 apply support is unreachable through normal package exports', async () => {
  for (const specifier of [
    '@ltcm/normalizer/monthly-baseline-apply',
    '@ltcm/normalizer/postgres-monthly-baseline-apply',
    '@ltcm/normalizer/test/support/postgres-monthly-baseline-apply',
  ]) {
    await assert.rejects(
      import(specifier),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    );
  }
});

const SENTINELS = [
  'PASSWORD_SENTINEL',
  'DSN_SENTINEL',
  'ABSOLUTE_PATH_SENTINEL',
  'RAW_PG_SENTINEL',
  'C:\\D06A\\ABSOLUTE_PATH_SENTINEL',
  '/tmp/D06A/ABSOLUTE_PATH_SENTINEL',
] as const;

function assertSanitized(error: unknown, expected: RegExp): boolean {
  assert.ok(error instanceof Error);
  assert.match(error.message, expected);
  for (const sentinel of SENTINELS) assert.equal(String(error).includes(sentinel), false);
  return true;
}

async function closeIfHarness(value: unknown): Promise<void> {
  if (
    typeof value === 'object' &&
    value !== null &&
    'close' in value &&
    typeof (value as { close?: unknown }).close === 'function'
  ) {
    await (value as { close(): Promise<void> }).close();
  }
}

test('D06A confines authority against direct filesystem namespace and reflection', async () => {
  const namespace = await import('./postgres-monthly-baseline-apply.js');
  assert.deepEqual(Object.keys(namespace), []);
  assert.deepEqual(Reflect.ownKeys(namespace), [Symbol.toStringTag]);
  const sourceText = await readFile(
    path.join(
      ROOT,
      'tools',
      'ltcm-normalizer',
      'test',
      'support',
      'postgres-monthly-baseline-apply.ts',
    ),
    'utf8',
  );
  const compiledText = await readFile(fileURLToPath(import.meta.url), 'utf8');
  assert.doesNotMatch(sourceText, /^\s*export\s/mu);
  assert.doesNotMatch(compiledText, /^\s*export\s/mu);
  const require = createRequire(import.meta.url);
  const required = require(fileURLToPath(import.meta.url)) as Record<PropertyKey, unknown>;
  assert.deepEqual(Object.keys(required), []);
  for (const specifier of [
    '@ltcm/normalizer',
    '@ltcm/normalizer/monthly-baseline-apply',
    '@ltcm/normalizer/test/support/postgres-monthly-baseline-apply',
  ]) {
    await assert.rejects(
      import(specifier),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    );
    assert.throws(
      () => require(specifier),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    );
  }
  for (const entrypoint of [
    '../monthly-baseline-apply.test.js',
    '../postgres-monthly-baseline-apply.integration.test.js',
  ]) {
    const entrypointNamespace = await import(entrypoint);
    assert.deepEqual(Object.keys(entrypointNamespace), []);
  }
  for (const name of [
    'createP013MonthlyBaselineLocalApplyHarness',
    'openConfinedHarness',
    'createHarness',
    'createWriter',
    'mint',
    'authorize',
    'apply',
    'writer',
  ]) {
    assert.equal(name in namespace, false);
    assert.equal(name in required, false);
  }
});

test('D06A sanitizes hostile caller-owned options, actors, proxies, coercion, and causes', async () => {
  const stableFactoryError = /P013_APPLY_LOCAL_DATABASE_NOT_AUTHORIZED/u;
  const stableInputError = /P013_APPLY_INPUT_INVALID/u;
  const hostileFactoryInputs: unknown[] = [
    Object.defineProperty({}, 'databaseUrl', {
      get: () => {
        throw new Error('PASSWORD_SENTINEL');
      },
    }),
    Object.defineProperty({ databaseUrl: LOCAL_URL }, 'testFault', {
      get: () => {
        throw new Error('DSN_SENTINEL');
      },
    }),
    new Proxy(
      {},
      {
        get: () => {
          throw new Error('RAW_PG_SENTINEL');
        },
      },
    ),
    {
      databaseUrl: {
        [Symbol.toPrimitive]: () => {
          throw new Error('PASSWORD_SENTINEL');
        },
      },
    },
    {
      databaseUrl: {
        toString: () => {
          throw new Error('DSN_SENTINEL');
        },
        valueOf: () => {
          throw new Error('RAW_PG_SENTINEL');
        },
      },
    },
    Object.defineProperty({}, 'databaseUrl', {
      get: () => {
        throw new Error('boundary', { cause: new Error('ABSOLUTE_PATH_SENTINEL') });
      },
    }),
    Object.defineProperty({}, 'databaseUrl', {
      get: () => {
        throw Object.assign(new Error('RAW_PG_SENTINEL'), {
          code: '23505',
          detail: 'C:\\D06A\\ABSOLUTE_PATH_SENTINEL',
        });
      },
    }),
    Object.defineProperty({}, 'databaseUrl', {
      get: () => {
        throw new Error('/tmp/D06A/ABSOLUTE_PATH_SENTINEL');
      },
    }),
  ];
  for (const input of hostileFactoryInputs) {
    assert.throws(
      () => openConfinedHarness(input),
      (error) => assertSanitized(error, stableFactoryError),
    );
  }

  for (const trap of ['ownKeys', 'getOwnPropertyDescriptor'] as const) {
    const options = new Proxy(
      { databaseUrl: LOCAL_URL },
      trap === 'ownKeys'
        ? {
            ownKeys: () => {
              throw new Error('DSN_SENTINEL');
            },
          }
        : {
            getOwnPropertyDescriptor: () => {
              throw new Error('PASSWORD_SENTINEL');
            },
          },
    );
    const harness = openConfinedHarness(options);
    await closeIfHarness(harness);
  }

  const harness = openConfinedHarness({ databaseUrl: LOCAL_URL });
  try {
    const actorBase = {
      app_user_id: '00000000-0000-4000-8000-000000013601',
      auth_subject: 'ci-p013-d06a|admin',
      request_id: 'p013-d06a',
      justification: null,
      source: 'import',
    };
    const hostileDryRuns: unknown[] = [
      Object.defineProperty({}, 'actor', {
        get: () => {
          throw new Error('PASSWORD_SENTINEL');
        },
      }),
      new Proxy(
        {},
        {
          get: () => {
            throw new Error('DSN_SENTINEL');
          },
        },
      ),
      {
        source: {},
        actor: Object.defineProperty({ ...actorBase }, 'auth_subject', {
          get: () => {
            throw new Error('RAW_PG_SENTINEL');
          },
        }),
        targetPlanVersionId: '00000000-0000-4000-8000-000000013610',
      },
      {
        source: {},
        actor: Object.defineProperty({ ...actorBase }, 'justification', {
          get: () => {
            throw new Error('C:\\D06A\\ABSOLUTE_PATH_SENTINEL');
          },
        }),
        targetPlanVersionId: '00000000-0000-4000-8000-000000013610',
      },
    ];
    for (const input of hostileDryRuns) {
      await assert.rejects(harness.dryRun(input as never), (error) =>
        assertSanitized(error, stableInputError),
      );
    }
  } finally {
    await harness.close();
  }
});

interface ImportProbeResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

function runImportProbe(
  mode: 'esm' | 'commonjs',
  target: string,
  environment: NodeJS.ProcessEnv,
): Promise<ImportProbeResult> {
  const inspection = `const describe = (namespace) => {
    const descriptors = Object.getOwnPropertyDescriptors(namespace);
    const values = Object.values(descriptors).map((descriptor) => descriptor.value);
    return {
      enumerableKeys: Object.keys(namespace),
      stringKeys: Object.getOwnPropertyNames(namespace),
      symbolKeys: Object.getOwnPropertySymbols(namespace).map(String),
      prototypeIsNull: Object.getPrototypeOf(namespace) === null,
      defaultPresent: Object.prototype.hasOwnProperty.call(namespace, 'default'),
      namedExports: Object.getOwnPropertyNames(namespace),
      getterCount: Object.values(descriptors).filter((descriptor) => typeof descriptor.get === 'function').length,
      callableCount: values.filter((value) => typeof value === 'function').length,
      promiseCount: values.filter((value) => value !== null && typeof value === 'object' && typeof value.then === 'function').length
    };
  };`;
  const source =
    mode === 'esm'
      ? `${inspection}
         try {
           const namespace = await import(${JSON.stringify(target)});
           process.stdout.write('P013_D06C_IMPORT_PROBE_V1=' + JSON.stringify({ loaded: true, inspection: describe(namespace) }));
         } catch (error) {
           process.stdout.write('P013_D06C_IMPORT_PROBE_V1=' + JSON.stringify({ loaded: false, errorCode: error?.code ?? 'UNKNOWN' }));
         }`
      : `${inspection}
         try {
           const namespace = require(${JSON.stringify(target)});
           process.stdout.write('P013_D06C_IMPORT_PROBE_V1=' + JSON.stringify({ loaded: true, inspection: describe(namespace) }));
         } catch (error) {
           process.stdout.write('P013_D06C_IMPORT_PROBE_V1=' + JSON.stringify({ loaded: false, errorCode: error?.code ?? 'UNKNOWN' }));
         }`;
  const argumentsList = mode === 'esm' ? ['--input-type=module', '-e', source] : ['-e', source];

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argumentsList, {
      cwd: fileURLToPath(new URL('../../../../..', import.meta.url)),
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', reject);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 15_000);
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}

test(
  'D06C arbitrary filesystem, package, ESM, and CommonJS imports are inert in fresh processes',
  { skip: process.env['LTCM_P013_D06C_IMPORT_PROBE'] === '1' },
  async () => {
    const workspaceRoot = fileURLToPath(new URL('../../../../..', import.meta.url));
    const compiledSupport = fileURLToPath(import.meta.url);
    const compiledTestDirectory = path.dirname(path.dirname(compiledSupport));
    const compiledUnitEntrypoint = path.join(
      compiledTestDirectory,
      'monthly-baseline-apply.test.js',
    );
    const compiledIntegrationEntrypoint = path.join(
      compiledTestDirectory,
      'postgres-monthly-baseline-apply.integration.test.js',
    );
    const relativeSupport = `./${path
      .relative(workspaceRoot, compiledSupport)
      .split(path.sep)
      .join('/')}`;
    const supportFileUrl = pathToFileURL(compiledSupport).href;
    const cleanEnvironment: NodeJS.ProcessEnv = { ...process.env };
    delete cleanEnvironment['NODE_TEST_CONTEXT'];
    delete cleanEnvironment['LTCM_P013_D05_INTEGRATION'];
    cleanEnvironment['LTCM_P013_D06C_IMPORT_PROBE'] = '1';
    const enabledEnvironment: NodeJS.ProcessEnv = {
      ...cleanEnvironment,
      LTCM_P013_D05_INTEGRATION: '1',
    };
    const databaseUrl = new URL(
      process.env['LTCM_P012_TEST_DATABASE_URL'] ??
        'postgresql://p013_d06c_local:p013_d06c_local@127.0.0.1:5432/ltcm_test',
    );
    databaseUrl.searchParams.set('application_name', 'p013_d06c_arbitrary_import');
    const fullyArmedEnvironment: NodeJS.ProcessEnv = {
      ...enabledEnvironment,
      NODE_TEST_CONTEXT: 'child-v8',
      LTCM_P012_TEST_DATABASE_URL: databaseUrl.href,
      LTCM_P013_ACTOR_ID: '00000000-0000-4000-8000-000000013601',
      LTCM_P013_ACTOR_SUB: 'ci-p013-d06c|admin',
      LTCM_P013_REQUEST_ID: 'p013-d06c-arbitrary-import',
    };
    const environments = [cleanEnvironment, enabledEnvironment, fullyArmedEnvironment];
    const successfulImports: ReadonlyArray<readonly ['esm' | 'commonjs', string]> = [
      ['esm', relativeSupport],
      ['esm', supportFileUrl],
      ['esm', `${supportFileUrl}?p013-d06c-cache-bust=1`],
      ['esm', pathToFileURL(compiledUnitEntrypoint).href],
      ['esm', pathToFileURL(compiledIntegrationEntrypoint).href],
      ['commonjs', compiledSupport],
    ];

    for (const environment of environments) {
      for (const [mode, target] of successfulImports) {
        const result = await runImportProbe(mode, target, environment);
        assert.equal(result.timedOut, false);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, '');
        assert.equal(result.stdout.startsWith('P013_D06C_IMPORT_PROBE_V1='), true);
        assert.equal(result.stdout.includes('TAP version'), false);
        assert.equal(result.stdout.includes('P013 D05 applies'), false);
        const payload = JSON.parse(result.stdout.slice(result.stdout.indexOf('=') + 1)) as {
          loaded: boolean;
          inspection: {
            enumerableKeys: string[];
            stringKeys: string[];
            symbolKeys: string[];
            prototypeIsNull: boolean;
            defaultPresent: boolean;
            namedExports: string[];
            getterCount: number;
            callableCount: number;
            promiseCount: number;
          };
        };
        assert.equal(payload.loaded, true);
        assert.deepEqual(payload.inspection.enumerableKeys, []);
        assert.deepEqual(payload.inspection.stringKeys, []);
        assert.deepEqual(payload.inspection.namedExports, []);
        assert.deepEqual(payload.inspection.symbolKeys, ['Symbol(Symbol.toStringTag)']);
        assert.equal(payload.inspection.prototypeIsNull, true);
        assert.equal(payload.inspection.defaultPresent, false);
        assert.equal(payload.inspection.getterCount, 0);
        assert.equal(payload.inspection.callableCount, 0);
        assert.equal(payload.inspection.promiseCount, 0);
      }
    }

    for (const target of [
      '@ltcm/normalizer',
      '@ltcm/normalizer/test/support/postgres-monthly-baseline-apply.js',
    ]) {
      const result = await runImportProbe('esm', target, fullyArmedEnvironment);
      assert.equal(result.timedOut, false);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout.includes('TAP version'), false);
      const payload = JSON.parse(result.stdout.slice(result.stdout.indexOf('=') + 1)) as {
        loaded: boolean;
        errorCode: string;
      };
      assert.equal(payload.loaded, false);
      assert.equal(payload.errorCode, 'ERR_PACKAGE_PATH_NOT_EXPORTED');
    }
  },
);

const DATABASE_URL = process.env['LTCM_P012_TEST_DATABASE_URL'];
const ENABLED = process.env['LTCM_P013_D05_INTEGRATION'] === '1';
const ROOT = fileURLToPath(new URL('../../../../..', import.meta.url));
const EXPECTED_MIGRATIONS = 14;
const ADMIN_ID = '00000000-0000-4000-8000-000000013601';
const VIEWER_ID = '00000000-0000-4000-8000-000000013602';
const CLIENT_ID = '00000000-0000-4000-8000-000000013603';
const PLAN_MAIN = '00000000-0000-4000-8000-000000013610';
const PLAN_LATE = '00000000-0000-4000-8000-000000013611';
const PLAN_STALE = '00000000-0000-4000-8000-000000013612';
const PLAN_SERIALIZATION = '00000000-0000-4000-8000-000000013613';
const PLAN_DEADLOCK = '00000000-0000-4000-8000-000000013614';
const PLAN_UNIQUE = '00000000-0000-4000-8000-000000013615';
const PLAN_CONFLICT = '00000000-0000-4000-8000-000000013616';
const RUNTIME_LOGIN = 'p013_d05_runtime_login';
const RUNTIME_PASSWORD = 'p013-d05-synthetic-local-only';
const D06C_PROBE_APPLICATION_NAME = 'p013_d06c_arbitrary_import';

const PLAN_IDS = [
  PLAN_MAIN,
  PLAN_LATE,
  PLAN_STALE,
  PLAN_SERIALIZATION,
  PLAN_DEADLOCK,
  PLAN_UNIQUE,
  PLAN_CONFLICT,
];

function databaseUrl(): string {
  if (DATABASE_URL === undefined || DATABASE_URL === '') throw new Error('P013_D05_ENV_MISSING');
  parseP012LoopbackDatabaseUrlForTestHarness(DATABASE_URL);
  return DATABASE_URL;
}

function runtimeUrl(): string {
  const parsed = new URL(databaseUrl());
  parsed.username = RUNTIME_LOGIN;
  parsed.password = RUNTIME_PASSWORD;
  return parsed.toString();
}

async function readD06CExternalState(pool: Pool): Promise<Record<string, number | null>> {
  const tables = [
    'ltc_m.monthly_source_artifacts',
    'ltc_m.import_batches',
    'ltc_m.import_batch_sheets',
    'ltc_m.import_staging_rows',
    'ltc_m.monthly_plan_baselines',
    'ltc_m.monthly_plan_import_executions',
    'ltc_m.monthly_plan_cells',
    'ltc_m.financial_plan_lines',
    'ltc_m.app_users',
    'ltc_m.projects',
    'ltc_m.project_items',
  ] as const;
  const state: Record<string, number | null> = {};
  for (const table of tables) {
    const relation = await pool.query<{ relation: string | null }>(
      'select pg_catalog.to_regclass($1::text)::text as relation',
      [table],
    );
    state[table] =
      relation.rows[0]?.relation === null || relation.rows[0]?.relation === undefined
        ? null
        : Number(
            (await pool.query(`select count(*)::integer as count from ${table}`)).rows[0]?.[
              'count'
            ],
          );
  }
  return state;
}

test(
  'D06C arbitrary imports cause zero PostgreSQL sessions, transactions, locks, fixtures, or writes',
  { skip: !ENABLED },
  async () => {
    const monitor = new Pool({
      connectionString: databaseUrl(),
      application_name: 'p013_d06c_external_monitor',
      max: 1,
    });
    let monitoring = true;
    const observed = { sessions: 0, transactions: 0, advisoryLocks: 0 };
    try {
      const before = await readD06CExternalState(monitor);
      const probeUrl = new URL(databaseUrl());
      probeUrl.searchParams.set('application_name', D06C_PROBE_APPLICATION_NAME);
      const probeEnvironment: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_TEST_CONTEXT: 'child-v8',
        LTCM_P013_D05_INTEGRATION: '1',
        LTCM_P013_D06C_IMPORT_PROBE: '1',
        LTCM_P012_TEST_DATABASE_URL: probeUrl.href,
        LTCM_P013_ACTOR_ID: ADMIN_ID,
        LTCM_P013_ACTOR_SUB: 'ci-p013-d06c|admin',
        LTCM_P013_REQUEST_ID: 'p013-d06c-arbitrary-import',
      };
      const compiledSupport = fileURLToPath(import.meta.url);
      const testDirectory = path.dirname(path.dirname(compiledSupport));
      const targets: ReadonlyArray<readonly ['esm' | 'commonjs', string]> = [
        ['esm', pathToFileURL(compiledSupport).href],
        ['esm', `${pathToFileURL(compiledSupport).href}?p013-d06c-db-probe=1`],
        ['esm', pathToFileURL(path.join(testDirectory, 'monthly-baseline-apply.test.js')).href],
        [
          'esm',
          pathToFileURL(
            path.join(testDirectory, 'postgres-monthly-baseline-apply.integration.test.js'),
          ).href,
        ],
        ['commonjs', compiledSupport],
      ];
      const monitorPromise = (async () => {
        while (monitoring) {
          const sample = await monitor.query<{
            sessions: number;
            transactions: number;
            advisory_locks: number;
          }>(
            `select
              count(distinct activity.pid)::integer as sessions,
              count(distinct activity.pid) filter (where activity.xact_start is not null)::integer
                as transactions,
              count(locks.pid) filter (where locks.locktype = 'advisory')::integer
                as advisory_locks
             from pg_catalog.pg_stat_activity as activity
             left join pg_catalog.pg_locks as locks on locks.pid = activity.pid
             where activity.application_name = $1::text`,
            [D06C_PROBE_APPLICATION_NAME],
          );
          observed.sessions = Math.max(observed.sessions, sample.rows[0]?.sessions ?? 0);
          observed.transactions = Math.max(
            observed.transactions,
            sample.rows[0]?.transactions ?? 0,
          );
          observed.advisoryLocks = Math.max(
            observed.advisoryLocks,
            sample.rows[0]?.advisory_locks ?? 0,
          );
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      })();
      try {
        for (const [mode, target] of targets) {
          const result = await runImportProbe(mode, target, probeEnvironment);
          assert.equal(result.exitCode, 0);
          assert.equal(result.timedOut, false);
          assert.equal(result.stderr, '');
          assert.equal(result.stdout.includes('TAP version'), false);
        }
      } finally {
        monitoring = false;
        await monitorPromise;
      }
      assert.deepEqual(observed, { sessions: 0, transactions: 0, advisoryLocks: 0 });
      assert.deepEqual(await readD06CExternalState(monitor), before);
    } finally {
      monitoring = false;
      await monitor.end();
    }
  },
);

function actor(requestId: string): P013ActorContext {
  return {
    app_user_id: ADMIN_ID,
    auth_subject: 'ci-p013-d05|admin',
    request_id: requestId,
    justification: null,
    source: 'import',
  };
}

function fixtureUuid(group: number, index: number): string {
  return `00000000-0000-4000-${group.toString().padStart(4, '0')}-${index.toString().padStart(12, '0')}`;
}

async function migrations(): Promise<string[]> {
  const directory = path.join(ROOT, 'supabase', 'migrations');
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  assert.equal(names.length, EXPECTED_MIGRATIONS);
  return Promise.all(names.map((name) => readFile(path.join(directory, name), 'utf8')));
}

async function guard(client: PoolClient): Promise<void> {
  const result = await client.query(`select current_database() as database_name, current_user,
    current_setting('server_version_num') as server_version_num, roles.rolsuper
    from pg_catalog.pg_roles as roles where roles.rolname = current_user`);
  assert.equal(result.rows[0]?.['database_name'], 'ltcm_test');
  assert.equal(result.rows[0]?.['current_user'], 'postgres');
  assert.match(String(result.rows[0]?.['server_version_num']), /^17/u);
  assert.equal(result.rows[0]?.['rolsuper'], true);
}

async function installAdmin(client: PoolClient): Promise<void> {
  await client.query('begin');
  try {
    await client.query(
      `select ltc_m.set_actor_context(null, null, 'p013-d05-bootstrap', null, 'system', false)`,
    );
    await client.query(
      `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
       values ($1::uuid, 'ci-p013-d05|admin', 'P013 D05 Admin', 'admin', true)`,
      [ADMIN_ID],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}

async function rebuildFromZero(pool: Pool, retainBootstrapAdmin = true): Promise<void> {
  const client = await pool.connect();
  try {
    await guard(client);
    await client.query('drop schema if exists ltc_m cascade');
    for (const [index, migration] of (await migrations()).entries()) {
      await client.query(migration);
      if (index === 6) await installAdmin(client);
    }
    if (!retainBootstrapAdmin) {
      await client.query('truncate table ltc_m.app_users cascade');
    }
  } finally {
    client.release();
  }
}

async function sourcePath(): Promise<string> {
  const directory = path.join(ROOT, '.local-source');
  const name = (await readdir(directory)).find((candidate) => candidate.endsWith('.xlsx'));
  if (name === undefined) throw new Error('P013_D05_SOURCE_MISSING');
  return path.join(directory, name);
}

async function createRuntimeLogin(client: PoolClient): Promise<void> {
  await client.query(`drop role if exists p013_d05_runtime_login`);
  await client.query(
    `create role p013_d05_runtime_login login password '${RUNTIME_PASSWORD}'
       nosuperuser noinherit nocreatedb nocreaterole noreplication nobypassrls`,
  );
  await client.query(
    `grant ltc_m_runtime to p013_d05_runtime_login
       with admin false, inherit false, set true granted by postgres`,
  );
}

async function dropRuntimeLogin(client: PoolClient): Promise<void> {
  await client
    .query(`revoke ltc_m_runtime from p013_d05_runtime_login granted by postgres restrict`)
    .catch(() => undefined);
  await client.query(`drop role if exists p013_d05_runtime_login`);
}

async function setupFixtures(
  client: PoolClient,
  source: P013CertifiedMonthlySource,
): Promise<void> {
  const facts = readP013CertifiedMonthlySourceFacts(source);
  const identities = [
    ...new Map(
      facts.cells.map((cell) => [`${cell.project_code}\0${cell.source_item_number}`, cell]),
    ).values(),
  ];
  const codes = [...new Set(identities.map(({ project_code }) => project_code))].sort();
  await client.query('begin');
  try {
    await client.query(
      `select ltc_m.set_actor_context($1::uuid, 'ci-p013-d05|admin',
        'p013-d05-fixtures', null, 'import', false)`,
      [ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
       values ($1::uuid, 'ci-p013-d05|viewer', 'P013 D05 Viewer', 'viewer', true)`,
      [VIEWER_ID],
    );
    await client.query(`insert into ltc_m.currencies (code, name) values ('BRL', 'Real local')`);
    await client.query(`insert into ltc_m.units (code, name) values ('US', 'Unidade local')`);
    await client.query(
      `insert into ltc_m.clients (id, legal_name, display_name, created_by_user_id)
       values ($1::uuid, 'Cliente sintético P013 D05', 'Cliente P013 D05', $2::uuid)`,
      [CLIENT_ID, ADMIN_ID],
    );
    const projectByCode = new Map<string, string>();
    for (const [index, code] of codes.entries()) {
      const id = fixtureUuid(6100, index + 1);
      projectByCode.set(code, id);
      await client.query(
        `insert into ltc_m.projects
          (id, project_code, project_name, client_id, status, base_currency,
           contract_value, data_reference_date, created_by_user_id)
         values ($1::uuid, $2::text, $3::text, $4::uuid, 'active', 'BRL', 1,
           date '2026-07-01', $5::uuid)`,
        [id, code, `Projeto sintético ${index + 1}`, CLIENT_ID, ADMIN_ID],
      );
    }
    for (const [index, identity] of identities.entries()) {
      const line = Number(identity.source_item_number);
      await client.query(
        `insert into ltc_m.project_items
          (id, project_id, source_line_key, line_number, item_code, description,
           quantity, unit_code, currency_code, unit_price, active, created_by_user_id)
         values ($1::uuid, $2::uuid, $3::text, $4::integer, $5::text, $6::text,
           1, 'US', 'BRL', 1, true, $7::uuid)`,
        [
          fixtureUuid(6200, index + 1),
          projectByCode.get(identity.project_code),
          createSourceLineKey(identity.project_code, line),
          line,
          `REPEAT-${index % 4}`,
          `Item sintético ${index + 1}`,
          ADMIN_ID,
        ],
      );
    }
    for (const [index, planId] of PLAN_IDS.entries()) {
      await client.query(
        `insert into ltc_m.plan_versions
          (id, name, reference_date, status, is_baseline, created_by_user_id)
         values ($1::uuid, $2::text, date '2026-07-01', 'draft', $3::boolean, $4::uuid)`,
        [planId, `Baseline P013 D05 ${index + 1}`, planId === PLAN_MAIN, ADMIN_ID],
      );
      for (const projectId of projectByCode.values()) {
        await client.query(
          `insert into ltc_m.financial_plan_scopes
            (plan_version_id, project_id, metric_type, planning_level,
             currency_code, created_by_user_id)
           values ($1::uuid, $2::uuid, 'billing_planned', 'item', 'BRL', $3::uuid)`,
          [planId, projectId, ADMIN_ID],
        );
      }
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}

async function activatePlan(client: PoolClient, planId: string): Promise<void> {
  await client.query('begin');
  try {
    await client.query(
      `select ltc_m.set_actor_context($1::uuid, 'ci-p013-d05|admin',
        'p013-d05-activate-plan', null, 'import', false)`,
      [ADMIN_ID],
    );
    await client.query(
      `update ltc_m.plan_versions set is_baseline = false, updated_by_user_id = $1::uuid
       where is_baseline`,
      [ADMIN_ID],
    );
    await client.query(
      `update ltc_m.plan_versions set is_baseline = true, updated_by_user_id = $1::uuid
       where id = $2::uuid`,
      [ADMIN_ID, planId],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}

async function planCounts(client: PoolClient, planId: string): Promise<Record<string, unknown>> {
  const result = await client.query(
    `select
    (select count(*)::integer from ltc_m.monthly_plan_baselines
      where plan_version_id = $1::uuid) as baselines,
    (select count(*)::integer from ltc_m.monthly_plan_import_executions
      where plan_version_id = $1::uuid) as executions,
    (select count(*)::integer from ltc_m.monthly_plan_cells
      where plan_version_id = $1::uuid) as cells,
    (select count(*)::integer from ltc_m.financial_plan_lines
      where plan_version_id = $1::uuid) as lines`,
    [planId],
  );
  return result.rows[0] ?? {};
}

async function setItemState(
  client: PoolClient,
  updates: { active: boolean; deleted: boolean },
): Promise<void> {
  await client.query('begin');
  try {
    await client.query(
      `select ltc_m.set_actor_context($1::uuid, 'ci-p013-d05|admin',
        'p013-d05-stale-fixture', 'Fixture sintética de stale-plan D05', 'import', false)`,
      [ADMIN_ID],
    );
    await client.query(
      `update ltc_m.project_items set active = $1::boolean,
        deleted_at = case when $2::boolean then clock_timestamp() else null end,
        updated_by_user_id = $3::uuid
       where id = (select id from ltc_m.project_items order by id limit 1)`,
      [updates.active, updates.deleted, ADMIN_ID],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}

async function assertMainPersistence(client: PoolClient): Promise<void> {
  assert.deepEqual(await planCounts(client, PLAN_MAIN), {
    baselines: 1,
    executions: 1,
    cells: 432,
    lines: 102,
  });
  const facts = await client.query(
    `select
    count(*)::integer as positions,
    count(*) filter (where cells.declaration_state = 'blank')::integer as blanks,
    count(*) filter (where cells.declaration_state = 'explicit_zero')::integer as explicit_zero,
    count(*) filter (where cells.declaration_state = 'value')::integer as non_zero,
    count(cells.financial_plan_line_id)::integer as material_links,
    coalesce(sum(lines.amount), 0)::text as total
    from ltc_m.monthly_plan_cells as cells
    left join ltc_m.financial_plan_lines as lines on lines.id = cells.financial_plan_line_id
    where cells.plan_version_id = $1::uuid`,
    [PLAN_MAIN],
  );
  assert.deepEqual(facts.rows[0], {
    positions: 432,
    blanks: 330,
    explicit_zero: 1,
    non_zero: 101,
    material_links: 102,
    total: '2800460.18',
  });
  const decimalCases = await client.query(
    `select source_cell_reference, declaration_state, source_numeric_text,
      canonical_amount::text as canonical_amount,
      (financial_plan_line_id is not null) as has_financial_line
    from ltc_m.monthly_plan_cells
    where plan_version_id = $1::uuid and source_cell_reference in ('K17', 'K44')
    order by source_cell_reference`,
    [PLAN_MAIN],
  );
  assert.deepEqual(decimalCases.rows, [
    {
      source_cell_reference: 'K17',
      declaration_state: 'value',
      source_numeric_text: '930.59999999999991',
      canonical_amount: '930.60',
      has_financial_line: true,
    },
    {
      source_cell_reference: 'K44',
      declaration_state: 'explicit_zero',
      source_numeric_text: '0',
      canonical_amount: '0.00',
      has_financial_line: true,
    },
  ]);
  const blankIntegrity = await client.query(
    `select count(*)::integer as count
    from ltc_m.monthly_plan_cells
    where plan_version_id = $1::uuid
      and declaration_state = 'blank'
      and canonical_amount is null
      and financial_plan_line_id is null`,
    [PLAN_MAIN],
  );
  assert.equal(blankIntegrity.rows[0]?.['count'], 330);
  const completeProvenance = await client.query(
    `select count(*)::integer as count
    from ltc_m.monthly_plan_cells as cells
    join ltc_m.monthly_plan_baselines as baselines on baselines.id = cells.baseline_id
    join ltc_m.monthly_plan_import_executions as executions
      on executions.baseline_id = baselines.id and executions.import_batch_id = cells.import_batch_id
    join ltc_m.monthly_source_artifacts as artifacts on artifacts.id = executions.source_artifact_id
    join ltc_m.import_batches as batches on batches.id = executions.import_batch_id
    join ltc_m.import_batch_sheets as sheets on sheets.id = cells.import_batch_sheet_id
    join ltc_m.import_staging_rows as staging on staging.id = cells.import_staging_row_id
    join ltc_m.project_items as items on items.id = cells.project_item_id
    left join ltc_m.financial_plan_lines as lines on lines.id = cells.financial_plan_line_id
    where cells.plan_version_id = $1::uuid
      and artifacts.source_sha256 = batches.source_hash
      and sheets.sheet_key = 'monthly_revenue'
      and staging.source_row_number = cells.source_row_number
      and staging.row_hash = (staging.raw_payload ->> 'source_row_hash')
      and items.source_line_key = cells.source_line_key
      and (
        (
          cells.declaration_state = 'blank'
          and lines.id is null
          and cells.canonical_amount is null
        )
        or (
          cells.declaration_state in ('explicit_zero', 'value')
          and lines.project_item_id = cells.project_item_id
          and lines.competence_month = cells.competence_month
          and lines.amount = cells.canonical_amount
        )
      )`,
    [PLAN_MAIN],
  );
  assert.equal(completeProvenance.rows[0]?.['count'], 432);
  const provenance = await client.query(
    `select count(*)::integer as count
    from ltc_m.monthly_plan_cells as cells
    join ltc_m.monthly_plan_baselines as baselines on baselines.id = cells.baseline_id
    join ltc_m.monthly_plan_import_executions as executions
      on executions.baseline_id = baselines.id and executions.import_batch_id = cells.import_batch_id
    join ltc_m.monthly_source_artifacts as artifacts on artifacts.id = executions.source_artifact_id
    join ltc_m.import_batches as batches on batches.id = executions.import_batch_id
    join ltc_m.import_batch_sheets as sheets on sheets.id = cells.import_batch_sheet_id
    join ltc_m.import_staging_rows as staging on staging.id = cells.import_staging_row_id
    join ltc_m.project_items as items on items.id = cells.project_item_id
    join ltc_m.financial_plan_lines as lines on lines.id = cells.financial_plan_line_id
    where cells.plan_version_id = $1::uuid
      and cells.declaration_state in ('explicit_zero', 'value')
      and artifacts.source_sha256 = batches.source_hash
      and sheets.sheet_key = 'monthly_revenue'
      and staging.source_row_number = cells.source_row_number
      and staging.row_hash = (staging.raw_payload ->> 'source_row_hash')
      and items.source_line_key = cells.source_line_key
      and lines.project_item_id = cells.project_item_id
      and lines.competence_month = cells.competence_month
      and lines.amount = cells.canonical_amount`,
    [PLAN_MAIN],
  );
  assert.equal(provenance.rows[0]?.['count'], 102);
  const repeatedCodes = await client.query(`select count(*)::integer as count from (
    select item_code from ltc_m.project_items group by item_code having count(*) > 1
  ) as repeated`);
  assert.ok(Number(repeatedCodes.rows[0]?.['count']) > 0);
}

test(
  'P013 D05 applies the certified monthly baseline atomically and idempotently on local PostgreSQL 17',
  { skip: !ENABLED },
  async () => {
    const bootstrap = new Pool({ connectionString: databaseUrl(), max: 3 });
    const harnesses: P013MonthlyBaselineLocalApplyHarness[] = [];
    let temporaryDirectory: string | undefined;
    try {
      await rebuildFromZero(bootstrap);
      const client = await bootstrap.connect();
      try {
        const source = await loadP013CertifiedMonthlySource(await sourcePath());
        await setupFixtures(client, source);
        await createRuntimeLogin(client);

        const missingActor = openConfinedHarness({
          databaseUrl: runtimeUrl(),
        });
        harnesses.push(missingActor);
        await assert.rejects(
          missingActor.dryRun({
            source,
            actor: { ...actor(''), request_id: '' },
            targetPlanVersionId: PLAN_MAIN,
          }),
          /P013_ACTOR_CONTEXT_INVALID/u,
        );
        await assert.rejects(
          missingActor.dryRun({
            source,
            actor: {
              app_user_id: VIEWER_ID,
              auth_subject: 'ci-p013-d05|viewer',
              request_id: 'p013-d05-viewer',
              justification: null,
              source: 'import',
            },
            targetPlanVersionId: PLAN_MAIN,
          }),
          /P013_ACTOR_NOT_AUTHORIZED/u,
        );

        await activatePlan(client, PLAN_STALE);
        const staleHarness = openConfinedHarness({
          databaseUrl: runtimeUrl(),
        });
        harnesses.push(staleHarness);
        const staleInactive = await staleHarness.dryRun({
          source,
          actor: actor('p013-d05-stale-inactive'),
          targetPlanVersionId: PLAN_STALE,
        });
        await setItemState(client, { active: false, deleted: false });
        await assert.rejects(staleHarness.apply(staleInactive), /P013_APPLY_STALE_PLAN/u);
        assert.deepEqual(await planCounts(client, PLAN_STALE), {
          baselines: 0,
          executions: 0,
          cells: 0,
          lines: 0,
        });
        await setItemState(client, { active: true, deleted: false });
        const staleDeleted = await staleHarness.dryRun({
          source,
          actor: actor('p013-d05-stale-deleted'),
          targetPlanVersionId: PLAN_STALE,
        });
        await setItemState(client, { active: true, deleted: true });
        await assert.rejects(staleHarness.apply(staleDeleted), /P013_APPLY_STALE_PLAN/u);
        await setItemState(client, { active: true, deleted: false });

        await activatePlan(client, PLAN_LATE);
        const lateHarness = openConfinedHarness({
          databaseUrl: runtimeUrl(),
          testFault: 'late_failure_once',
        });
        harnesses.push(lateHarness);
        const latePlan = await lateHarness.dryRun({
          source,
          actor: actor('p013-d05-late'),
          targetPlanVersionId: PLAN_LATE,
        });
        await assert.rejects(lateHarness.apply(latePlan), /P013_APPLY_TRANSACTION_FAILED/u);
        assert.deepEqual(await planCounts(client, PLAN_LATE), {
          baselines: 0,
          executions: 0,
          cells: 0,
          lines: 0,
        });
        const zeroAfterRollback = await client.query(`select
          (select count(*)::integer from ltc_m.monthly_source_artifacts) as artifacts,
          (select count(*)::integer from ltc_m.import_batches) as batches,
          (select count(*)::integer from ltc_m.import_batch_sheets) as sheets,
          (select count(*)::integer from ltc_m.import_staging_rows) as staging`);
        assert.deepEqual(zeroAfterRollback.rows[0], {
          artifacts: 0,
          batches: 0,
          sheets: 0,
          staging: 0,
        });

        await activatePlan(client, PLAN_MAIN);
        const firstHarness = openConfinedHarness({
          databaseUrl: runtimeUrl(),
        });
        const secondHarness = openConfinedHarness({
          databaseUrl: runtimeUrl(),
        });
        harnesses.push(firstHarness, secondHarness);
        const [firstPlan, secondPlan] = await Promise.all([
          firstHarness.dryRun({
            source,
            actor: actor('p013-d05-concurrent-a'),
            targetPlanVersionId: PLAN_MAIN,
          }),
          secondHarness.dryRun({
            source,
            actor: actor('p013-d05-concurrent-b'),
            targetPlanVersionId: PLAN_MAIN,
          }),
        ]);
        const concurrent = await Promise.all([
          firstHarness.apply(firstPlan),
          secondHarness.apply(secondPlan),
        ]);
        assert.deepEqual(concurrent.map(({ status }) => status).sort(), ['inserted', 'no_op']);
        const inserted = concurrent.find(({ status }) => status === 'inserted')!;
        const noOp = concurrent.find(({ status }) => status === 'no_op')!;
        assert.equal(noOp.baseline_id, inserted.baseline_id);
        assert.equal(noOp.import_batch_id, inserted.import_batch_id);
        assert.equal(noOp.execution_id, inserted.execution_id);
        assert.equal(inserted.transaction_isolation, 'serializable');
        assert.equal(inserted.runtime_role, 'ltc_m_runtime');
        assert.equal(inserted.advisory_lock_count, 10);
        await assertMainPersistence(client);

        const lostReceipt = await firstHarness.apply(firstPlan);
        assert.equal(lostReceipt.status, 'no_op');
        assert.equal(lostReceipt.baseline_id, inserted.baseline_id);
        assert.equal(lostReceipt.import_batch_id, inserted.import_batch_id);
        assert.equal(lostReceipt.execution_id, inserted.execution_id);
        await assertMainPersistence(client);

        temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'p013-d05-'));
        const variantPath = path.join(temporaryDirectory, 'monthly-format-variant.xlsx');
        await copyFile(await sourcePath(), variantPath);
        await chmod(variantPath, 0o600);
        await appendFile(variantPath, Buffer.from('P013-D05-OOXML-TRAILER', 'utf8'));
        const variant = await loadP013CertifiedMonthlySource(variantPath);
        assert.notEqual(variant.source_sha256, source.source_sha256);
        assert.equal(variant.source_semantic_fingerprint, source.source_semantic_fingerprint);
        const variantHarness = openConfinedHarness({
          databaseUrl: runtimeUrl(),
        });
        harnesses.push(variantHarness);
        const variantPlan = await variantHarness.dryRun({
          source: variant,
          actor: actor('p013-d05-new-sha'),
          targetPlanVersionId: PLAN_MAIN,
        });
        assert.equal(variantPlan.plan?.status, 'no_op_candidate');
        const variantReceipt = await variantHarness.apply(variantPlan);
        assert.equal(variantReceipt.status, 'no_op');
        assert.equal(variantReceipt.artifact_outcome, 'inserted');
        assert.equal(variantReceipt.baseline_id, inserted.baseline_id);
        const artifactCount = await client.query(
          `select count(*)::integer as count from ltc_m.monthly_source_artifacts`,
        );
        assert.equal(artifactCount.rows[0]?.['count'], 2);
        await assertMainPersistence(client);

        for (const [planId, fault, expectedAttempts] of [
          [PLAN_SERIALIZATION, '40001_once', 2],
          [PLAN_DEADLOCK, '40P01_once', 2],
        ] as const) {
          await activatePlan(client, planId);
          const retryHarness = openConfinedHarness({
            databaseUrl: runtimeUrl(),
            testFault: fault,
          });
          harnesses.push(retryHarness);
          const dryRun = await retryHarness.dryRun({
            source,
            actor: actor(`p013-d05-${fault}`),
            targetPlanVersionId: planId,
          });
          const applied = await retryHarness.apply(dryRun);
          assert.equal(applied.status, 'inserted');
          assert.equal(applied.attempts, expectedAttempts);
          assert.deepEqual(await planCounts(client, planId), {
            baselines: 1,
            executions: 1,
            cells: 432,
            lines: 102,
          });
        }

        await activatePlan(client, PLAN_UNIQUE);
        const uniqueHarness = openConfinedHarness({
          databaseUrl: runtimeUrl(),
          testFault: '23505_once',
        });
        harnesses.push(uniqueHarness);
        const uniquePlan = await uniqueHarness.dryRun({
          source,
          actor: actor('p013-d05-23505'),
          targetPlanVersionId: PLAN_UNIQUE,
        });
        await assert.rejects(uniqueHarness.apply(uniquePlan), /P013_APPLY_IDENTITY_CONFLICT/u);
        assert.deepEqual(await planCounts(client, PLAN_UNIQUE), {
          baselines: 0,
          executions: 0,
          cells: 0,
          lines: 0,
        });

        await activatePlan(client, PLAN_CONFLICT);
        const conflictHarness = openConfinedHarness({
          databaseUrl: runtimeUrl(),
        });
        harnesses.push(conflictHarness);
        const conflictPlan = await conflictHarness.dryRun({
          source,
          actor: actor('p013-d05-divergent'),
          targetPlanVersionId: PLAN_CONFLICT,
        });
        await client.query('begin');
        try {
          await client.query(
            `select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0))`,
            [`ltc_m.p013.plan:${PLAN_CONFLICT}`],
          );
          const concurrentDivergentApply = conflictHarness.apply(conflictPlan);
          let waiting = false;
          for (let attempt = 0; attempt < 200; attempt += 1) {
            const locks = await client.query(
              `select exists (
                 select 1 from pg_catalog.pg_locks as locks
                 where locks.locktype = 'advisory' and not locks.granted
               ) as waiting`,
            );
            waiting = locks.rows[0]?.['waiting'] === true;
            if (waiting) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          assert.equal(waiting, true);
          await client.query(
            `select ltc_m.set_actor_context($1::uuid, 'ci-p013-d05|admin',
              'p013-d05-divergent-fixture', null, 'import', false)`,
            [ADMIN_ID],
          );
          await client.query(
            `insert into ltc_m.monthly_plan_baselines
              (plan_version_id, metric_type, planning_level, semantic_contract_version,
               semantic_fingerprint, created_by_user_id)
             values ($1::uuid, 'billing_planned', 'item',
               'ltcm.p013.monthly-baseline-semantic.v1', $2::text, $3::uuid)`,
            [PLAN_CONFLICT, 'f'.repeat(64), ADMIN_ID],
          );
          await client.query('commit');
          await assert.rejects(concurrentDivergentApply, /P013_APPLY_CONFLICT/u);
        } catch (error) {
          await client.query('rollback').catch(() => undefined);
          throw error;
        }
        assert.deepEqual(await planCounts(client, PLAN_CONFLICT), {
          baselines: 1,
          executions: 0,
          cells: 0,
          lines: 0,
        });

        for (const harness of harnesses) await harness.close();
        let residual: { rows: Array<{ sessions: number; locks: number }> } | undefined;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          residual = await client.query<{ sessions: number; locks: number }>(
            `select
            (select count(*)::integer from pg_catalog.pg_stat_activity
              where usename = $1::text) as sessions,
            (select count(*)::integer from pg_catalog.pg_locks as locks
              join pg_catalog.pg_stat_activity as activity on activity.pid = locks.pid
              where activity.usename = $1::text) as locks`,
            [RUNTIME_LOGIN],
          );
          if (residual.rows[0]?.['sessions'] === 0 && residual.rows[0]?.['locks'] === 0) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (residual === undefined) throw new Error('P013_D06A_CLEANUP_PROBE_MISSING');
        assert.deepEqual(residual.rows[0], { sessions: 0, locks: 0 });
        await dropRuntimeLogin(client);
      } finally {
        for (const harness of harnesses) await harness.close().catch(() => undefined);
        await dropRuntimeLogin(client).catch(() => undefined);
        client.release();
      }
    } finally {
      if (temporaryDirectory !== undefined) {
        await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
      await rebuildFromZero(bootstrap, false).catch(() => undefined);
      await bootstrap.end();
    }
  },
);
