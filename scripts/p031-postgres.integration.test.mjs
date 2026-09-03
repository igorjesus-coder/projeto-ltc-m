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
const VIEWER_ID = '00000000-0000-4000-8000-000000031009';
const CLIENT_ID = '00000000-0000-4000-8000-000000031003';
const PROJECT_ID = '00000000-0000-4000-8000-000000031004';
const ITEM_ID = '00000000-0000-4000-8000-000000031005';
const VERSION_ID = '00000000-0000-4000-8000-000000031006';
const LINE_ID = '00000000-0000-4000-8000-000000031007';
const SECOND_VERSION_ID = '00000000-0000-4000-8000-000000031010';
const SECOND_LINE_ID = '00000000-0000-4000-8000-000000031011';
const ACTUAL_ID = '00000000-0000-4000-8000-000000031012';
const ARTIFACT_ID = '00000000-0000-4000-8000-000000031013';
const BATCH_ID = '00000000-0000-4000-8000-000000031014';
const SHEET_ID = '00000000-0000-4000-8000-000000031015';
const STAGING_ID = '00000000-0000-4000-8000-000000031016';
const EXECUTION_ID = '00000000-0000-4000-8000-000000031017';
const BASELINE_ID = '00000000-0000-4000-8000-000000031018';
const ADMIN_SUBJECT = 'ci-p031|admin';
const EDITOR_SUBJECT = 'ci-p031|editor';
const APPROVER_SUBJECT = 'ci-p031|approver';
const VIEWER_SUBJECT = 'ci-p031|viewer';
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
    await client.query(
      `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
       values ($1::uuid, $2::text, 'P031 Viewer', 'viewer', true)`,
      [VIEWER_ID, VIEWER_SUBJECT],
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
       values ($1::uuid, 'P031 Baseline', date '2026-12-01', 'draft', true, $2::uuid),
              ($3::uuid, 'P031 Secondary', date '2026-12-01', 'draft', false, $2::uuid)`,
      [VERSION_ID, EDITOR_ID, SECOND_VERSION_ID],
    );
    await client.query(
      `insert into ltc_m.financial_plan_scopes (
         plan_version_id, project_id, metric_type, planning_level, currency_code,
         created_by_user_id
       ) values ($1::uuid, $2::uuid, 'billing_planned', 'item', 'BRL', $3::uuid),
                ($4::uuid, $2::uuid, 'billing_planned', 'item', 'BRL', $3::uuid)`,
      [VERSION_ID, PROJECT_ID, EDITOR_ID, SECOND_VERSION_ID],
    );
    await client.query(
      `insert into ltc_m.financial_plan_lines (
         id, plan_version_id, project_id, project_item_id, metric_type,
         planning_level, competence_month, amount, currency_code, created_by_user_id
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'billing_planned',
         'item', date '2026-12-01', 500.00, 'BRL', $5::uuid),
                ($6::uuid, $7::uuid, $3::uuid, $4::uuid, 'billing_planned',
         'item', date '2026-12-01', 0.00, 'BRL', $5::uuid)`,
      [LINE_ID, VERSION_ID, PROJECT_ID, ITEM_ID, EDITOR_ID, SECOND_LINE_ID, SECOND_VERSION_ID],
    );
    await client.query(
      `insert into ltc_m.financial_actual_events (
         id, project_id, project_item_id, metric_type, competence_date, source_key,
         amount, currency_code, status, created_by_user_id
       ) values ($1::uuid, $2::uuid, $3::uuid, 'billing_actual', date '2026-12-01',
         'p031-synthetic-actual', 200.00, 'BRL', 'posted', $4::uuid)`,
      [ACTUAL_ID, PROJECT_ID, ITEM_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.monthly_source_artifacts (
         id, source_sha256, source_size_bytes, source_mime_type, source_name,
         source_contract_version, worksheet_key, worksheet_name, structural_range,
         source_semantic_fingerprint, created_by_user_id
       ) values ($1::uuid, $2::text, 100,
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'p031.xlsx',
         'ltcm.p013.source-artifact.v1', 'monthly_revenue', 'Prev. Receita Mensal',
         'A1:T52', $3::text, $4::uuid)`,
      [ARTIFACT_ID, 'a'.repeat(64), 'b'.repeat(64), ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.import_batches (
         id, source_name, source_hash, source_size_bytes, source_mime_type,
         idempotency_key, status, received_rows, accepted_rows, submitted_by_user_id
       ) values ($1::uuid, 'p031.xlsx', $2::text, 100,
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         $3::text, 'loaded', 1, 1, $4::uuid)`,
      [BATCH_ID, 'a'.repeat(64), `p031-baseline-v1:${'c'.repeat(64)}`, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.import_batch_sheets (
         id, import_batch_id, sheet_key, sheet_name, sheet_index, detected_range,
         first_row, last_row, found_rows, staged_rows, status, created_by_user_id
       ) values ($1::uuid, $2::uuid, 'monthly_revenue', 'Prev. Receita Mensal', 1,
                 'A1:T52', 1, 52, 1, 1, 'completed', $3::uuid)`,
      [SHEET_ID, BATCH_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.import_staging_rows (
         id, import_batch_sheet_id, source_row_number, source_range, row_kind,
         raw_payload, row_hash, status, created_by_user_id
       ) values ($1::uuid, $2::uuid, 4, 'A4:T4', 'data', '{}'::jsonb,
                 $3::text, 'processed', $4::uuid)`,
      [STAGING_ID, SHEET_ID, 'd'.repeat(64), ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.monthly_plan_baselines (
         id, plan_version_id, metric_type, planning_level, semantic_contract_version,
         semantic_fingerprint, created_by_user_id
       ) values ($1::uuid, $2::uuid, 'billing_planned', 'item',
                 'ltcm.p013.monthly-baseline-semantic.v1', $3::text, $4::uuid)`,
      [BASELINE_ID, VERSION_ID, 'e'.repeat(64), ADMIN_ID],
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
        'a'.repeat(64),
        BASELINE_ID,
        'e'.repeat(64),
        VERSION_ID,
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
       ) values (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text,
         $6::uuid, $7::uuid, $8::uuid, 'billing_planned', 'item', date '2026-12-01',
         $9::text, '1', 4, 'K', 'K4', 'value', '500', $10::text, 500.00,
         $11::uuid, $12::uuid)`,
      [
        BATCH_ID,
        SHEET_ID,
        STAGING_ID,
        BASELINE_ID,
        'e'.repeat(64),
        VERSION_ID,
        PROJECT_ID,
        ITEM_ID,
        `p012-item-v1:${'f'.repeat(64)}`,
        '1'.repeat(64),
        LINE_ID,
        ADMIN_ID,
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

function actors() {
  return {
    admin: {
      appUserId: ADMIN_ID,
      authSubject: ADMIN_SUBJECT,
      requestId: 'p031-admin',
      source: 'api',
    },
    approver: {
      appUserId: APPROVER_ID,
      authSubject: APPROVER_SUBJECT,
      requestId: 'p031-approver',
      source: 'api',
    },
    viewer: {
      appUserId: VIEWER_ID,
      authSubject: VIEWER_SUBJECT,
      requestId: 'p031-viewer',
      source: 'api',
    },
  };
}

async function withFixture(callback) {
  const adminPool = new Pool({ connectionString: databaseUrl(), max: 1 });
  let databasePool;
  try {
    await rebuildFromZero(adminPool);
    await setupFixtures(adminPool);
    databasePool = new DatabasePool(new Pool({ connectionString: databaseUrl(), max: 2 }));
    const database = {
      actorTransaction: (context, operation) =>
        withActorTransaction(databasePool, context, async (client) => {
          await client.query('set local role ltc_m_runtime');
          return operation(client);
        }),
    };
    return await callback({
      adminPool,
      database,
      databasePool,
      service: new PlanningService(database),
      ...actors(),
    });
  } finally {
    await databasePool?.close().catch(() => undefined);
    await rebuildFromZero(adminPool).catch(() => undefined);
    await adminPool.end();
  }
}

async function versionSnapshot(pool, versionId) {
  const version = await pool.query(
    `select id::text, name, reference_date::text, status::text, is_baseline,
            notes, source_plan_version_id::text, baseline_plan_version_id::text,
            content_revision::integer, row_version::integer
       from ltc_m.plan_versions
      where id = $1::uuid`,
    [versionId],
  );
  const lines = await pool.query(
    `select project_item_id::text, competence_month::text, amount::text, currency_code
       from ltc_m.financial_plan_lines
      where plan_version_id = $1::uuid
      order by competence_month, project_item_id`,
    [versionId],
  );
  return { version: version.rows, lines: lines.rows };
}

async function baselineSnapshot(pool) {
  const baseline = await pool.query(
    `select id::text, plan_version_id::text, metric_type::text, planning_level,
            semantic_contract_version, semantic_fingerprint
       from ltc_m.monthly_plan_baselines
      order by id`,
  );
  const cells = await pool.query(
    `select baseline_id::text, plan_version_id::text, project_item_id::text,
            competence_month::text, source_cell_reference, declaration_state,
            source_numeric_text, source_value_hash, canonical_amount::text,
            financial_plan_line_id::text
       from ltc_m.monthly_plan_cells
      order by baseline_id, competence_month, project_item_id`,
  );
  return { baseline: baseline.rows, cells: cells.rows };
}

async function baselineCounts(pool) {
  const result = await pool.query(
    `select
       (select count(*)::integer from ltc_m.monthly_plan_baselines) as baseline_count,
       (select count(*)::integer from ltc_m.monthly_plan_cells) as cell_count,
       (select count(*)::integer from ltc_m.monthly_plan_cells where plan_version_id = $1::uuid)
         as source_cell_count`,
    [VERSION_ID],
  );
  return result.rows[0];
}

async function lineSnapshot(pool, versionId = VERSION_ID) {
  const result = await pool.query(
    `select lines.amount::text, versions.content_revision::integer
       from ltc_m.financial_plan_lines lines
       join ltc_m.plan_versions versions on versions.id = lines.plan_version_id
      where lines.plan_version_id = $1::uuid
      order by lines.id`,
    [versionId],
  );
  return result.rows;
}

test(
  'P031 PostgreSQL preserva saldo positivo, workflow e tokens separados',
  { skip: !ENABLED, concurrency: false },
  async () =>
    withFixture(async ({ service, adminPool, admin: actor, approver }) => {
      const initial = await service.editor(PROJECT_ID, { versionId: VERSION_ID }, actor);
      assert.deepEqual(
        {
          contractValue: initial.financial.contractValue,
          actualPosted: initial.financial.actualPosted,
          plannedDraft: initial.financial.plannedDraft,
          rawBalance: initial.financial.rawBalance,
          unplannedBalance: initial.financial.unplannedBalance,
          hasExcess: initial.financial.hasExcess,
        },
        {
          contractValue: '1000.00',
          actualPosted: '200.00',
          plannedDraft: '500.00',
          rawBalance: '300.00',
          unplannedBalance: '300.00',
          hasExcess: false,
        },
      );
      const beforeLines = await lineSnapshot(adminPool);

      const pending = await service.workflow(
        PROJECT_ID,
        VERSION_ID,
        'submit',
        { expectedRowVersion: 1 },
        actor,
      );
      assert.equal(pending.version.status, 'pending_approval');
      assert.equal(pending.version.rowVersion, 2);
      assert.equal(pending.version.contentRevision, 1);
      assert.equal(pending.financial.actualPosted, '200.00');
      assert.equal(pending.financial.rawBalance, '800.00');
      assert.deepEqual(await lineSnapshot(adminPool), beforeLines);

      const approved = await service.workflow(
        PROJECT_ID,
        VERSION_ID,
        'approve',
        { expectedRowVersion: pending.version.rowVersion, justification: 'Aprovação P031' },
        approver,
      );
      assert.equal(approved.version.status, 'approved');
      assert.equal(approved.version.rowVersion, 3);
      assert.equal(approved.version.contentRevision, 1);
      assert.equal(approved.financial.actualPosted, '200.00');
      assert.equal(approved.financial.rawBalance, '800.00');
      assert.ok(approved.financial.rawBalance !== '0.00');
      assert.deepEqual(await lineSnapshot(adminPool), beforeLines);

      await assert.rejects(
        service.workflow(
          PROJECT_ID,
          VERSION_ID,
          'approve',
          { expectedRowVersion: pending.version.rowVersion, justification: 'stale approve' },
          approver,
        ),
        /P031_VERSION_CONFLICT/u,
      );

      const locked = await service.workflow(
        PROJECT_ID,
        VERSION_ID,
        'lock',
        { expectedRowVersion: approved.version.rowVersion, justification: 'Lock P031' },
        actor,
      );
      assert.equal(locked.version.status, 'locked');
      assert.equal(locked.version.rowVersion, 4);
      assert.equal(locked.version.contentRevision, 1);
      const approvalAudit = await adminPool.query(
        `select count(*)::integer as count
           from ltc_m.audit_log
          where request_id = $1::text and justification = $2::text`,
        [approver.requestId, 'Aprovação P031'],
      );
      assert.ok(approvalAudit.rows[0].count >= 1);
    }),
);

test(
  'P031 PostgreSQL preserva baseline em duas reaberturas consecutivas',
  { skip: !ENABLED, concurrency: false },
  async () =>
    withFixture(async ({ service, adminPool, admin: actor, approver }) => {
      const pending = await service.workflow(
        PROJECT_ID,
        VERSION_ID,
        'submit',
        { expectedRowVersion: 1 },
        actor,
      );
      const approved = await service.workflow(
        PROJECT_ID,
        VERSION_ID,
        'approve',
        { expectedRowVersion: pending.version.rowVersion, justification: 'Aprovação V1' },
        approver,
      );
      const locked = await service.workflow(
        PROJECT_ID,
        VERSION_ID,
        'lock',
        { expectedRowVersion: approved.version.rowVersion, justification: 'Lock V1' },
        actor,
      );
      const v1Before = await versionSnapshot(adminPool, VERSION_ID);
      const baselineBefore = await baselineSnapshot(adminPool);
      const countsBefore = await baselineCounts(adminPool);

      const v2 = await service.workflow(
        PROJECT_ID,
        VERSION_ID,
        'reopen',
        {
          expectedRowVersion: locked.version.rowVersion,
          justification: 'Revisão V2',
          newName: 'P031 V2',
        },
        actor,
      );
      assert.equal(v2.version.sourcePlanVersionId, VERSION_ID);
      assert.equal(v2.version.baselinePlanVersionId, VERSION_ID);

      const v2Pending = await service.workflow(
        PROJECT_ID,
        v2.version.versionId,
        'submit',
        { expectedRowVersion: v2.version.rowVersion },
        actor,
      );
      const v2Approved = await service.workflow(
        PROJECT_ID,
        v2.version.versionId,
        'approve',
        { expectedRowVersion: v2Pending.version.rowVersion, justification: 'Aprovação V2' },
        approver,
      );
      const v2Locked = await service.workflow(
        PROJECT_ID,
        v2.version.versionId,
        'lock',
        { expectedRowVersion: v2Approved.version.rowVersion, justification: 'Lock V2' },
        actor,
      );
      const v2Before = await versionSnapshot(adminPool, v2.version.versionId);

      const v3 = await service.workflow(
        PROJECT_ID,
        v2.version.versionId,
        'reopen',
        {
          expectedRowVersion: v2Locked.version.rowVersion,
          justification: 'Revisão V3',
          newName: 'P031 V3',
        },
        actor,
      );
      assert.equal(v3.version.sourcePlanVersionId, v2.version.versionId);
      assert.equal(v3.version.baselinePlanVersionId, VERSION_ID);
      assert.equal(v2.version.baselinePlanVersionId, VERSION_ID);
      assert.equal(v3.version.contentRevision, 1);

      assert.deepEqual(await versionSnapshot(adminPool, VERSION_ID), v1Before);
      assert.deepEqual(await versionSnapshot(adminPool, v2.version.versionId), v2Before);
      assert.deepEqual(await baselineSnapshot(adminPool), baselineBefore);
      assert.deepEqual(await baselineCounts(adminPool), countsBefore);
      assert.equal(
        (
          await adminPool.query(
            `select count(*)::integer as count from ltc_m.plan_versions where is_baseline`,
          )
        ).rows[0].count,
        1,
      );
      assert.equal(
        (
          await adminPool.query(
            `select count(*)::integer as count from ltc_m.plan_versions where baseline_plan_version_id = $1::uuid`,
            [VERSION_ID],
          )
        ).rows[0].count,
        2,
      );
    }),
);

test(
  'P031 PostgreSQL reverte reopen após falha injetada na mesma transação',
  { skip: !ENABLED, concurrency: false },
  async () =>
    withFixture(async ({ service, adminPool, databasePool, admin: actor, approver }) => {
      const pending = await service.workflow(
        PROJECT_ID,
        VERSION_ID,
        'submit',
        { expectedRowVersion: 1 },
        actor,
      );
      const approved = await service.workflow(
        PROJECT_ID,
        VERSION_ID,
        'approve',
        { expectedRowVersion: pending.version.rowVersion, justification: 'Aprovação rollback' },
        { ...approver, requestId: 'p031-rollback-approve' },
      );
      const locked = await service.workflow(
        PROJECT_ID,
        VERSION_ID,
        'lock',
        { expectedRowVersion: approved.version.rowVersion, justification: 'Lock rollback' },
        actor,
      );
      const sourceBefore = await versionSnapshot(adminPool, VERSION_ID);
      const countsBefore = await baselineCounts(adminPool);

      await assert.rejects(
        withActorTransaction(
          databasePool,
          { ...actor, requestId: 'p031-injected-failure', justification: 'rollback injection' },
          async (client) => {
            await client.query('set local role ltc_m_runtime');
            const created = await client.query(
              `select ltc_m.reopen_plan_version($1::uuid, $2::text, $3::bigint) as plan_version_id`,
              [VERSION_ID, 'P031 rollback revision', locked.version.rowVersion],
            );
            assert.ok(created.rows[0].plan_version_id);
            throw new Error('P031_TEST_INJECTED_FAILURE_AFTER_REOPEN');
          },
        ),
        /P031_TEST_INJECTED_FAILURE_AFTER_REOPEN/u,
      );

      assert.equal(
        (
          await adminPool.query(
            `select count(*)::integer as count from ltc_m.plan_versions where source_plan_version_id = $1::uuid`,
            [VERSION_ID],
          )
        ).rows[0].count,
        0,
      );
      assert.equal(
        (
          await adminPool.query(
            `select count(*)::integer as count from ltc_m.financial_plan_scopes where plan_version_id = $1::uuid`,
            [VERSION_ID],
          )
        ).rows[0].count,
        1,
      );
      assert.equal(
        (
          await adminPool.query(
            `select count(*)::integer as count from ltc_m.financial_plan_lines where plan_version_id = $1::uuid`,
            [VERSION_ID],
          )
        ).rows[0].count,
        1,
      );
      assert.deepEqual(await baselineCounts(adminPool), countsBefore);
      assert.equal(
        (
          await adminPool.query(
            `select count(*)::integer as count from ltc_m.audit_log where request_id = 'p031-injected-failure'`,
          )
        ).rows[0].count,
        0,
      );
      assert.deepEqual(await versionSnapshot(adminPool, VERSION_ID), sourceBefore);
    }),
);

test(
  'P031 PostgreSQL protege RLS, archive e escrita fora de draft',
  { skip: !ENABLED, concurrency: false },
  async () =>
    withFixture(async ({ service, adminPool, admin: actor, approver, viewer }) => {
      const protectedTables = await adminPool.query(
        `select c.relname, c.relrowsecurity, c.relforcerowsecurity
           from pg_catalog.pg_class c
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'ltc_m'
            and c.relname = any($1::text[])
          order by c.relname`,
        [
          [
            'financial_plan_lines',
            'financial_plan_scopes',
            'monthly_plan_baselines',
            'monthly_plan_cells',
            'plan_versions',
          ],
        ],
      );
      assert.equal(protectedTables.rows.length, 5);
      assert.ok(protectedTables.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity));

      const archivePrivileges = await adminPool.query(
        `select
           has_function_privilege(
             'ltc_m_runtime'::name,
             'ltc_m.archive_plan_version(uuid)'::regprocedure,
             'EXECUTE'
           ) as legacy_archive_execute,
           has_function_privilege(
             'ltc_m_runtime'::name,
             'ltc_m.archive_plan_version(uuid, bigint)'::regprocedure,
             'EXECUTE'
           ) as versioned_archive_execute`,
      );
      assert.equal(archivePrivileges.rows[0].legacy_archive_execute, false);
      assert.equal(archivePrivileges.rows[0].versioned_archive_execute, true);

      await assert.rejects(
        service.workflow(
          PROJECT_ID,
          VERSION_ID,
          'archive',
          { expectedRowVersion: 1, justification: 'draft archive' },
          actor,
        ),
        /Somente versão aprovada ou bloqueada/u,
      );
      const pending = await service.workflow(
        PROJECT_ID,
        VERSION_ID,
        'submit',
        { expectedRowVersion: 1 },
        actor,
      );
      await assert.rejects(
        service.workflow(
          PROJECT_ID,
          VERSION_ID,
          'archive',
          { expectedRowVersion: pending.version.rowVersion, justification: 'pending archive' },
          actor,
        ),
        /Somente versão aprovada ou bloqueada/u,
      );
      const approved = await service.workflow(
        PROJECT_ID,
        VERSION_ID,
        'approve',
        { expectedRowVersion: pending.version.rowVersion, justification: 'Aprovação archive' },
        approver,
      );
      await assert.rejects(
        service.workflow(
          PROJECT_ID,
          VERSION_ID,
          'archive',
          { expectedRowVersion: approved.version.rowVersion, justification: 'viewer archive' },
          viewer,
        ),
        /Arquivamento exige admin ativo/u,
      );
      const archived = await service.workflow(
        PROJECT_ID,
        VERSION_ID,
        'archive',
        { expectedRowVersion: approved.version.rowVersion, justification: 'Archive approved' },
        actor,
      );
      assert.equal(archived.version.status, 'archived');
      assert.equal(archived.version.rowVersion, 4);
      assert.equal(archived.version.contentRevision, 1);
      assert.equal(archived.version.editable, false);
      await assert.rejects(
        service.save(
          PROJECT_ID,
          VERSION_ID,
          { expectedVersion: 1, justification: 'write archived', entries: [] },
          actor,
        ),
        /P029_VERSION_NOT_FOUND/u,
      );

      const lockedPending = await service.workflow(
        PROJECT_ID,
        SECOND_VERSION_ID,
        'submit',
        { expectedRowVersion: 1 },
        actor,
      );
      const lockedApproved = await service.workflow(
        PROJECT_ID,
        SECOND_VERSION_ID,
        'approve',
        {
          expectedRowVersion: lockedPending.version.rowVersion,
          justification: 'Aprovação locked archive',
        },
        approver,
      );
      const locked = await service.workflow(
        PROJECT_ID,
        SECOND_VERSION_ID,
        'lock',
        { expectedRowVersion: lockedApproved.version.rowVersion, justification: 'Lock archive' },
        actor,
      );
      const lockedArchived = await service.workflow(
        PROJECT_ID,
        SECOND_VERSION_ID,
        'archive',
        { expectedRowVersion: locked.version.rowVersion, justification: 'Archive locked' },
        actor,
      );
      assert.equal(lockedArchived.version.status, 'archived');
      assert.equal(lockedArchived.version.contentRevision, 1);
    }),
);
