import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import { DatabasePool } from '../apps/api/dist/src/database/database-pool.js';
import { PlanningService } from '../apps/api/dist/src/planning/planning.service.js';
import { withActorTransaction } from '../apps/api/dist/src/database/transaction.js';

const ENABLED = process.env.LTCM_P030_INTEGRATION === '1';
const DATABASE_URL = process.env.LTCM_P012_TEST_DATABASE_URL;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_ID = '00000000-0000-4000-8000-000000030101';
const ADMIN_SUBJECT = 'ci-p030|admin';
const CLIENT_ID = '00000000-0000-4000-8000-000000030102';
const PROJECT_ID = '00000000-0000-4000-8000-000000030103';
const ITEM_ID = '00000000-0000-4000-8000-000000030104';
const VERSION_ID = '00000000-0000-4000-8000-000000030105';
const LINE_ID = '00000000-0000-4000-8000-000000030106';
const ACTUAL_ID = '00000000-0000-4000-8000-000000030107';
const ADMIN_BOOTSTRAP_MIGRATION = '20260731103000_add_ltcm_audit_read_event.sql';

function databaseUrl() {
  if (!DATABASE_URL) throw new Error('P030_POSTGRES_ENV_MISSING');
  const parsed = new URL(DATABASE_URL);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase()) ||
    parsed.pathname !== (process.env.CI ? '/ltcm_ci' : '/ltcm_test') ||
    parsed.search ||
    parsed.hash
  )
    throw new Error('P030_POSTGRES_ENV_INVALID');
  return DATABASE_URL;
}

async function migrations() {
  const directory = path.join(ROOT, 'supabase', 'migrations');
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'));
  return Promise.all(
    names.map(async (name) => ({ name, sql: await readFile(path.join(directory, name), 'utf8') })),
  );
}

async function installAdmin(client) {
  await client.query(
    `select ltc_m.set_actor_context(null, null, 'p030-bootstrap', null, 'system', false)`,
  );
  await client.query(
    `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
     values ($1::uuid, $2::text, 'P030 Synthetic Admin', 'admin', true)`,
    [ADMIN_ID, ADMIN_SUBJECT],
  );
}

async function rebuildFromZero(pool) {
  const client = await pool.connect();
  try {
    await client.query('drop schema if exists ltc_m cascade');
    for (const migration of await migrations()) {
      await client.query(migration.sql);
      if (migration.name === ADMIN_BOOTSTRAP_MIGRATION) await installAdmin(client);
    }
  } finally {
    client.release();
  }
}

async function setupFixtures(pool) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `select ltc_m.set_actor_context($1::uuid, $2::text, 'p030-fixture', null, 'system', false)`,
      [ADMIN_ID, ADMIN_SUBJECT],
    );
    await client.query(`insert into ltc_m.currencies (code, name) values ('BRL', 'Real')`);
    await client.query(`insert into ltc_m.units (code, name) values ('US', 'Unidade P030')`);
    await client.query(
      `insert into ltc_m.clients (id, legal_name, display_name, created_by_user_id)
       values ($1::uuid, 'Cliente P030', 'Cliente P030', $2::uuid)`,
      [CLIENT_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.projects (
         id, project_code, project_name, client_id, status, base_currency,
         contract_value, data_reference_date, created_by_user_id
       ) values ($1::uuid, 'P030-LOCAL', 'Projeto P030', $2::uuid, 'active', 'BRL',
         1000.00, date '2026-12-01', $3::uuid)`,
      [PROJECT_ID, CLIENT_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.project_items (
         id, project_id, source_line_key, line_number, item_code, description,
         quantity, unit_code, currency_code, unit_price, created_by_user_id
       ) values ($1::uuid, $2::uuid, 'p030-item', 1, 'A', 'Item A', 1, 'US', 'BRL', 1, $3::uuid)`,
      [ITEM_ID, PROJECT_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.plan_versions (id, name, reference_date, status, created_by_user_id)
       values ($1::uuid, 'P030 Draft', date '2026-12-01', 'draft', $2::uuid)`,
      [VERSION_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.financial_plan_scopes (
         plan_version_id, project_id, metric_type, planning_level, currency_code,
         created_by_user_id
       ) values ($1::uuid, $2::uuid, 'billing_planned', 'item', 'BRL', $3::uuid)`,
      [VERSION_ID, PROJECT_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.financial_plan_lines (
         id, plan_version_id, project_id, project_item_id, metric_type,
         planning_level, competence_month, amount, currency_code, created_by_user_id
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'billing_planned',
         'item', date '2026-12-01', 300.00, 'BRL', $5::uuid)`,
      [LINE_ID, VERSION_ID, PROJECT_ID, ITEM_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.financial_actual_events (
         id, project_id, project_item_id, metric_type, competence_date, source_key,
         amount, currency_code, status, created_by_user_id
       ) values ($1::uuid, $2::uuid, $3::uuid, 'billing_actual', date '2026-12-01',
         'p030-synthetic-actual', 200.00, 'BRL', 'posted', $4::uuid)`,
      [ACTUAL_ID, PROJECT_ID, ITEM_ID, ADMIN_ID],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

test(
  'P030 PostgreSQL deriva saldo, bloqueia excesso atomicamente e permite override admin',
  { skip: !ENABLED },
  async () => {
    const admin = new Pool({ connectionString: databaseUrl(), max: 1 });
    let databasePool;
    try {
      await rebuildFromZero(admin);
      await setupFixtures(admin);
      databasePool = new DatabasePool(new Pool({ connectionString: databaseUrl(), max: 2 }));
      const database = {
        actorTransaction: (context, operation) =>
          withActorTransaction(databasePool, context, async (client) => {
            await client.query('set local role ltc_m_runtime');
            return operation(client);
          }),
      };
      const service = new PlanningService(database);
      const actor = {
        appUserId: ADMIN_ID,
        authSubject: ADMIN_SUBJECT,
        requestId: 'p030-integration-save',
        source: 'api',
      };
      const initial = await service.editor(PROJECT_ID, { versionId: VERSION_ID }, actor);
      assert.equal(initial.financial.actualPosted, '200.00');
      assert.equal(initial.financial.plannedDraft, '300.00');
      assert.equal(initial.financial.rawBalance, '500.00');
      assert.equal(initial.financial.distributableBalance, '500.00');
      const protectedBefore = await admin.query(
        `select
           (select amount::text from ltc_m.financial_actual_events where id = $1::uuid) as actual,
           (select count(*)::integer from ltc_m.monthly_plan_cells where project_id = $2::uuid) as baseline_cells`,
        [ACTUAL_ID, PROJECT_ID],
      );

      const payload = {
        expectedVersion: 1,
        justification: 'P030 excesso sem override',
        entries: [{ itemId: ITEM_ID, competence: '2026-12-01', amount: '900.00' }],
      };
      await assert.rejects(
        service.save(PROJECT_ID, VERSION_ID, payload, actor, false),
        /P030_BALANCE_OVERRIDE_REQUIRED/u,
      );
      const unchanged = await admin.query(
        `select amount::text, content_revision::integer
           from ltc_m.financial_plan_lines lines
           cross join ltc_m.plan_versions versions
          where lines.id = $1::uuid and versions.id = $2::uuid`,
        [LINE_ID, VERSION_ID],
      );
      assert.deepEqual(unchanged.rows[0], { amount: '300.00', content_revision: 1 });

      const saved = await service.save(PROJECT_ID, VERSION_ID, payload, actor, true);
      assert.equal(saved.financial.rawBalance, '-100.00');
      assert.equal(saved.financial.distributableBalance, '0.00');
      assert.equal(saved.financial.hasExcess, true);
      assert.equal(saved.financial.canOverrideBalance, true);
      const protectedAfter = await admin.query(
        `select
           (select amount::text from ltc_m.financial_actual_events where id = $1::uuid) as actual,
           (select count(*)::integer from ltc_m.monthly_plan_cells where project_id = $2::uuid) as baseline_cells`,
        [ACTUAL_ID, PROJECT_ID],
      );
      assert.deepEqual(protectedAfter.rows[0], protectedBefore.rows[0]);
      const audit = await admin.query(
        `select count(*)::integer as count
           from ltc_m.audit_log
          where request_id = $1::text and justification = $2::text`,
        [actor.requestId, payload.justification],
      );
      assert.ok(audit.rows[0].count >= 1);
      await assert.rejects(
        service.save(
          PROJECT_ID,
          VERSION_ID,
          { ...payload, expectedVersion: 1, justification: 'P030 stale' },
          actor,
          true,
        ),
        /P029_VERSION_CONFLICT/u,
      );
    } finally {
      try {
        await databasePool?.close();
      } finally {
        try {
          await rebuildFromZero(admin);
        } finally {
          await admin.end();
        }
      }
    }
  },
);
