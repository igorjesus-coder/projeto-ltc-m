import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import { PlanningService } from '../apps/api/dist/src/planning/planning.service.js';
import { DatabasePool } from '../apps/api/dist/src/database/database-pool.js';
import {
  setActorContext,
  withActorTransaction,
} from '../apps/api/dist/src/database/transaction.js';

const ENABLED = process.env.LTCM_P029_INTEGRATION === '1';
const DATABASE_URL = process.env.LTCM_P012_TEST_DATABASE_URL;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_ID = '00000000-0000-4000-8000-000000029101';
const ADMIN_SUBJECT = 'ci-p029|admin';
const CLIENT_ID = '00000000-0000-4000-8000-000000029102';
const PROJECT_ID = '00000000-0000-4000-8000-000000029103';
const OTHER_PROJECT_ID = '00000000-0000-4000-8000-000000029104';
const ITEM_A_ID = '00000000-0000-4000-8000-000000029105';
const ITEM_B_ID = '00000000-0000-4000-8000-000000029106';
const VERSION_ID = '00000000-0000-4000-8000-000000029107';
const OTHER_VERSION_ID = '00000000-0000-4000-8000-000000029108';
const ADMIN_BOOTSTRAP_MIGRATION = '20260731103000_add_ltcm_audit_read_event.sql';

function databaseUrl() {
  if (!DATABASE_URL) throw new Error('P029_POSTGRES_ENV_MISSING');
  const parsed = new URL(DATABASE_URL);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase()) ||
    parsed.pathname !== '/ltcm_test' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('P029_POSTGRES_ENV_INVALID');
  }
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
    `select ltc_m.set_actor_context(null, null, 'p029-bootstrap', null, 'system', false)`,
  );
  await client.query(
    `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
     values ($1::uuid, $2::text, 'P029 Synthetic Admin', 'admin', true)`,
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
      `select ltc_m.set_actor_context($1::uuid, $2::text, 'p029-fixture', null, 'system', false)`,
      [ADMIN_ID, ADMIN_SUBJECT],
    );
    await client.query(`insert into ltc_m.currencies (code, name) values ('BRL', 'Real')`);
    await client.query(`insert into ltc_m.units (code, name) values ('US', 'Unidade P029')`);
    await client.query(
      `insert into ltc_m.clients (id, legal_name, display_name, created_by_user_id)
       values ($1::uuid, 'Cliente P029', 'Cliente P029', $2::uuid)`,
      [CLIENT_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.projects (
         id, project_code, project_name, client_id, status, base_currency,
         contract_value, data_reference_date, created_by_user_id
       ) values
         ($1::uuid, 'P029-LOCAL', 'Projeto P029', $3::uuid, 'active', 'BRL',
          1000, date '2026-12-01', $2::uuid),
         ($4::uuid, 'P029-OTHER', 'Projeto P029 outro', $3::uuid, 'active', 'BRL',
          1000, date '2026-12-01', $2::uuid)`,
      [PROJECT_ID, ADMIN_ID, CLIENT_ID, OTHER_PROJECT_ID],
    );
    await client.query(
      `insert into ltc_m.project_items (
         id, project_id, source_line_key, line_number, item_code, description,
         quantity, unit_code, currency_code, unit_price, created_by_user_id
       ) values
         ($1::uuid, $3::uuid, 'p029-item-a', 1, 'A', 'Item A', 1, 'US', 'BRL', 1, $2::uuid),
         ($4::uuid, $3::uuid, 'p029-item-b', 2, 'B', 'Item B', 1, 'US', 'BRL', 1, $2::uuid)`,
      [ITEM_A_ID, ADMIN_ID, PROJECT_ID, ITEM_B_ID],
    );
    await client.query(
      `insert into ltc_m.plan_versions (id, name, reference_date, status, created_by_user_id)
       values
         ($1::uuid, 'P029 Draft', date '2026-12-01', 'draft', $3::uuid),
         ($2::uuid, 'P029 Other', date '2026-12-01', 'draft', $3::uuid)`,
      [VERSION_ID, OTHER_VERSION_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.financial_plan_scopes (
         plan_version_id, project_id, metric_type, planning_level, currency_code,
         created_by_user_id
       ) values
         ($1::uuid, $3::uuid, 'billing_planned', 'item', 'BRL', $4::uuid),
         ($2::uuid, $5::uuid, 'billing_planned', 'item', 'BRL', $4::uuid)`,
      [VERSION_ID, OTHER_VERSION_ID, PROJECT_ID, ADMIN_ID, OTHER_PROJECT_ID],
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
  'P029 PostgreSQL 17 persiste batch multi-mês, faz upsert e reverte falha parcial',
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
        requestId: 'p029-integration-save',
        source: 'api',
      };
      const payload = {
        expectedVersion: 1,
        justification: 'Batch P029 PostgreSQL',
        entries: [
          { itemId: ITEM_A_ID, competence: '2026-12-01', amount: '0.10' },
          { itemId: ITEM_A_ID, competence: '2027-01-01', amount: '12.30' },
          { itemId: ITEM_B_ID, competence: '2026-12-01', amount: '7.00' },
        ],
      };
      const saved = await service.save(PROJECT_ID, VERSION_ID, payload, actor);
      assert.equal(saved.entries.length, 3);
      assert.equal(saved.version.contentRevision, 2);
      assert.deepEqual(saved.projectTotals, [
        { competence: '2026-12-01', amount: '7.10' },
        { competence: '2027-01-01', amount: '12.30' },
      ]);
      const audit = await admin.query(
        `select count(*)::integer as count,
                count(*) filter (
                  where changed_by_user_id = $1::uuid
                    and request_id = $2::text
                    and justification = $3::text
                    and old_data is not null
                    and new_data is not null
                )::integer as complete_count
           from ltc_m.audit_log
          where request_id = $2::text
            and table_name in ('ltc_m.financial_plan_lines', 'ltc_m.plan_versions')`,
        [ADMIN_ID, actor.requestId, payload.justification],
      );
      assert.ok(audit.rows[0].count >= 4);
      assert.ok(audit.rows[0].complete_count >= 1);

      const repeated = await service.save(
        PROJECT_ID,
        VERSION_ID,
        {
          expectedVersion: 2,
          justification: null,
          entries: [{ itemId: ITEM_A_ID, competence: '2026-12-01', amount: '1.10' }],
        },
        actor,
      );
      assert.equal(repeated.entries.length, 3);
      assert.equal(repeated.version.contentRevision, 3);
      const count = await admin.query(
        `select count(*)::integer as count from ltc_m.financial_plan_lines
       where plan_version_id = $1::uuid and project_id = $2::uuid`,
        [VERSION_ID, PROJECT_ID],
      );
      assert.equal(count.rows[0].count, 3);

      const concurrent = await Promise.allSettled([
        service.save(
          PROJECT_ID,
          VERSION_ID,
          {
            expectedVersion: 3,
            justification: 'writer-a',
            entries: [{ itemId: ITEM_A_ID, competence: '2027-02-01', amount: '2.00' }],
          },
          actor,
        ),
        service.save(
          PROJECT_ID,
          VERSION_ID,
          {
            expectedVersion: 3,
            justification: 'writer-b',
            entries: [{ itemId: ITEM_B_ID, competence: '2027-03-01', amount: '3.00' }],
          },
          actor,
        ),
      ]);
      assert.equal(concurrent.filter(({ status }) => status === 'fulfilled').length, 1);
      const rejected = concurrent.find(({ status }) => status === 'rejected');
      assert.equal(rejected?.status, 'rejected');
      if (rejected?.status === 'rejected')
        assert.match(String(rejected.reason?.message), /P029_VERSION_CONFLICT/u);

      await assert.rejects(
        service.save(
          PROJECT_ID,
          VERSION_ID,
          {
            expectedVersion: 4,
            justification: 'rollback',
            entries: [
              { itemId: ITEM_A_ID, competence: '2027-04-01', amount: '2.00' },
              { itemId: ITEM_B_ID, competence: '2027-05-01', amount: '99999999999999999999.00' },
            ],
          },
          actor,
        ),
      );
      const rollback = await admin.query(
        `select count(*) filter (where competence_month = date '2027-04-01')::integer as inserted,
              (select content_revision from ltc_m.plan_versions where id = $1::uuid)::integer as content_revision
         from ltc_m.financial_plan_lines
        where plan_version_id = $1::uuid`,
        [VERSION_ID],
      );
      assert.deepEqual(rollback.rows[0], { inserted: 0, content_revision: 4 });
    } finally {
      await databasePool?.close().catch(() => undefined);
      await rebuildFromZero(admin).catch(() => undefined);
      await admin.end();
    }
  },
);
