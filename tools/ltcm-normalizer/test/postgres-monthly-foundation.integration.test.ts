import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Pool, type PoolClient } from 'pg';

import { parseP012LoopbackDatabaseUrlForTestHarness } from './support/postgres-item-persistence.js';
import {
  ADMIN_BOOTSTRAP_MIGRATION,
  P013_MIGRATION_BASELINE,
  readMigrationInventory,
} from './support/migration-inventory.js';

const DATABASE_URL = process.env['LTCM_P012_TEST_DATABASE_URL'];
const ENABLED = process.env['LTCM_P013_INTEGRATION'] === '1';
const ISOLATED_CLUSTER = process.env['LTCM_P013_ISOLATED_CLUSTER'] === '1';
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ADMIN_ID = '00000000-0000-4000-8000-000000013001';
const VIEWER_ID = '00000000-0000-4000-8000-000000013002';
const CLIENT_ID = '00000000-0000-4000-8000-000000013003';
const PROJECT_ID = '00000000-0000-4000-8000-000000013004';
const ITEM_ID = '00000000-0000-4000-8000-000000013005';
const PLAN_ID = '00000000-0000-4000-8000-000000013006';
const NON_BASELINE_PLAN_ID = '00000000-0000-4000-8000-000000013007';
const BATCH_ID = '00000000-0000-4000-8000-000000013008';
const SHEET_ID = '00000000-0000-4000-8000-000000013009';
const STAGING_ID = '00000000-0000-4000-8000-000000013010';
const ARTIFACT_ID = '00000000-0000-4000-8000-000000013011';
const BASELINE_ID = '00000000-0000-4000-8000-000000013012';
const EXECUTION_ID = '00000000-0000-4000-8000-000000013013';
const VALUE_LINE_ID = '00000000-0000-4000-8000-000000013014';
const ZERO_LINE_ID = '00000000-0000-4000-8000-000000013015';
const ARTIFACT_SHA = 'a'.repeat(64);
const SOURCE_SEMANTIC = 'b'.repeat(64);
const BASELINE_SEMANTIC = 'c'.repeat(64);
const SOURCE_LINE_KEY = `p012-item-v1:${'d'.repeat(64)}`;

function rawHostname(value: string): string {
  const protocolEnd = value.indexOf('://');
  const authorityEndCandidates = [
    value.indexOf('/', protocolEnd + 3),
    value.indexOf('?', protocolEnd + 3),
    value.indexOf('#', protocolEnd + 3),
  ].filter((index) => index >= 0);
  const authorityEnd =
    authorityEndCandidates.length === 0 ? value.length : Math.min(...authorityEndCandidates);
  const authority = value.slice(protocolEnd + 3, authorityEnd);
  const hostAndPort = authority.slice(authority.lastIndexOf('@') + 1);
  if (hostAndPort.startsWith('[')) {
    const closingBracket = hostAndPort.indexOf(']');
    return closingBracket < 0 ? hostAndPort : hostAndPort.slice(0, closingBracket + 1);
  }
  const colon = hostAndPort.lastIndexOf(':');
  return colon < 0 ? hostAndPort : hostAndPort.slice(0, colon);
}

function parseP013IsolatedClusterUrlForTestHarness(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('P013_POSTGRES_ENV_MISSING');
  }
  const hostname = parsed.hostname.toLowerCase();
  const suppliedHostname = rawHostname(value).toLowerCase();
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const port = Number(parsed.port);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(hostname) ||
    suppliedHostname !== hostname ||
    databaseName !== 'ltcm_test' ||
    parsed.pathname !== '/ltcm_test' ||
    !Number.isSafeInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error('P013_POSTGRES_ENV_MISSING');
  }
}

function databaseUrl(): string {
  if (DATABASE_URL === undefined || DATABASE_URL === '') {
    throw new Error('P013_POSTGRES_ENV_MISSING');
  }
  if (ISOLATED_CLUSTER) parseP013IsolatedClusterUrlForTestHarness(DATABASE_URL);
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
  const row = result.rows[0];
  assert.equal(row?.['database_name'], 'ltcm_test');
  assert.equal(row?.['current_user'], 'postgres');
  assert.match(String(row?.['server_version_num']), /^17/u);
  assert.equal(row?.['rolsuper'], true);
  assert.equal(row?.['rolbypassrls'], true);
}

async function migrations(): Promise<Array<{ name: string; sql: string }>> {
  const directory = path.join(REPOSITORY_ROOT, 'supabase', 'migrations');
  return readMigrationInventory(directory, P013_MIGRATION_BASELINE, 'historical');
}

async function installAdmin(client: PoolClient): Promise<void> {
  await client.query('begin');
  try {
    await client.query(
      `select ltc_m.set_actor_context(null, null, $1::text, null, 'system', false)`,
      ['p013-bootstrap'],
    );
    await client.query(
      `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
       values ($1::uuid, 'ci-p013|admin', 'P013 Bootstrap Admin', 'admin', true)`,
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
    const membership = await client.query(
      `select count(*)::integer as membership_count
         from pg_catalog.pg_auth_members
         join pg_catalog.pg_roles as member_role on member_role.oid = pg_auth_members.member
         join pg_catalog.pg_roles as granted_role on granted_role.oid = pg_auth_members.roleid
        where member_role.rolname = 'ltc_m_runtime'
           or granted_role.rolname = 'ltc_m_runtime'`,
    );
    assert.equal(membership.rows[0]?.['membership_count'], 0);
    await client.query('drop schema if exists ltc_m cascade');
    for (const migration of await migrations()) {
      currentMigration = migration.name;
      await client.query(migration.sql);
      if (migration.name === ADMIN_BOOTSTRAP_MIGRATION) await installAdmin(client);
    }
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw new Error(`P013_MIGRATION_FROM_ZERO_FAILED:${currentMigration}`, { cause: error });
  } finally {
    client.release();
  }
}

async function actor(client: PoolClient, id: string, subject: string): Promise<void> {
  await client.query(
    `select ltc_m.set_actor_context($1::uuid, $2::text, $3::text, null, 'import', false)`,
    [id, subject, `p013-${id.slice(-4)}`],
  );
}

async function setupFixtures(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await actor(client, ADMIN_ID, 'ci-p013|admin');
    await client.query(`insert into ltc_m.currencies (code, name) values ('BRL', 'Real')`);
    await client.query(`insert into ltc_m.units (code, name) values ('US', 'Unidade sintética')`);
    await client.query(
      `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
       values ($1::uuid, 'ci-p013|viewer', 'P013 Viewer', 'viewer', true)`,
      [VIEWER_ID],
    );
    await client.query(
      `insert into ltc_m.clients (id, legal_name, display_name, created_by_user_id)
       values ($1::uuid, 'Cliente P013', 'Cliente P013', $2::uuid)`,
      [CLIENT_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.projects (
         id, project_code, project_name, client_id, status, base_currency,
         contract_value, data_reference_date, created_by_user_id
       ) values ($1::uuid, 'P013-LOCAL', 'Projeto P013', $2::uuid, 'active', 'BRL',
                 100, date '2026-07-01', $3::uuid)`,
      [PROJECT_ID, CLIENT_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.project_items (
         id, project_id, source_line_key, line_number, item_code, description,
         quantity, unit_code, currency_code, unit_price, created_by_user_id
       ) values ($1::uuid, $2::uuid, $3::text, 1, 'REPEATED', 'Item P013',
                 1, 'US', 'BRL', 100, $4::uuid)`,
      [ITEM_ID, PROJECT_ID, SOURCE_LINE_KEY, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.plan_versions (
         id, name, reference_date, status, is_baseline, created_by_user_id
       ) values
         ($1::uuid, 'P013 Baseline', date '2026-07-01', 'draft', true, $3::uuid),
         ($2::uuid, 'P013 Non Baseline', date '2026-07-01', 'draft', false, $3::uuid)`,
      [PLAN_ID, NON_BASELINE_PLAN_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.financial_plan_scopes (
         plan_version_id, project_id, metric_type, planning_level, currency_code,
         created_by_user_id
       ) values ($1::uuid, $2::uuid, 'billing_planned', 'item', 'BRL', $3::uuid)`,
      [PLAN_ID, PROJECT_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.import_batches (
         id, source_name, source_hash, source_size_bytes, source_mime_type,
         idempotency_key, status, received_rows, accepted_rows, submitted_by_user_id
       ) values ($1::uuid, 'p013.xlsx', $2::text, 100,
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         $3::text, 'loaded', 1, 1, $4::uuid)`,
      [BATCH_ID, ARTIFACT_SHA, `p013-baseline-v1:${'e'.repeat(64)}`, ADMIN_ID],
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
      [STAGING_ID, SHEET_ID, 'f'.repeat(64), ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.financial_plan_lines (
         id, plan_version_id, project_id, project_item_id, metric_type,
         planning_level, competence_month, amount, currency_code, created_by_user_id
       ) values
         ($1::uuid, $3::uuid, $4::uuid, $5::uuid, 'billing_planned', 'item',
          date '2026-07-01', 1.01, 'BRL', $6::uuid),
         ($2::uuid, $3::uuid, $4::uuid, $5::uuid, 'billing_planned', 'item',
          date '2026-08-01', 0.00, 'BRL', $6::uuid)`,
      [VALUE_LINE_ID, ZERO_LINE_ID, PLAN_ID, PROJECT_ID, ITEM_ID, ADMIN_ID],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function runtimeTransaction<T>(
  pool: Pool,
  userId: string,
  subject: string,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
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

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

async function assertRejectedCode(action: Promise<unknown>, codes: string[]): Promise<void> {
  await assert.rejects(action, (error: unknown) => codes.includes(errorCode(error) ?? ''));
}

async function insertFoundation(pool: Pool): Promise<void> {
  await runtimeTransaction(pool, ADMIN_ID, 'ci-p013|admin', async (client) => {
    await client.query(
      `insert into ltc_m.monthly_source_artifacts (
         id, source_sha256, source_size_bytes, source_mime_type, source_name,
         source_contract_version, worksheet_key, worksheet_name, structural_range,
         source_semantic_fingerprint, created_by_user_id
       ) values ($1::uuid, $2::text, 100,
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'p013.xlsx',
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
      [BASELINE_ID, PLAN_ID, BASELINE_SEMANTIC, ADMIN_ID],
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
        PLAN_ID,
        ADMIN_ID,
      ],
    );
    await client.query(
      `insert into ltc_m.monthly_plan_cells (
         id, import_batch_id, import_batch_sheet_id, import_staging_row_id,
         baseline_id, baseline_semantic_fingerprint, plan_version_id, project_id,
         project_item_id, metric_type, planning_level, competence_month,
         source_line_key, source_item_number, source_row_number, source_column,
         source_cell_reference, declaration_state, source_numeric_text,
         source_value_hash, canonical_amount, financial_plan_line_id, created_by_user_id
       ) values
         (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text,
          $6::uuid, $7::uuid, $8::uuid, 'billing_planned', 'item', date '2026-07-01',
          $9::text, '1', 4, 'K', 'K4', 'value', '1.005', $10::text, 1.01,
          $11::uuid, $12::uuid),
         (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text,
          $6::uuid, $7::uuid, $8::uuid, 'billing_planned', 'item', date '2026-08-01',
          $9::text, '1', 4, 'L', 'L4', 'explicit_zero', '0', $13::text, 0.00,
          $14::uuid, $12::uuid),
         (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text,
          $6::uuid, $7::uuid, $8::uuid, 'billing_planned', 'item', date '2026-09-01',
          $9::text, '1', 4, 'M', 'M4', 'blank', null, null, null, null, $12::uuid)`,
      [
        BATCH_ID,
        SHEET_ID,
        STAGING_ID,
        BASELINE_ID,
        BASELINE_SEMANTIC,
        PLAN_ID,
        PROJECT_ID,
        ITEM_ID,
        SOURCE_LINE_KEY,
        '1'.repeat(64),
        VALUE_LINE_ID,
        ADMIN_ID,
        '2'.repeat(64),
        ZERO_LINE_ID,
      ],
    );
  });
}

async function assertSchema(pool: Pool): Promise<void> {
  const tables = await pool.query(
    `select count(*)::integer as table_count
       from pg_catalog.pg_tables
      where schemaname = 'ltc_m'`,
  );
  assert.equal(tables.rows[0]?.['table_count'], 19);
  const security = await pool.query(
    `select count(*)::integer as secure_count
       from pg_catalog.pg_class
       join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = 'ltc_m'
        and pg_class.relname in (
          'monthly_source_artifacts', 'monthly_plan_baselines',
          'monthly_plan_import_executions', 'monthly_plan_cells'
        )
        and pg_class.relrowsecurity
        and pg_class.relforcerowsecurity`,
  );
  assert.equal(security.rows[0]?.['secure_count'], 4);
  const policies = await pool.query(
    `select count(*)::integer as policy_count
       from pg_catalog.pg_policy
       join pg_catalog.pg_class on pg_class.oid = pg_policy.polrelid
       join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = 'ltc_m'
        and pg_class.relname like 'monthly_%'`,
  );
  assert.equal(policies.rows[0]?.['policy_count'], 8);
  const grants = await pool.query(
    `select privilege_type
       from information_schema.role_table_grants
      where grantee = 'ltc_m_runtime'
        and table_schema = 'ltc_m'
        and table_name = 'monthly_plan_cells'
      order by privilege_type`,
  );
  assert.deepEqual(
    grants.rows.map((row) => row['privilege_type']),
    ['INSERT', 'SELECT'],
  );
  const role = await pool.query(
    `select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
       from pg_catalog.pg_roles where rolname = 'ltc_m_runtime'`,
  );
  assert.deepEqual(role.rows[0], {
    rolcanlogin: false,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false,
  });
}

test(
  'P013 D02 aplica do zero e prova provenance, idempotência, RLS e cleanup no PostgreSQL 17',
  { skip: !ENABLED },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl(), max: 6 });
    let membershipGranted = false;
    try {
      await rebuildFromZero(pool);
      await assertSchema(pool);
      await pool.query('grant ltc_m_runtime to postgres');
      membershipGranted = true;
      await setupFixtures(pool);
      await insertFoundation(pool);

      const provenance = await runtimeTransaction(pool, ADMIN_ID, 'ci-p013|admin', async (client) =>
        client.query(
          `select cells.declaration_state, cells.canonical_amount::text,
                    cells.source_cell_reference, cells.project_item_id,
                    executions.import_batch_id, artifacts.source_sha256,
                    baselines.semantic_fingerprint
               from ltc_m.monthly_plan_cells as cells
               join ltc_m.monthly_plan_import_executions as executions
                 on executions.import_batch_id = cells.import_batch_id
               join ltc_m.monthly_source_artifacts as artifacts
                 on artifacts.id = executions.source_artifact_id
               join ltc_m.monthly_plan_baselines as baselines
                 on baselines.id = cells.baseline_id
              order by cells.competence_month`,
        ),
      );
      assert.deepEqual(
        provenance.rows.map((row) => [row['declaration_state'], row['canonical_amount']]),
        [
          ['value', '1.01'],
          ['explicit_zero', '0.00'],
          ['blank', null],
        ],
      );
      assert.equal(provenance.rows[0]?.['source_cell_reference'], 'K4');
      assert.equal(provenance.rows[0]?.['project_item_id'], ITEM_ID);
      assert.equal(provenance.rows[0]?.['import_batch_id'], BATCH_ID);
      assert.equal(provenance.rows[0]?.['source_sha256'], ARTIFACT_SHA);
      assert.equal(provenance.rows[0]?.['semantic_fingerprint'], BASELINE_SEMANTIC);

      const hidden = await runtimeTransaction(pool, VIEWER_ID, 'ci-p013|viewer', async (client) =>
        client.query(`select id from ltc_m.monthly_source_artifacts`),
      );
      assert.equal(hidden.rowCount, 0);
      await assertRejectedCode(
        runtimeTransaction(pool, VIEWER_ID, 'ci-p013|viewer', (client) =>
          client.query(
            `insert into ltc_m.monthly_source_artifacts (
               source_sha256, source_size_bytes, source_mime_type, source_name,
               source_contract_version, worksheet_key, worksheet_name, structural_range,
               source_semantic_fingerprint, created_by_user_id
             ) values ($1::text, 1,
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'x.xlsx',
               'ltcm.p013.source-artifact.v1', 'monthly_revenue', 'Prev. Receita Mensal',
               'A1:T52', $2::text, $3::uuid)`,
            ['3'.repeat(64), SOURCE_SEMANTIC, VIEWER_ID],
          ),
        ),
        ['42501'],
      );

      await assertRejectedCode(
        runtimeTransaction(pool, ADMIN_ID, 'ci-p013|admin', (client) =>
          client.query(
            `insert into ltc_m.monthly_plan_baselines (
               plan_version_id, metric_type, planning_level, semantic_contract_version,
               semantic_fingerprint, created_by_user_id
             ) values ($1::uuid, 'billing_planned', 'item',
               'ltcm.p013.monthly-baseline-semantic.v1', $2::text, $3::uuid)`,
            [NON_BASELINE_PLAN_ID, '4'.repeat(64), ADMIN_ID],
          ),
        ),
        ['42501'],
      );
      await assertRejectedCode(
        runtimeTransaction(pool, ADMIN_ID, 'ci-p013|admin', (client) =>
          client.query(
            `insert into ltc_m.monthly_plan_baselines (
               plan_version_id, metric_type, planning_level, semantic_contract_version,
               semantic_fingerprint, created_by_user_id
             ) values ($1::uuid, 'billing_planned', 'item',
               'ltcm.p013.monthly-baseline-semantic.v1', $2::text, $3::uuid)`,
            [PLAN_ID, '5'.repeat(64), ADMIN_ID],
          ),
        ),
        ['23505'],
      );
      await assertRejectedCode(
        runtimeTransaction(pool, ADMIN_ID, 'ci-p013|admin', (client) =>
          client.query(
            `insert into ltc_m.monthly_plan_cells (
               import_batch_id, import_batch_sheet_id, import_staging_row_id,
               baseline_id, baseline_semantic_fingerprint, plan_version_id, project_id,
               project_item_id, metric_type, planning_level, competence_month,
               source_line_key, source_item_number, source_row_number, source_column,
               source_cell_reference, declaration_state, created_by_user_id
             ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::uuid,
               $7::uuid, $8::uuid, 'billing_planned', 'item', date '2026-10-01',
               $9::text, '1', 4, 'N', 'N4', 'blank', $10::uuid)`,
            [
              BATCH_ID,
              SHEET_ID,
              STAGING_ID,
              BASELINE_ID,
              BASELINE_SEMANTIC,
              PLAN_ID,
              PROJECT_ID,
              '00000000-0000-4000-8000-000000019999',
              SOURCE_LINE_KEY,
              ADMIN_ID,
            ],
          ),
        ),
        ['23503'],
      );
      await assertRejectedCode(
        runtimeTransaction(pool, ADMIN_ID, 'ci-p013|admin', (client) =>
          client.query(
            `insert into ltc_m.monthly_plan_cells (
               import_batch_id, import_batch_sheet_id, import_staging_row_id,
               baseline_id, baseline_semantic_fingerprint, plan_version_id, project_id,
               project_item_id, metric_type, planning_level, competence_month,
               source_line_key, source_item_number, source_row_number, source_column,
               source_cell_reference, declaration_state, created_by_user_id
             ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::uuid,
               $7::uuid, $8::uuid, 'billing_planned', 'project', date '2026-10-01',
               $9::text, '1', 4, 'N', 'N4', 'blank', $10::uuid)`,
            [
              BATCH_ID,
              SHEET_ID,
              STAGING_ID,
              BASELINE_ID,
              BASELINE_SEMANTIC,
              PLAN_ID,
              PROJECT_ID,
              ITEM_ID,
              SOURCE_LINE_KEY,
              ADMIN_ID,
            ],
          ),
        ),
        ['23503', '23514'],
      );

      const secondArtifact = '00000000-0000-4000-8000-000000013016';
      await runtimeTransaction(pool, ADMIN_ID, 'ci-p013|admin', async (client) => {
        await client.query(
          `insert into ltc_m.monthly_source_artifacts (
             id, source_sha256, source_size_bytes, source_mime_type, source_name,
             source_contract_version, worksheet_key, worksheet_name, structural_range,
             source_semantic_fingerprint, created_by_user_id
           ) values ($1::uuid, $2::text, 101,
             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'equivalent.xlsx',
             'ltcm.p013.source-artifact.v1', 'monthly_revenue', 'Prev. Receita Mensal',
             'A1:T52', $3::text, $4::uuid)`,
          [secondArtifact, '6'.repeat(64), SOURCE_SEMANTIC, ADMIN_ID],
        );
      });
      const equivalent = await pool.query(
        `select count(*)::integer as artifact_count,
                count(distinct source_semantic_fingerprint)::integer as semantic_count
           from ltc_m.monthly_source_artifacts`,
      );
      assert.deepEqual(equivalent.rows[0], { artifact_count: 2, semantic_count: 1 });

      const lostReceipt = await pool.query(
        `select batches.status, executions.id, executions.baseline_semantic_fingerprint
           from ltc_m.import_batches as batches
           join ltc_m.monthly_plan_import_executions as executions
             on executions.import_batch_id = batches.id
          where batches.idempotency_key = $1::text`,
        [`p013-baseline-v1:${'e'.repeat(64)}`],
      );
      assert.equal(lostReceipt.rowCount, 1);
      assert.equal(lostReceipt.rows[0]?.['status'], 'loaded');
      assert.equal(lostReceipt.rows[0]?.['id'], EXECUTION_ID);

      const concurrentBatch = '00000000-0000-4000-8000-000000013017';
      const concurrentArtifact = '00000000-0000-4000-8000-000000013018';
      const concurrentSha = '7'.repeat(64);
      await runtimeTransaction(pool, ADMIN_ID, 'ci-p013|admin', async (client) => {
        await client.query(
          `insert into ltc_m.import_batches (
             id, source_name, source_hash, source_size_bytes, source_mime_type,
             idempotency_key, status, received_rows, accepted_rows, submitted_by_user_id
           ) values ($1::uuid, 'concurrent.xlsx', $2::text, 102,
             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
             $3::text, 'loaded', 1, 1, $4::uuid)`,
          [concurrentBatch, concurrentSha, `p013-baseline-v1:${'9'.repeat(64)}`, ADMIN_ID],
        );
        await client.query(
          `insert into ltc_m.monthly_source_artifacts (
             id, source_sha256, source_size_bytes, source_mime_type, source_name,
             source_contract_version, worksheet_key, worksheet_name, structural_range,
             source_semantic_fingerprint, created_by_user_id
           ) values ($1::uuid, $2::text, 102,
             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'concurrent.xlsx',
             'ltcm.p013.source-artifact.v1', 'monthly_revenue', 'Prev. Receita Mensal',
             'A1:T52', $3::text, $4::uuid)`,
          [concurrentArtifact, concurrentSha, SOURCE_SEMANTIC, ADMIN_ID],
        );
      });
      const insertConcurrentExecution = () =>
        runtimeTransaction(pool, ADMIN_ID, 'ci-p013|admin', (client) =>
          client.query(
            `insert into ltc_m.monthly_plan_import_executions (
               id, import_batch_id, source_artifact_id, source_sha256, baseline_id,
               baseline_semantic_fingerprint, plan_version_id, metric_type, planning_level,
               created_by_user_id
             ) values (gen_random_uuid(), $1::uuid, $2::uuid, $3::text, $4::uuid,
               $5::text, $6::uuid, 'billing_planned', 'item', $7::uuid)`,
            [
              concurrentBatch,
              concurrentArtifact,
              concurrentSha,
              BASELINE_ID,
              BASELINE_SEMANTIC,
              PLAN_ID,
              ADMIN_ID,
            ],
          ),
        );
      const concurrency = await Promise.allSettled([
        insertConcurrentExecution(),
        insertConcurrentExecution(),
      ]);
      assert.equal(concurrency.filter(({ status }) => status === 'fulfilled').length, 1);
      const rejected = concurrency.find(({ status }) => status === 'rejected');
      assert.equal(rejected?.status, 'rejected');
      if (rejected?.status === 'rejected') assert.equal(errorCode(rejected.reason), '23505');
    } finally {
      if (membershipGranted) {
        await pool.query('revoke ltc_m_runtime from postgres');
      }
      await rebuildFromZero(pool);
      const cleanup = await pool.query(
        `select
           (select count(*) from ltc_m.monthly_source_artifacts)::integer as artifacts,
           (select count(*) from ltc_m.monthly_plan_import_executions)::integer as executions,
           (select count(*) from ltc_m.monthly_plan_baselines)::integer as baselines,
           (select count(*) from ltc_m.monthly_plan_cells)::integer as cells,
           (select count(*) from ltc_m.financial_plan_lines)::integer as financial_lines,
           (select count(*) from ltc_m.projects)::integer as projects,
           (select count(*) from ltc_m.project_items)::integer as items,
           (select count(*) from ltc_m.import_batches)::integer as batches`,
      );
      assert.deepEqual(cleanup.rows[0], {
        artifacts: 0,
        executions: 0,
        baselines: 0,
        cells: 0,
        financial_lines: 0,
        projects: 0,
        items: 0,
        batches: 0,
      });
      const locks = await pool.query(
        `select count(*)::integer as lock_count
           from pg_catalog.pg_locks
          where locktype = 'advisory'
            and database = (
              select oid from pg_catalog.pg_database where datname = current_database()
            )`,
      );
      assert.equal(locks.rows[0]?.['lock_count'], 0);
      assert.equal(pool.waitingCount, 0);
      await pool.end();
      assert.equal(pool.totalCount, 0);
    }
  },
);
