import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import { createSnapshot } from './generate-p017-schema-docs.mjs';
import { collectSchemaModel } from './p017-schema-model.mjs';

const ENABLED = process.env.LTCM_P017_INTEGRATION === '1';
const ISOLATED = process.env.LTCM_P017_ISOLATED_CLUSTER === '1';
const DATABASE_URL = process.env.LTCM_P017_DATABASE_URL;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SNAPSHOT_PATH = path.join(ROOT, 'docs', 'database', 'p017-schema-model.json');
const MIGRATION_COUNT = 14;
const P021_POLICY_NAMES = new Set([
  'plan_versions_select',
  'financial_plan_scopes_select',
  'financial_plan_lines_select',
  'monthly_source_artifacts_select_p013',
  'monthly_plan_baselines_select_p013',
  'monthly_executions_select_p013',
  'monthly_plan_cells_select_p013',
]);

function projectP017Baseline(model, baseline) {
  const baselineFunctions = new Map(
    baseline.functions.map((routine) => [
      `${routine.schema}.${routine.name}.${routine.identityArguments}`,
      routine,
    ]),
  );
  return {
    ...model,
    functions: model.functions
      .filter(
        (routine) =>
          !(
            routine.schema === 'ltc_m' &&
            [
              'resolve_authorization',
              'return_plan_version_to_draft_as_approver',
              'approve_plan_version_as_approver',
            ].includes(routine.name)
          ),
      )
      .map((routine) => {
        const key = `${routine.schema}.${routine.name}.${routine.identityArguments}`;
        return baselineFunctions.get(key) ?? routine;
      }),
    policies: model.policies.map((policy) =>
      policy.schema === 'ltc_m' && P021_POLICY_NAMES.has(policy.name)
        ? (baseline.policies.find(
            (expected) => expected.schema === policy.schema && expected.name === policy.name,
          ) ?? policy)
        : policy,
    ),
    grants: model.grants.filter(
      (grant) => !(grant.schema === 'ltc_m' && grant.object === 'resolve_authorization'),
    ),
    types: model.types,
  };
}

const ADMIN_ID = '00000000-0000-4000-8000-000000017001';
const VIEWER_ID = '00000000-0000-4000-8000-000000017002';
const CLIENT_ID = '00000000-0000-4000-8000-000000017003';
const PROJECT_ID = '00000000-0000-4000-8000-000000017010';
const ITEM_A_ID = '00000000-0000-4000-8000-000000017011';
const ITEM_B_ID = '00000000-0000-4000-8000-000000017012';
const PLAN_ID = '00000000-0000-4000-8000-000000017020';
const SCOPE_ID = '00000000-0000-4000-8000-000000017021';
const LINE_ID = '00000000-0000-4000-8000-000000017022';
const ACTUAL_ID = '00000000-0000-4000-8000-000000017023';
const BATCH_ID = '00000000-0000-4000-8000-000000017030';
const SOURCE_HASH = '17'.repeat(32);

function isolatedDatabaseUrl() {
  if (!ENABLED) return undefined;
  if (!ISOLATED || !DATABASE_URL) throw new Error('P017_POSTGRES_ENV_MISSING');
  let parsed;
  try {
    parsed = new URL(DATABASE_URL);
  } catch {
    throw new Error('P017_POSTGRES_ENV_INVALID');
  }
  const port = Number(parsed.port);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase()) ||
    parsed.pathname !== '/ltcm_test' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    !Number.isSafeInteger(port) ||
    port < 1024 ||
    port > 65535
  ) {
    throw new Error('P017_POSTGRES_ENV_INVALID');
  }
  return DATABASE_URL;
}

async function migrationInventory() {
  const directory = path.join(ROOT, 'supabase', 'migrations');
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'));
  assert.equal(names.length, MIGRATION_COUNT);
  assert.equal(new Set(names.map((name) => name.slice(0, 14))).size, names.length);
  return Promise.all(
    names.map(async (name) => ({ name, sql: await readFile(path.join(directory, name), 'utf8') })),
  );
}

async function assertEnvironment(client) {
  const result = await client.query(
    `select current_database() as database_name,
            current_user,
            current_setting('server_version_num') as server_version_num,
            rolsuper,
            rolbypassrls
       from pg_catalog.pg_roles
      where rolname = current_user`,
  );
  assert.equal(result.rows[0]?.database_name, 'ltcm_test');
  assert.equal(result.rows[0]?.current_user, 'postgres');
  assert.match(String(result.rows[0]?.server_version_num), /^17/u);
  assert.equal(result.rows[0]?.rolsuper, true);
  assert.equal(result.rows[0]?.rolbypassrls, true);
}

async function setActor(client, id, subject, request = 'p017-integrity') {
  await client.query(
    `select ltc_m.set_actor_context($1::uuid, $2::text, $3::text, null, 'system', false)`,
    [id, subject, request],
  );
}

async function installAdmin(client) {
  await client.query('begin');
  try {
    await client.query(
      `select ltc_m.set_actor_context(null, null, 'p017-bootstrap', null, 'system', false)`,
    );
    await client.query(
      `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
       values ($1::uuid, 'ci-p017|admin', 'P017 Bootstrap Admin', 'admin', true)`,
      [ADMIN_ID],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}

async function rebuildFromZero(pool) {
  const client = await pool.connect();
  let currentMigration = 'preflight';
  try {
    await assertEnvironment(client);
    await client.query('drop schema if exists ltc_m cascade');
    for (const migration of await migrationInventory()) {
      currentMigration = migration.name;
      await client.query(migration.sql);
      if (migration.name === '20260731103000_add_ltcm_audit_read_event.sql') {
        await installAdmin(client);
      }
    }
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw new Error(`P017_MIGRATION_FROM_ZERO_FAILED:${currentMigration}`, { cause: error });
  } finally {
    client.release();
  }
}

async function applySeed(pool) {
  await pool.query(await readFile(path.join(ROOT, 'supabase', 'seed.sql'), 'utf8'));
}

async function installFixture(pool) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await setActor(client, ADMIN_ID, 'ci-p017|admin');
    await client.query(
      `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
       select $1::uuid, 'ci-p017|viewer', 'P017 Viewer', 'viewer', true
        where not exists (select 1 from ltc_m.app_users where id = $1::uuid)`,
      [VIEWER_ID],
    );
    await client.query(
      `insert into ltc_m.clients (id, legal_name, display_name, created_by_user_id)
       select $1::uuid, 'P017 Synthetic Client', 'P017 Synthetic Client', $2::uuid
        where not exists (select 1 from ltc_m.clients where id = $1::uuid)`,
      [CLIENT_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.projects (
         id, project_code, project_name, client_id, status, base_currency,
         contract_value, data_reference_date, created_by_user_id
       )
       select $1::uuid, 'P017-PROJECT', 'P017 Synthetic Project', $2::uuid, 'active',
              'BRL', 1234567890123456.78, date '2026-08-01', $3::uuid
        where not exists (select 1 from ltc_m.projects where id = $1::uuid)`,
      [PROJECT_ID, CLIENT_ID, ADMIN_ID],
    );
    for (const [id, sourceKey, lineNumber] of [
      [ITEM_A_ID, `p012-item-v1:${'a'.repeat(64)}`, 1],
      [ITEM_B_ID, `p012-item-v1:${'b'.repeat(64)}`, 2],
    ]) {
      await client.query(
        `insert into ltc_m.project_items (
           id, project_id, source_line_key, line_number, item_code, description,
           quantity, unit_code, currency_code, unit_price, created_by_user_id
         )
         select $1::uuid, $2::uuid, $3::text, $4::integer, 'REPEATED', 'P017 item',
                1.0000, 'US', 'BRL', 0.0050, $5::uuid
          where not exists (select 1 from ltc_m.project_items where id = $1::uuid)`,
        [id, PROJECT_ID, sourceKey, lineNumber, ADMIN_ID],
      );
    }
    await client.query(
      `insert into ltc_m.plan_versions (id, name, reference_date, created_by_user_id)
       select $1::uuid, 'P017 deterministic plan', date '2026-08-01', $2::uuid
        where not exists (select 1 from ltc_m.plan_versions where id = $1::uuid)`,
      [PLAN_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.financial_plan_scopes (
         id, plan_version_id, project_id, metric_type, planning_level,
         currency_code, created_by_user_id
       )
       select $1::uuid, $2::uuid, $3::uuid, 'billing_planned', 'project', 'BRL', $4::uuid
        where not exists (select 1 from ltc_m.financial_plan_scopes where id = $1::uuid)`,
      [SCOPE_ID, PLAN_ID, PROJECT_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.financial_plan_lines (
         id, plan_version_id, project_id, metric_type, planning_level,
         competence_month, amount, currency_code, created_by_user_id
       )
       select $1::uuid, $2::uuid, $3::uuid, 'billing_planned', 'project',
              date '2026-08-01', 1234567890123456.78, 'BRL', $4::uuid
        where not exists (select 1 from ltc_m.financial_plan_lines where id = $1::uuid)`,
      [LINE_ID, PLAN_ID, PROJECT_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.financial_actual_events (
         id, project_id, metric_type, competence_date, source_key,
         amount, currency_code, status, created_by_user_id
       )
       select $1::uuid, $2::uuid, 'billing_actual', date '2026-08-01',
              'p017-synthetic-actual', 0.01, 'BRL', 'posted', $3::uuid
        where not exists (select 1 from ltc_m.financial_actual_events where id = $1::uuid)`,
      [ACTUAL_ID, PROJECT_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.import_batches (
         id, source_name, source_hash, idempotency_key, submitted_by_user_id
       )
       select $1::uuid, 'p017-synthetic.xlsx', $2::text, 'p017-rerun-v1', $3::uuid
        where not exists (select 1 from ltc_m.import_batches where id = $1::uuid)`,
      [BATCH_ID, SOURCE_HASH, ADMIN_ID],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function businessState(pool) {
  const result = await pool.query(
    `select
       (select count(*) from ltc_m.currencies)::integer as currencies,
       (select count(*) from ltc_m.units)::integer as units,
       (select count(*) from ltc_m.clients)::integer as clients,
       (select count(*) from ltc_m.projects)::integer as projects,
       (select count(*) from ltc_m.project_items)::integer as items,
       (select count(*) from ltc_m.plan_versions)::integer as plans,
       (select count(*) from ltc_m.financial_plan_scopes)::integer as scopes,
       (select count(*) from ltc_m.financial_plan_lines)::integer as lines,
       (select count(*) from ltc_m.financial_actual_events)::integer as actuals,
       (select count(*) from ltc_m.import_batches)::integer as batches,
       (select sum(amount)::text from ltc_m.financial_plan_lines) as planned_total,
       (select sum(amount)::text from ltc_m.financial_actual_events) as actual_total`,
  );
  return result.rows[0];
}

async function assertNoLogicalDuplicates(pool) {
  const result = await pool.query(
    `select
       (select count(*) from (select upper(project_code) from ltc_m.projects where deleted_at is null group by 1 having count(*) > 1) d)::integer as projects,
       (select count(*) from (select project_id, source_line_key from ltc_m.project_items where deleted_at is null group by 1, 2 having count(*) > 1) d)::integer as items,
       (select count(*) from (select name from ltc_m.plan_versions group by 1 having count(*) > 1) d)::integer as plans,
       (select count(*) from (select plan_version_id, project_id, metric_type from ltc_m.financial_plan_scopes group by 1, 2, 3 having count(*) > 1) d)::integer as scopes,
       (select count(*) from (select plan_version_id, project_id, metric_type, competence_month from ltc_m.financial_plan_lines where planning_level = 'project' group by 1, 2, 3, 4 having count(*) > 1) d)::integer as lines,
       (select count(*) from (select project_id, source_key from ltc_m.financial_actual_events group by 1, 2 having count(*) > 1) d)::integer as actuals,
       (select count(*) from (select idempotency_key from ltc_m.import_batches where idempotency_key is not null group by 1 having count(*) > 1) d)::integer as batches`,
  );
  assert.deepEqual(result.rows[0], {
    projects: 0,
    items: 0,
    plans: 0,
    scopes: 0,
    lines: 0,
    actuals: 0,
    batches: 0,
  });
  const repeatedCode = await pool.query(
    `select count(*)::integer as item_count, count(distinct source_line_key)::integer as identities
       from ltc_m.project_items
      where project_id = $1::uuid and item_code = 'REPEATED'`,
    [PROJECT_ID],
  );
  assert.deepEqual(repeatedCode.rows[0], { item_count: 2, identities: 2 });
}

async function expectIntegrityError(pool, sql, params, sqlState) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await setActor(client, ADMIN_ID, 'ci-p017|admin', `p017-${sqlState}`);
    await assert.rejects(client.query(sql, params), (error) => error?.code === sqlState);
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
}

async function assertRepresentativeIntegrity(pool) {
  await expectIntegrityError(
    pool,
    `insert into ltc_m.projects (
       project_code, project_name, client_id, base_currency, contract_value,
       data_reference_date, created_by_user_id
     ) values ('P017-BAD-FK', 'Bad FK', $1::uuid, 'BRL', 1, date '2026-08-01', $2::uuid)`,
    ['00000000-0000-4000-8000-000000017999', ADMIN_ID],
    '23503',
  );
  await expectIntegrityError(
    pool,
    `insert into ltc_m.projects (
       project_code, project_name, client_id, base_currency, contract_value,
       data_reference_date, created_by_user_id
     ) values ('P017-BAD-CHECK', 'Bad check', $1::uuid, 'BRL', -0.01, date '2026-08-01', $2::uuid)`,
    [CLIENT_ID, ADMIN_ID],
    '23514',
  );
  await expectIntegrityError(
    pool,
    `insert into ltc_m.projects (
       project_code, project_name, client_id, base_currency, contract_value,
       data_reference_date, created_by_user_id
     ) values ('p017-project', 'Duplicate', $1::uuid, 'BRL', 1, date '2026-08-01', $2::uuid)`,
    [CLIENT_ID, ADMIN_ID],
    '23505',
  );
}

async function runtimeRead(pool, actorId, subject, callback) {
  const client = await pool.connect();
  try {
    await client.query('begin transaction read only');
    if (actorId) await setActor(client, actorId, subject);
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

async function assertSecurityAndViews(pool, snapshot) {
  const runtime = await pool.query(
    `select rolsuper, rolbypassrls from pg_catalog.pg_roles where rolname = 'ltc_m_runtime'`,
  );
  assert.deepEqual(runtime.rows[0], { rolsuper: false, rolbypassrls: false });
  const protectedTables = snapshot.model.relations.filter(
    (relation) => relation.kind === 'table' && relation.rowSecurity && relation.forceRowSecurity,
  );
  assert.equal(protectedTables.length, 19);
  assert.equal(snapshot.model.policies.length, 49);
  const views = snapshot.model.relations.filter((relation) => relation.kind === 'view');
  assert.equal(views.length, 9);
  for (const view of views) {
    assert.ok(view.options.includes('security_invoker=true'));
    assert.ok(view.options.includes('security_barrier=true'));
    assert.ok(
      snapshot.model.grants.some(
        (grant) =>
          grant.object === view.name &&
          grant.grantee === 'ltc_m_runtime' &&
          grant.privilege === 'SELECT',
      ),
    );
    assert.equal(
      snapshot.model.grants.some(
        (grant) => grant.object === view.name && grant.grantee === 'PUBLIC',
      ),
      false,
    );
  }

  await pool.query('grant ltc_m_runtime to postgres');
  try {
    const adminVisible = await runtimeRead(pool, ADMIN_ID, 'ci-p017|admin', async (client) =>
      client.query(`select count(*)::integer as count from ltc_m.v_tableau_project_overview`),
    );
    assert.equal(adminVisible.rows[0]?.count, 1);
    const viewerVisible = await runtimeRead(pool, VIEWER_ID, 'ci-p017|viewer', async (client) =>
      client.query(`select project_code from ltc_m.v_tableau_project_overview`),
    );
    assert.deepEqual(viewerVisible.rows, [{ project_code: 'P017-PROJECT' }]);
    const missingActor = await runtimeRead(pool, null, null, (client) =>
      client.query(`select count(*)::integer as count from ltc_m.v_tableau_project_overview`),
    );
    assert.equal(missingActor.rows[0]?.count, 0);
    await assert.rejects(
      runtimeRead(pool, '00000000-0000-4000-8000-000000017998', 'ci-p017|invalid', (client) =>
        client.query(`select count(*) from ltc_m.v_tableau_project_overview`),
      ),
      (error) => error?.code === 'P0001',
    );
    const before = await businessState(pool);
    await runtimeRead(pool, ADMIN_ID, 'ci-p017|admin', async (client) => {
      for (const view of views) await client.query(`select count(*) from ltc_m.${view.name}`);
    });
    assert.deepEqual(await businessState(pool), before);
  } finally {
    await pool.query('revoke ltc_m_runtime from postgres');
  }
}

async function executePass(pool, expectedSnapshot) {
  await rebuildFromZero(pool);
  const initialSnapshot = createSnapshot(
    projectP017Baseline(await collectSchemaModel(pool), expectedSnapshot.model),
    MIGRATION_COUNT,
  );
  assert.deepEqual(initialSnapshot, expectedSnapshot);
  await applySeed(pool);
  await applySeed(pool);
  await installFixture(pool);
  const firstState = await businessState(pool);
  await installFixture(pool);
  const secondState = await businessState(pool);
  assert.deepEqual(secondState, firstState);
  assert.deepEqual(secondState, {
    currencies: 1,
    units: 1,
    clients: 1,
    projects: 1,
    items: 2,
    plans: 1,
    scopes: 1,
    lines: 1,
    actuals: 1,
    batches: 1,
    planned_total: '1234567890123456.78',
    actual_total: '0.01',
  });
  await assertNoLogicalDuplicates(pool);
  await assertRepresentativeIntegrity(pool);
  await assertSecurityAndViews(pool, expectedSnapshot);
  const finalSnapshot = createSnapshot(
    projectP017Baseline(await collectSchemaModel(pool), expectedSnapshot.model),
    MIGRATION_COUNT,
  );
  assert.deepEqual(finalSnapshot, expectedSnapshot);
  return secondState;
}

test(
  'P017 reproduz PostgreSQL 17, compara fingerprint e repete pipeline sem drift ou duplicidade',
  { skip: !ENABLED },
  async () => {
    const pool = new Pool({ connectionString: isolatedDatabaseUrl(), max: 4 });
    const expectedSnapshot = JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8'));
    try {
      const firstPass = await executePass(pool, expectedSnapshot);
      const secondPass = await executePass(pool, expectedSnapshot);
      assert.deepEqual(secondPass, firstPass);
    } finally {
      await pool.query('revoke ltc_m_runtime from postgres').catch(() => undefined);
      await rebuildFromZero(pool);
      const cleanup = await pool.query(
        `select
           (select count(*) from ltc_m.projects)::integer as projects,
           (select count(*) from ltc_m.project_items)::integer as items,
           (select count(*) from ltc_m.financial_plan_lines)::integer as lines,
           (select count(*) from ltc_m.financial_actual_events)::integer as actuals,
           (select count(*) from ltc_m.import_batches)::integer as batches`,
      );
      assert.deepEqual(cleanup.rows[0], {
        projects: 0,
        items: 0,
        lines: 0,
        actuals: 0,
        batches: 0,
      });
      const locks = await pool.query(
        `select count(*)::integer as count
           from pg_catalog.pg_locks
          where locktype = 'advisory'
            and database = (select oid from pg_catalog.pg_database where datname = current_database())`,
      );
      assert.equal(locks.rows[0]?.count, 0);
      assert.equal(pool.waitingCount, 0);
      await pool.end();
      assert.equal(pool.totalCount, 0);
    }
  },
);
