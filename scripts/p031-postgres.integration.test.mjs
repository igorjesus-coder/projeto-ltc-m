import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import { DatabasePool } from '../apps/api/dist/src/database/database-pool.js';
import { PlanningService } from '../apps/api/dist/src/planning/planning.service.js';
import { withActorTransaction } from '../apps/api/dist/src/database/transaction.js';

const ENABLED = process.env.LTCM_P031_INTEGRATION === '1';
const DATABASE_URL = process.env.LTCM_P012_TEST_DATABASE_URL;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_ID = '00000000-0000-4000-8000-000000031001';
const EDITOR_ID = '00000000-0000-4000-8000-000000031002';
const APPROVER_ID = '00000000-0000-4000-8000-000000031008';
const CLIENT_ID = '00000000-0000-4000-8000-000000031003';
const PROJECT_ID = '00000000-0000-4000-8000-000000031004';
const ITEM_ID = '00000000-0000-4000-8000-000000031005';
const VERSION_ID = '00000000-0000-4000-8000-000000031006';
const LINE_ID = '00000000-0000-4000-8000-000000031007';
const ADMIN_SUBJECT = 'ci-p031|admin';
const EDITOR_SUBJECT = 'ci-p031|editor';
const APPROVER_SUBJECT = 'ci-p031|approver';
const ADMIN_BOOTSTRAP_MIGRATION = '20260731103000_add_ltcm_audit_read_event.sql';

function databaseUrl() {
  if (!DATABASE_URL) throw new Error('P031_POSTGRES_ENV_MISSING');
  const parsed = new URL(DATABASE_URL);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase()) ||
    parsed.pathname !== (process.env.CI ? '/ltcm_ci' : '/ltcm_test') ||
    parsed.search ||
    parsed.hash
  )
    throw new Error('P031_POSTGRES_ENV_INVALID');
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

async function rebuildFromZero(pool) {
  const client = await pool.connect();
  try {
    await client.query('drop schema if exists ltc_m cascade');
    for (const migration of await migrations()) {
      await client.query(migration.sql);
      if (migration.name === ADMIN_BOOTSTRAP_MIGRATION) {
        await client.query(
          `select ltc_m.set_actor_context(null, null, 'p031-bootstrap', null, 'system', false)`,
        );
        await client.query(
          `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
           values ($1::uuid, $2::text, 'P031 Admin', 'admin', true),
                  ($3::uuid, $4::text, 'P031 Editor', 'editor', true)`,
          [ADMIN_ID, ADMIN_SUBJECT, EDITOR_ID, EDITOR_SUBJECT],
        );
      }
    }
    await client.query(
      `select ltc_m.set_actor_context(null, null, 'p031-approver-bootstrap', null, 'system', false)`,
    );
    await client.query(
      `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
       values ($1::uuid, $2::text, 'P031 Approver', 'approver', true)`,
      [APPROVER_ID, APPROVER_SUBJECT],
    );
  } finally {
    client.release();
  }
}

async function setupFixtures(pool) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `select ltc_m.set_actor_context(null, null, 'p031-fixture', null, 'system', false)`,
    );
    await client.query(`insert into ltc_m.currencies (code, name) values ('BRL', 'Real')`);
    await client.query(`insert into ltc_m.units (code, name) values ('US', 'Unidade P031')`);
    await client.query(
      `insert into ltc_m.clients (id, legal_name, display_name, created_by_user_id)
       values ($1::uuid, 'Cliente P031', 'Cliente P031', $2::uuid)`,
      [CLIENT_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.projects (
         id, project_code, project_name, client_id, status, base_currency,
         contract_value, data_reference_date, created_by_user_id
       ) values ($1::uuid, 'P031-LOCAL', 'Projeto P031', $2::uuid, 'active', 'BRL',
         1000.00, date '2026-12-01', $3::uuid)`,
      [PROJECT_ID, CLIENT_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.project_items (
         id, project_id, source_line_key, line_number, item_code, description,
         quantity, unit_code, currency_code, unit_price, created_by_user_id
       ) values ($1::uuid, $2::uuid, 'p031-item', 1, 'A', 'Item A', 1, 'US', 'BRL', 1, $3::uuid)`,
      [ITEM_ID, PROJECT_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.plan_versions (id, name, reference_date, status, is_baseline, created_by_user_id)
       values ($1::uuid, 'P031 Baseline', date '2026-12-01', 'draft', true, $2::uuid)`,
      [VERSION_ID, EDITOR_ID],
    );
    await client.query(
      `insert into ltc_m.financial_plan_scopes (
         plan_version_id, project_id, metric_type, planning_level, currency_code,
         created_by_user_id
       ) values ($1::uuid, $2::uuid, 'billing_planned', 'item', 'BRL', $3::uuid)`,
      [VERSION_ID, PROJECT_ID, EDITOR_ID],
    );
    await client.query(
      `insert into ltc_m.financial_plan_lines (
         id, plan_version_id, project_id, project_item_id, metric_type,
         planning_level, competence_month, amount, currency_code, created_by_user_id
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'billing_planned',
         'item', date '2026-12-01', 100.00, 'BRL', $5::uuid)`,
      [LINE_ID, VERSION_ID, PROJECT_ID, ITEM_ID, EDITOR_ID],
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
  'P031 PostgreSQL executa estados, archive, row_version, linhagem e rollback',
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
        requestId: 'p031-integration',
        source: 'api',
      };
      const approver = {
        appUserId: APPROVER_ID,
        authSubject: APPROVER_SUBJECT,
        requestId: 'p031-integration-approver',
        source: 'api',
      };

      const initial = await service.editor(PROJECT_ID, { versionId: VERSION_ID }, actor);
      assert.equal(initial.version.rowVersion, 1);
      assert.equal(initial.version.contentRevision, 1);
      assert.equal(initial.financial.rawBalance, '900.00');

      const pending = await service.workflow(
        PROJECT_ID,
        VERSION_ID,
        'submit',
        { expectedRowVersion: 1 },
        actor,
      );
      assert.equal(pending.version.status, 'pending_approval');
      assert.equal(pending.version.contentRevision, 1);

      const approved = await service.workflow(
        PROJECT_ID,
        VERSION_ID,
        'approve',
        { expectedRowVersion: pending.version.rowVersion, justification: 'Aprovação formal' },
        approver,
      );
      assert.equal(approved.version.status, 'approved');

      const locked = await service.workflow(
        PROJECT_ID,
        VERSION_ID,
        'lock',
        { expectedRowVersion: approved.version.rowVersion, justification: 'Fechamento P031' },
        actor,
      );
      assert.equal(locked.version.status, 'locked');

      await assert.rejects(
        service.workflow(
          PROJECT_ID,
          VERSION_ID,
          'reopen',
          {
            expectedRowVersion: locked.version.rowVersion - 1,
            justification: 'stale',
            newName: 'stale',
          },
          actor,
        ),
        /P031_VERSION_CONFLICT/u,
      );

      const revision = await service.workflow(
        PROJECT_ID,
        VERSION_ID,
        'reopen',
        {
          expectedRowVersion: locked.version.rowVersion,
          justification: 'Revisão P031',
          newName: 'P031 Revisão A',
        },
        actor,
      );
      assert.notEqual(revision.version.versionId, VERSION_ID);
      assert.equal(revision.version.status, 'draft');
      assert.equal(revision.version.sourcePlanVersionId, VERSION_ID);
      assert.equal(revision.version.baselinePlanVersionId, VERSION_ID);
      assert.equal(revision.version.contentRevision, 1);

      const submittedRevision = await service.workflow(
        PROJECT_ID,
        revision.version.versionId,
        'submit',
        { expectedRowVersion: revision.version.rowVersion },
        actor,
      );
      const approvedRevision = await service.workflow(
        PROJECT_ID,
        revision.version.versionId,
        'approve',
        {
          expectedRowVersion: submittedRevision.version.rowVersion,
          justification: 'Aprovação formal',
        },
        approver,
      );
      const archived = await service.workflow(
        PROJECT_ID,
        revision.version.versionId,
        'archive',
        {
          expectedRowVersion: approvedRevision.version.rowVersion,
          justification: 'Encerramento P031',
        },
        actor,
      );
      assert.equal(archived.version.status, 'archived');
      assert.equal(archived.version.editable, false);
      assert.equal(archived.version.baselinePlanVersionId, VERSION_ID);

      const audit = await admin.query(
        `select count(*)::integer as count
           from ltc_m.audit_log
          where request_id = $1::text and justification = $2::text
            and metadata ->> 'workflow_action' = 'archive'`,
        [actor.requestId, 'Encerramento P031'],
      );
      assert.ok(audit.rows[0].count >= 1);
      const immutable = await admin.query(
        `select content_revision::integer, status::text from ltc_m.plan_versions where id = $1::uuid`,
        [revision.version.versionId],
      );
      assert.deepEqual(immutable.rows[0], { content_revision: 1, status: 'archived' });
    } finally {
      await databasePool?.close().catch(() => undefined);
      await rebuildFromZero(admin).catch(() => undefined);
      await admin.end();
    }
  },
);
