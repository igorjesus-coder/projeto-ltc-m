import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Pool, type PoolClient } from 'pg';

import { parseP012LoopbackDatabaseUrlForTestHarness } from './support/postgres-item-persistence.js';
import { P016_MIGRATION_BASELINE, readMigrationInventory } from './support/migration-inventory.js';

const DATABASE_URL = process.env['LTCM_P012_TEST_DATABASE_URL'];
const ENABLED = process.env['LTCM_P016_INTEGRATION'] === '1';
const ISOLATED_CLUSTER = process.env['LTCM_P016_ISOLATED_CLUSTER'] === '1';
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

const ADMIN_ID = '00000000-0000-4000-8000-000000016001';
const VIEWER_ID = '00000000-0000-4000-8000-000000016002';
const CLIENT_ID = '00000000-0000-4000-8000-000000016003';
const PROJECT_A = '00000000-0000-4000-8000-000000016010';
const PROJECT_B = '00000000-0000-4000-8000-000000016011';
const PROJECT_USD = '00000000-0000-4000-8000-000000016012';
const PROJECT_HIDDEN = '00000000-0000-4000-8000-000000016013';
const ITEM_A1 = '00000000-0000-4000-8000-000000016020';
const ITEM_A2 = '00000000-0000-4000-8000-000000016021';
const ITEM_B = '00000000-0000-4000-8000-000000016022';
const ITEM_USD = '00000000-0000-4000-8000-000000016023';
const ITEM_HIDDEN = '00000000-0000-4000-8000-000000016024';
const PLAN_BASELINE = '00000000-0000-4000-8000-000000016030';
const PLAN_REVISION = '00000000-0000-4000-8000-000000016031';
const LINE_A_JUL = '00000000-0000-4000-8000-000000016040';
const LINE_A_ZERO = '00000000-0000-4000-8000-000000016041';
const BATCH_ID = '00000000-0000-4000-8000-000000016050';
const SHEET_ID = '00000000-0000-4000-8000-000000016051';
const STAGING_ID = '00000000-0000-4000-8000-000000016052';
const ARTIFACT_ID = '00000000-0000-4000-8000-000000016053';
const BASELINE_ID = '00000000-0000-4000-8000-000000016054';
const EXECUTION_ID = '00000000-0000-4000-8000-000000016055';
const BATCH_RERUN_ID = '00000000-0000-4000-8000-000000016056';
const EXECUTION_RERUN_ID = '00000000-0000-4000-8000-000000016057';
const ARTIFACT_SHA = 'a'.repeat(64);
const SOURCE_SEMANTIC = 'b'.repeat(64);
const BASELINE_SEMANTIC = 'c'.repeat(64);

const sourceLine = (character: string): string => `p012-item-v1:${character.repeat(64)}`;

function parseIsolatedUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('P016_POSTGRES_ENV_MISSING');
  }
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const port = Number(parsed.port);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase()) ||
    databaseName !== 'ltcm_test' ||
    parsed.pathname !== '/ltcm_test' ||
    !Number.isSafeInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error('P016_POSTGRES_ENV_MISSING');
  }
}

function databaseUrl(): string {
  if (DATABASE_URL === undefined || DATABASE_URL === '') {
    throw new Error('P016_POSTGRES_ENV_MISSING');
  }
  if (ISOLATED_CLUSTER) parseIsolatedUrl(DATABASE_URL);
  else parseP012LoopbackDatabaseUrlForTestHarness(DATABASE_URL);
  return DATABASE_URL;
}

async function guard(client: PoolClient): Promise<void> {
  const result = await client.query(
    `select current_database() as database_name,
            current_user,
            current_setting('server_version_num') as server_version_num,
            roles.rolsuper,
            roles.rolbypassrls
       from pg_catalog.pg_roles as roles
      where roles.rolname = current_user`,
  );
  assert.deepEqual(result.rows[0], {
    database_name: 'ltcm_test',
    current_user: 'postgres',
    server_version_num: result.rows[0]?.['server_version_num'],
    rolsuper: true,
    rolbypassrls: true,
  });
  assert.match(String(result.rows[0]?.['server_version_num']), /^17/u);
}

async function migrations(): Promise<Array<{ name: string; sql: string }>> {
  const directory = path.join(REPOSITORY_ROOT, 'supabase', 'migrations');
  return readMigrationInventory(directory, P016_MIGRATION_BASELINE);
}

async function installAdmin(client: PoolClient): Promise<void> {
  await client.query('begin');
  try {
    await client.query(
      `select ltc_m.set_actor_context(null, null, 'p016-bootstrap', null, 'system', false)`,
    );
    await client.query(
      `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
       values ($1::uuid, 'ci-p016|admin', 'P016 Bootstrap Admin', 'admin', true)`,
      [ADMIN_ID],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}

async function rebuildFromZero(pool: Pool): Promise<void> {
  const client = await pool.connect();
  let currentMigration = 'preflight';
  try {
    await guard(client);
    await client.query('drop schema if exists ltc_m cascade');
    for (const migration of await migrations()) {
      currentMigration = migration.name;
      await client.query(migration.sql);
      if (migration.name === '20260731103000_add_ltcm_audit_read_event.sql') {
        await installAdmin(client);
      }
    }
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw new Error(`P016_MIGRATION_FROM_ZERO_FAILED:${currentMigration}`, { cause: error });
  } finally {
    client.release();
  }
}

async function actor(client: PoolClient, id: string, subject: string): Promise<void> {
  await client.query(
    `select ltc_m.set_actor_context($1::uuid, $2::text, $3::text, null, 'system', false)`,
    [id, subject, `p016-${id.slice(-4)}`],
  );
}

async function runtimeTransaction<T>(
  pool: Pool,
  userId: string,
  subject: string,
  callback: (client: PoolClient) => Promise<T>,
  readOnly = false,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(readOnly ? 'begin transaction read only' : 'begin');
    await actor(client, userId, subject);
    await client.query('set local role ltc_m_runtime');
    const result = await callback(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function setupFixtures(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await actor(client, ADMIN_ID, 'ci-p016|admin');
    await client.query(
      `insert into ltc_m.currencies (code, name) values ('BRL', 'Real'), ('USD', 'Dollar')`,
    );
    await client.query(`insert into ltc_m.units (code, name) values ('US', 'Synthetic unit')`);
    await client.query(
      `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
       values ($1::uuid, 'ci-p016|viewer', 'P016 Viewer', 'viewer', true)`,
      [VIEWER_ID],
    );
    await client.query(
      `insert into ltc_m.clients (id, legal_name, display_name, created_by_user_id)
       values ($1::uuid, 'P016 Client', 'P016 Client', $2::uuid)`,
      [CLIENT_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.projects (
         id, project_code, project_name, client_id, status, base_currency,
         contract_value, data_reference_date, created_by_user_id
       ) values
         ($1::uuid, 'P016-A', 'Project A', $5::uuid, 'active', 'BRL', 2000000.00, date '2026-07-01', $6::uuid),
         ($2::uuid, 'P016-B', 'Project B', $5::uuid, 'active', 'BRL', 900000.00, date '2026-07-01', $6::uuid),
         ($3::uuid, 'P016-USD', 'Project USD', $5::uuid, 'active', 'USD', 100.00, date '2026-07-01', $6::uuid),
         ($4::uuid, 'P016-HIDDEN', 'Hidden draft', $5::uuid, 'draft', 'BRL', 50.00, date '2026-07-01', $6::uuid)`,
      [PROJECT_A, PROJECT_B, PROJECT_USD, PROJECT_HIDDEN, CLIENT_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.project_items (
         id, project_id, source_line_key, line_number, item_code, description,
         quantity, unit_code, currency_code, unit_price, created_by_user_id
       ) values
         ($1::uuid, $6::uuid, $11::text, 1, 'REPEATED', 'A1', 1, 'US', 'BRL', 1000000.00, $10::uuid),
         ($2::uuid, $6::uuid, $12::text, 2, 'REPEATED', 'A2', 1, 'US', 'BRL', 1000000.00, $10::uuid),
         ($3::uuid, $7::uuid, $13::text, 1, 'B', 'B1', 1, 'US', 'BRL', 800460.18, $10::uuid),
         ($4::uuid, $8::uuid, $14::text, 1, 'USD', 'USD1', 1, 'US', 'USD', 100.00, $10::uuid),
         ($5::uuid, $9::uuid, $15::text, 1, 'HIDDEN', 'Hidden', 1, 'US', 'BRL', 50.00, $10::uuid)`,
      [
        ITEM_A1,
        ITEM_A2,
        ITEM_B,
        ITEM_USD,
        ITEM_HIDDEN,
        PROJECT_A,
        PROJECT_B,
        PROJECT_USD,
        PROJECT_HIDDEN,
        ADMIN_ID,
        sourceLine('1'),
        sourceLine('2'),
        sourceLine('3'),
        sourceLine('4'),
        sourceLine('5'),
      ],
    );
    await client.query(
      `insert into ltc_m.plan_versions (
         id, name, reference_date, status, is_baseline, created_by_user_id
       ) values
         ($1::uuid, 'P016 Baseline', date '2026-07-01', 'draft', true, $3::uuid),
         ($2::uuid, 'P016 Revision', date '2026-08-01', 'draft', false, $3::uuid)`,
      [PLAN_BASELINE, PLAN_REVISION, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.financial_plan_scopes (
         plan_version_id, project_id, metric_type, planning_level, currency_code,
         created_by_user_id
       ) values
         ($1::uuid, $3::uuid, 'billing_planned', 'item', 'BRL', $6::uuid),
         ($1::uuid, $4::uuid, 'billing_planned', 'item', 'BRL', $6::uuid),
         ($1::uuid, $5::uuid, 'billing_planned', 'item', 'USD', $6::uuid),
         ($2::uuid, $3::uuid, 'billing_planned', 'item', 'BRL', $6::uuid)`,
      [PLAN_BASELINE, PLAN_REVISION, PROJECT_A, PROJECT_B, PROJECT_USD, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.financial_plan_lines (
         id, plan_version_id, project_id, project_item_id, metric_type,
         planning_level, competence_month, amount, currency_code, created_by_user_id
       ) values
         ($1::uuid, $3::uuid, $5::uuid, $7::uuid, 'billing_planned', 'item', date '2026-07-01', 1000000.00, 'BRL', $9::uuid),
         (gen_random_uuid(), $3::uuid, $5::uuid, $8::uuid, 'billing_planned', 'item', date '2026-08-01', 1000000.00, 'BRL', $9::uuid),
         ($2::uuid, $3::uuid, $5::uuid, $7::uuid, 'billing_planned', 'item', date '2026-09-01', 0.00, 'BRL', $9::uuid),
         (gen_random_uuid(), $3::uuid, $6::uuid, $10::uuid, 'billing_planned', 'item', date '2026-07-01', 400000.00, 'BRL', $9::uuid),
         (gen_random_uuid(), $3::uuid, $6::uuid, $10::uuid, 'billing_planned', 'item', date '2026-08-01', 400460.18, 'BRL', $9::uuid),
         (gen_random_uuid(), $3::uuid, $11::uuid, $12::uuid, 'billing_planned', 'item', date '2026-07-01', 100.00, 'USD', $9::uuid),
         (gen_random_uuid(), $4::uuid, $5::uuid, $7::uuid, 'billing_planned', 'item', date '2026-07-01', 10.00, 'BRL', $9::uuid)`,
      [
        LINE_A_JUL,
        LINE_A_ZERO,
        PLAN_BASELINE,
        PLAN_REVISION,
        PROJECT_A,
        PROJECT_B,
        ITEM_A1,
        ITEM_A2,
        ADMIN_ID,
        ITEM_B,
        PROJECT_USD,
        ITEM_USD,
      ],
    );
    await client.query(
      `insert into ltc_m.financial_actual_events (
         project_id, metric_type, competence_date, source_key, amount, currency_code,
         status, created_by_user_id
       ) values
         ($1::uuid, 'billing_actual', date '2026-07-15', 'p016-a-draft', 50.00, 'BRL', 'draft', $3::uuid),
         ($1::uuid, 'billing_actual', date '2026-07-20', 'p016-a-posted', 25.00, 'BRL', 'posted', $3::uuid),
         ($2::uuid, 'billing_actual', date '2026-07-10', 'p016-usd-posted', 10.00, 'USD', 'posted', $3::uuid)`,
      [PROJECT_A, PROJECT_USD, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.import_batches (
         id, source_name, source_hash, source_size_bytes, source_mime_type,
         idempotency_key, status, received_rows, accepted_rows, submitted_by_user_id
       ) values ($1::uuid, 'p016.xlsx', $2::text, 100,
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         $3::text, 'loaded', 1, 1, $4::uuid)`,
      [BATCH_ID, ARTIFACT_SHA, `p013-baseline-v1:${'d'.repeat(64)}`, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.import_batches (
         id, source_name, source_hash, source_size_bytes, source_mime_type,
         idempotency_key, status, received_rows, accepted_rows, submitted_by_user_id
       ) values ($1::uuid, 'p016-rerun.xlsx', $2::text, 100,
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         $3::text, 'loaded', 1, 1, $4::uuid)`,
      [BATCH_RERUN_ID, ARTIFACT_SHA, `p013-rerun-v1:${'f'.repeat(64)}`, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.import_batch_sheets (
         id, import_batch_id, sheet_key, sheet_name, sheet_index, detected_range,
         first_row, last_row, found_rows, staged_rows, status, created_by_user_id
       ) values ($1::uuid, $2::uuid, 'monthly_revenue', 'Prev. Receita Mensal', 1,
                 'A1:T52', 1, 52, 52, 1, 'completed', $3::uuid)`,
      [SHEET_ID, BATCH_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.import_staging_rows (
         id, import_batch_sheet_id, source_row_number, source_range, row_kind,
         raw_payload, row_hash, status, created_by_user_id
       ) values ($1::uuid, $2::uuid, 4, 'A4:T4', 'data', '{}'::jsonb,
                 $3::text, 'processed', $4::uuid)`,
      [STAGING_ID, SHEET_ID, 'e'.repeat(64), ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.monthly_source_artifacts (
         id, source_sha256, source_size_bytes, source_mime_type, source_name,
         source_contract_version, worksheet_key, worksheet_name, structural_range,
         source_semantic_fingerprint, created_by_user_id
       ) values ($1::uuid, $2::text, 100,
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'p016.xlsx',
         'ltcm.p013.source-artifact.v1', 'monthly_revenue', 'Prev. Receita Mensal',
         'A1:T52', $3::text, $4::uuid)`,
      [ARTIFACT_ID, ARTIFACT_SHA, SOURCE_SEMANTIC, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.monthly_plan_baselines (
         id, plan_version_id, metric_type, planning_level, semantic_contract_version,
         semantic_fingerprint, created_by_user_id
       ) values ($1::uuid, $2::uuid, 'billing_planned', 'item',
                 'ltcm.p013.monthly-baseline-semantic.v1', $3::text, $4::uuid)`,
      [BASELINE_ID, PLAN_BASELINE, BASELINE_SEMANTIC, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.monthly_plan_import_executions (
         id, import_batch_id, source_artifact_id, source_sha256, baseline_id,
         baseline_semantic_fingerprint, plan_version_id, metric_type, planning_level,
         created_by_user_id
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid, $6::text,
                 $7::uuid, 'billing_planned', 'item', $8::uuid)`,
      [
        EXECUTION_ID,
        BATCH_ID,
        ARTIFACT_ID,
        ARTIFACT_SHA,
        BASELINE_ID,
        BASELINE_SEMANTIC,
        PLAN_BASELINE,
        ADMIN_ID,
      ],
    );
    await client.query(
      `insert into ltc_m.monthly_plan_import_executions (
         id, import_batch_id, source_artifact_id, source_sha256, baseline_id,
         baseline_semantic_fingerprint, plan_version_id, metric_type, planning_level,
         created_by_user_id
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid, $6::text,
                 $7::uuid, 'billing_planned', 'item', $8::uuid)`,
      [
        EXECUTION_RERUN_ID,
        BATCH_RERUN_ID,
        ARTIFACT_ID,
        ARTIFACT_SHA,
        BASELINE_ID,
        BASELINE_SEMANTIC,
        PLAN_BASELINE,
        ADMIN_ID,
      ],
    );
    await client.query(
      `insert into ltc_m.monthly_plan_cells (
         import_batch_id, import_batch_sheet_id, import_staging_row_id,
         baseline_id, baseline_semantic_fingerprint, plan_version_id, project_id,
         project_item_id, metric_type, planning_level, competence_month,
         source_line_key, source_item_number, source_row_number, source_column,
         source_cell_reference, declaration_state, source_numeric_text,
         source_value_hash, canonical_amount, financial_plan_line_id, created_by_user_id
       ) values
         ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::uuid, $7::uuid,
          $8::uuid, 'billing_planned', 'item', date '2026-07-01', $9::text, '1', 4,
          'K', 'K4', 'value', '1000000', $10::text, 1000000.00, $11::uuid, $12::uuid),
         ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::uuid, $7::uuid,
          $8::uuid, 'billing_planned', 'item', date '2026-09-01', $9::text, '1', 4,
          'M', 'M4', 'explicit_zero', '0', $13::text, 0.00, $14::uuid, $12::uuid),
         ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::uuid, $7::uuid,
          $8::uuid, 'billing_planned', 'item', date '2026-10-01', $9::text, '1', 4,
          'N', 'N4', 'blank', null, null, null, null, $12::uuid)`,
      [
        BATCH_ID,
        SHEET_ID,
        STAGING_ID,
        BASELINE_ID,
        BASELINE_SEMANTIC,
        PLAN_BASELINE,
        PROJECT_A,
        ITEM_A1,
        sourceLine('1'),
        'f'.repeat(64),
        LINE_A_JUL,
        ADMIN_ID,
        '9'.repeat(64),
        LINE_A_ZERO,
      ],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function assertViewSchema(pool: Pool): Promise<void> {
  const views = await pool.query(
    `select pg_class.relname, pg_class.reloptions
       from pg_catalog.pg_class
       join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = 'ltc_m'
        and pg_class.relname like 'v_tableau_%'
        and pg_class.relkind = 'v'
      order by pg_class.relname`,
  );
  assert.equal(views.rowCount, 9);
  for (const row of views.rows) {
    assert.ok(row['reloptions'].includes('security_invoker=true'));
    assert.ok(row['reloptions'].includes('security_barrier=true'));
  }
  const grants = await pool.query(
    `select table_name, string_agg(privilege_type, ',' order by privilege_type) as privileges
       from information_schema.role_table_grants
      where grantee = 'ltc_m_runtime'
        and table_schema = 'ltc_m'
        and table_name like 'v_tableau_%'
      group by table_name`,
  );
  assert.equal(grants.rowCount, 9);
  for (const row of grants.rows) assert.equal(row['privileges'], 'SELECT');
}

async function assertUniqueKeys(client: PoolClient): Promise<void> {
  const checks = [
    ['v_tableau_portfolio_overview', 'currency_code'],
    ['v_tableau_project_overview', 'project_id'],
    ['v_tableau_project_items', 'project_item_id'],
    ['v_tableau_project_items', 'project_id, source_line_key'],
    ['v_tableau_financial_monthly', 'analytical_fact_key'],
    [
      'v_tableau_s_curve_portfolio',
      "series_kind, coalesce(plan_version_id::text, '-'), coalesce(actual_status, '-'), competence_month, metric_type, currency_code",
    ],
    [
      'v_tableau_s_curve_project',
      "project_id, series_kind, coalesce(plan_version_id::text, '-'), coalesce(actual_status, '-'), competence_month, metric_type, currency_code",
    ],
    ['v_tableau_data_quality', 'finding_id'],
    ['v_tableau_plan_versions', 'analytical_version_key'],
    ['v_tableau_source_provenance', 'monthly_plan_cell_id'],
  ] as const;
  for (const [view, key] of checks) {
    const result = await client.query(
      `select count(*)::integer as duplicate_count
         from (
           select ${key}
             from ltc_m.${view}
            group by ${key}
           having count(*) > 1
         ) as duplicates`,
    );
    assert.equal(result.rows[0]?.['duplicate_count'], 0, `${view} key is not unique`);
  }
}

test(
  'P016 aplica o inventário atual de migrations do zero e prova views, grão, fan-out, RLS e cleanup',
  { skip: !ENABLED },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl(), max: 6 });
    let membershipGranted = false;
    try {
      await rebuildFromZero(pool);
      await assertViewSchema(pool);
      await pool.query('grant ltc_m_runtime to postgres');
      membershipGranted = true;
      await setupFixtures(pool);

      await runtimeTransaction(pool, ADMIN_ID, 'ci-p016|admin', async (client) => {
        await assertUniqueKeys(client);

        const versionSources = await client.query(
          `select count(*)::integer as version_scope_count,
                  min(source_execution_count)::text as minimum_execution_count,
                  max(source_execution_count)::text as maximum_execution_count,
                  min(source_artifact_count)::text as minimum_artifact_count,
                  max(source_artifact_count)::text as maximum_artifact_count
             from ltc_m.v_tableau_plan_versions
            where plan_version_id = $1::uuid`,
          [PLAN_BASELINE],
        );
        assert.deepEqual(versionSources.rows, [
          {
            version_scope_count: 3,
            minimum_execution_count: '2',
            maximum_execution_count: '2',
            minimum_artifact_count: '1',
            maximum_artifact_count: '1',
          },
        ]);

        const repeated = await client.query(
          `select count(*)::integer as item_count,
                  count(distinct project_item_id)::integer as identity_count
             from ltc_m.v_tableau_project_items
            where project_id = $1::uuid and item_code = 'REPEATED'`,
          [PROJECT_A],
        );
        assert.deepEqual(repeated.rows[0], { item_count: 2, identity_count: 2 });

        const projects = await client.query(
          `select project_id, active_item_total::text, contract_item_delta::text,
                  project_reconciliation_status, actual_event_count,
                  project_month_actual_available, billing_actual_canonical_amount
             from ltc_m.v_tableau_project_overview
            where project_id in ($1::uuid, $2::uuid)
            order by project_id`,
          [PROJECT_A, PROJECT_B],
        );
        assert.deepEqual(projects.rows, [
          {
            project_id: PROJECT_A,
            active_item_total: '2000000.00',
            contract_item_delta: '0.00',
            project_reconciliation_status: 'PASS',
            actual_event_count: '2',
            project_month_actual_available: true,
            billing_actual_canonical_amount: null,
          },
          {
            project_id: PROJECT_B,
            active_item_total: '800460.18',
            contract_item_delta: '-99539.82',
            project_reconciliation_status: 'ERROR',
            actual_event_count: '0',
            project_month_actual_available: false,
            billing_actual_canonical_amount: null,
          },
        ]);

        const planTotal = await client.query(
          `select sum(amount)::text as analytical_total
             from ltc_m.v_tableau_financial_monthly
            where fact_kind = 'planned'
              and plan_version_id = $1::uuid
              and currency_code = 'BRL'`,
          [PLAN_BASELINE],
        );
        assert.equal(planTotal.rows[0]?.['analytical_total'], '2800460.18');
        const baseTotal = await client.query(
          `select sum(amount)::text as base_total
             from ltc_m.financial_plan_lines
            where plan_version_id = $1::uuid and currency_code = 'BRL'`,
          [PLAN_BASELINE],
        );
        assert.equal(planTotal.rows[0]?.['analytical_total'], baseTotal.rows[0]?.['base_total']);

        const curve = await client.query(
          `select competence_month::text as competence_month, monthly_amount::text, cumulative_amount::text
             from ltc_m.v_tableau_s_curve_portfolio
            where series_kind = 'planned'
              and plan_version_id = $1::uuid
              and currency_code = 'BRL'
            order by competence_month`,
          [PLAN_BASELINE],
        );
        assert.deepEqual(curve.rows, [
          {
            competence_month: '2026-07-01',
            monthly_amount: '1400000.00',
            cumulative_amount: '1400000.00',
          },
          {
            competence_month: '2026-08-01',
            monthly_amount: '1400460.18',
            cumulative_amount: '2800460.18',
          },
          {
            competence_month: '2026-09-01',
            monthly_amount: '0.00',
            cumulative_amount: '2800460.18',
          },
        ]);
        assert.equal(
          curve.rows.at(-1)?.['cumulative_amount'],
          planTotal.rows[0]?.['analytical_total'],
        );

        const separation = await client.query(
          `select plan_version_id, currency_code, max(cumulative_amount)::text as final_total
             from ltc_m.v_tableau_s_curve_portfolio
            where series_kind = 'planned'
            group by plan_version_id, currency_code
            order by plan_version_id, currency_code`,
        );
        assert.deepEqual(
          separation.rows.map((row) => [
            row['plan_version_id'],
            row['currency_code'],
            row['final_total'],
          ]),
          [
            [PLAN_BASELINE, 'BRL', '2800460.18'],
            [PLAN_BASELINE, 'USD', '100.00'],
            [PLAN_REVISION, 'BRL', '10.00'],
          ],
        );

        const actual = await client.query(
          `select actual_status, monthly_amount::text, cumulative_amount::text
             from ltc_m.v_tableau_s_curve_project
            where project_id = $1::uuid and series_kind = 'actual'
            order by actual_status`,
          [PROJECT_A],
        );
        assert.deepEqual(actual.rows, [
          { actual_status: 'draft', monthly_amount: '50.00', cumulative_amount: '50.00' },
          { actual_status: 'posted', monthly_amount: '25.00', cumulative_amount: '25.00' },
        ]);
        const p014NoAllocation = await client.query(
          `select
             (select count(*) from ltc_m.v_tableau_s_curve_project
               where project_id = $1::uuid and series_kind = 'actual')::integer as fabricated_rows,
             (select count(*) from ltc_m.v_tableau_financial_monthly
               where p014_derived)::integer as p014_derived_rows`,
          [PROJECT_B],
        );
        assert.deepEqual(p014NoAllocation.rows[0], { fabricated_rows: 0, p014_derived_rows: 0 });

        const quality = await client.query(
          `select finding_code, expected_value::text, observed_value::text, delta::text,
                  reconciliation_contract
             from ltc_m.v_tableau_data_quality
            where project_id = $1::uuid and finding_code = 'PROJECT_VALUE_MISMATCH'`,
          [PROJECT_B],
        );
        assert.deepEqual(quality.rows[0], {
          finding_code: 'PROJECT_VALUE_MISMATCH',
          expected_value: '900000.00',
          observed_value: '800460.18',
          delta: '-99539.82',
          reconciliation_contract: 'ltcm.p015.reconciliation-report.v1',
        });
        const pending = await client.query(
          `select count(*)::integer as pending_count
             from ltc_m.v_tableau_data_quality
            where finding_code = 'ACTUAL_STATUS_UNRESOLVED'
              and decision_reference = 'P014-ACTUAL-STATUS'`,
        );
        assert.equal(pending.rows[0]?.['pending_count'], 2);

        const provenance = await client.query(
          `select declaration_state, canonical_amount::text, source_cell_reference
             from ltc_m.v_tableau_source_provenance
            order by competence_month`,
        );
        assert.deepEqual(provenance.rows, [
          {
            declaration_state: 'value',
            canonical_amount: '1000000.00',
            source_cell_reference: 'K4',
          },
          {
            declaration_state: 'explicit_zero',
            canonical_amount: '0.00',
            source_cell_reference: 'M4',
          },
          { declaration_state: 'blank', canonical_amount: null, source_cell_reference: 'N4' },
        ]);

        const explain = await client.query(
          `explain (format json)
           select * from ltc_m.v_tableau_project_overview where project_id = $1::uuid`,
          [PROJECT_A],
        );
        assert.equal(Array.isArray(explain.rows[0]?.['QUERY PLAN']), true);
      });

      const viewer = await runtimeTransaction(
        pool,
        VIEWER_ID,
        'ci-p016|viewer',
        async (client) => {
          const visible = await client.query(
            `select project_code from ltc_m.v_tableau_project_overview order by project_code`,
          );
          const hidden = await client.query(
            `select count(*)::integer as hidden_count
               from ltc_m.v_tableau_project_overview where project_id = $1::uuid`,
            [PROJECT_HIDDEN],
          );
          const draftPlans = await client.query(
            `select count(*)::integer as draft_count
               from ltc_m.v_tableau_financial_monthly where fact_kind = 'planned'`,
          );
          return { visible: visible.rows, hidden: hidden.rows[0], draftPlans: draftPlans.rows[0] };
        },
        true,
      );
      assert.deepEqual(
        viewer.visible.map((row) => row['project_code']),
        ['P016-A', 'P016-B', 'P016-USD'],
      );
      assert.deepEqual(viewer.hidden, { hidden_count: 0 });
      assert.deepEqual(viewer.draftPlans, { draft_count: 0 });

      const countsBefore = await pool.query(
        `select
           (select count(*) from ltc_m.projects)::integer as projects,
           (select count(*) from ltc_m.financial_plan_lines)::integer as lines,
           (select count(*) from ltc_m.financial_actual_events)::integer as actuals,
           (select count(*) from ltc_m.audit_log)::integer as audits`,
      );
      await runtimeTransaction(
        pool,
        ADMIN_ID,
        'ci-p016|admin',
        async (client) => {
          for (const view of [
            'v_tableau_portfolio_overview',
            'v_tableau_project_overview',
            'v_tableau_project_items',
            'v_tableau_financial_monthly',
            'v_tableau_s_curve_portfolio',
            'v_tableau_s_curve_project',
            'v_tableau_data_quality',
            'v_tableau_plan_versions',
            'v_tableau_source_provenance',
          ]) {
            await client.query(`select count(*) from ltc_m.${view}`);
          }
        },
        true,
      );
      const countsAfter = await pool.query(
        `select
           (select count(*) from ltc_m.projects)::integer as projects,
           (select count(*) from ltc_m.financial_plan_lines)::integer as lines,
           (select count(*) from ltc_m.financial_actual_events)::integer as actuals,
           (select count(*) from ltc_m.audit_log)::integer as audits`,
      );
      assert.deepEqual(countsAfter.rows[0], countsBefore.rows[0]);
    } finally {
      if (membershipGranted) await pool.query('revoke ltc_m_runtime from postgres');
      await rebuildFromZero(pool);
      const cleanup = await pool.query(
        `select
           (select count(*) from ltc_m.projects)::integer as projects,
           (select count(*) from ltc_m.project_items)::integer as items,
           (select count(*) from ltc_m.financial_plan_lines)::integer as lines,
           (select count(*) from ltc_m.financial_actual_events)::integer as actuals,
           (select count(*) from ltc_m.monthly_plan_cells)::integer as cells`,
      );
      assert.deepEqual(cleanup.rows[0], { projects: 0, items: 0, lines: 0, actuals: 0, cells: 0 });
      const locks = await pool.query(
        `select count(*)::integer as advisory_lock_count
           from pg_catalog.pg_locks
          where locktype = 'advisory'
            and database = (
              select oid from pg_catalog.pg_database where datname = current_database()
            )`,
      );
      assert.equal(locks.rows[0]?.['advisory_lock_count'], 0);
      assert.equal(pool.waitingCount, 0);
      await pool.end();
      assert.equal(pool.totalCount, 0);
    }
  },
);
