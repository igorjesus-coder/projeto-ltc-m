import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  loadP013CertifiedMonthlySource,
  readP013CertifiedMonthlySourceFacts,
} from '@ltcm/extractor/p013';
import { Pool, type PoolClient } from 'pg';

import { createSourceLineKey } from '../src/item-contracts.js';
import {
  assertP013CertifiedMonthlyBaselinePlan,
  createP013LocalPostgresDryRunAdapter,
  runP013MonthlyBaselineDryRun,
  type P013MonthlyBaselinePlan,
} from '../src/monthly-baseline-plan.js';
import { parseP012LoopbackDatabaseUrlForTestHarness } from './support/postgres-item-persistence.js';

const DATABASE_URL = process.env['LTCM_P012_TEST_DATABASE_URL'];
const ENABLED = process.env['LTCM_P013_D03_INTEGRATION'] === '1';
const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const EXPECTED_MIGRATIONS = 14;
const ADMIN_ID = '00000000-0000-4000-8000-000000013501';
const CLIENT_ID = '00000000-0000-4000-8000-000000013502';
const PLAN_ID = '00000000-0000-4000-8000-000000013503';
const VIEWER_ID = '00000000-0000-4000-8000-000000013504';
const RUNTIME_LOGIN = 'p013_d04a_runtime_login';
const RUNTIME_PASSWORD = 'p013-d04a-synthetic-local-only';

function databaseUrl(): string {
  if (DATABASE_URL === undefined || DATABASE_URL === '')
    throw new Error('P013_D03_POSTGRES_ENV_MISSING');
  parseP012LoopbackDatabaseUrlForTestHarness(DATABASE_URL);
  return DATABASE_URL;
}

function runtimeDatabaseUrl(): string {
  const parsed = new URL(databaseUrl());
  parsed.username = RUNTIME_LOGIN;
  parsed.password = RUNTIME_PASSWORD;
  return parsed.toString();
}

async function createRuntimeLogin(client: PoolClient): Promise<void> {
  await client.query(`drop role if exists p013_d04a_runtime_login`);
  await client.query(
    `create role p013_d04a_runtime_login login password '${RUNTIME_PASSWORD}'
       nosuperuser noinherit nocreatedb nocreaterole noreplication nobypassrls`,
  );
  await client.query(
    `grant ltc_m_runtime to p013_d04a_runtime_login
       with admin false, inherit false, set true granted by postgres`,
  );
}

async function dropRuntimeLogin(client: PoolClient): Promise<void> {
  await client
    .query(`revoke ltc_m_runtime from p013_d04a_runtime_login granted by postgres restrict`)
    .catch(() => undefined);
  await client.query(`drop role if exists p013_d04a_runtime_login`);
}

function fixtureUuid(group: number, index: number): string {
  return `00000000-0000-4000-${group.toString().padStart(4, '0')}-${index.toString().padStart(12, '0')}`;
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

async function migrations(): Promise<Array<{ name: string; sql: string }>> {
  const directory = path.join(ROOT, 'supabase', 'migrations');
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  assert.equal(names.length, EXPECTED_MIGRATIONS);
  return Promise.all(
    names.map(async (name) => ({ name, sql: await readFile(path.join(directory, name), 'utf8') })),
  );
}

async function installAdmin(client: PoolClient): Promise<void> {
  await client.query('begin');
  try {
    await client.query(
      `select ltc_m.set_actor_context(null, null, 'p013-d03-bootstrap', null, 'system', false)`,
    );
    await client.query(
      `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
      values ($1::uuid, 'ci-p013-d03|admin', 'P013 D03 Admin', 'admin', true)`,
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
  try {
    await guard(client);
    await client.query('drop schema if exists ltc_m cascade');
    for (const [index, migration] of (await migrations()).entries()) {
      await client.query(migration.sql);
      if (index === 6) await installAdmin(client);
    }
  } finally {
    client.release();
  }
}

async function localSourcePath(): Promise<string> {
  const directory = path.join(ROOT, '.local-source');
  const name = (await readdir(directory)).find((candidate) => candidate.endsWith('.xlsx'));
  if (name === undefined) throw new Error('P013_D03_SOURCE_MISSING');
  return path.join(directory, name);
}

async function setupFixtures(client: PoolClient): Promise<void> {
  const source = await loadP013CertifiedMonthlySource(await localSourcePath());
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
      `select ltc_m.set_actor_context($1::uuid, 'ci-p013-d03|admin', 'p013-d03-fixtures', null, 'import', false)`,
      [ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
       values ($1::uuid, 'ci-p013-d04a|viewer', 'P013 D04A Viewer', 'viewer', true)`,
      [VIEWER_ID],
    );
    await client.query(
      `insert into ltc_m.currencies (code, name) values ('BRL', 'Real sintético')`,
    );
    await client.query(`insert into ltc_m.units (code, name) values ('US', 'Unidade sintética')`);
    await client.query(
      `insert into ltc_m.clients (id, legal_name, display_name, created_by_user_id)
      values ($1::uuid, 'Cliente sintético P013 D03', 'Cliente P013 D03', $2::uuid)`,
      [CLIENT_ID, ADMIN_ID],
    );
    const projectByCode = new Map<string, string>();
    for (const [index, code] of codes.entries()) {
      const id = fixtureUuid(5100, index + 1);
      projectByCode.set(code, id);
      await client.query(
        `insert into ltc_m.projects
        (id, project_code, project_name, client_id, status, base_currency, contract_value,
         data_reference_date, created_by_user_id)
        values ($1::uuid, $2::text, $3::text, $4::uuid, 'active', 'BRL', 1,
                date '2026-07-01', $5::uuid)`,
        [id, code, `Projeto sintético ${index + 1}`, CLIENT_ID, ADMIN_ID],
      );
    }
    for (const [index, identity] of identities.entries()) {
      const projectId = projectByCode.get(identity.project_code)!;
      const lineNumber = Number(identity.source_item_number);
      await client.query(
        `insert into ltc_m.project_items
        (id, project_id, source_line_key, line_number, item_code, description, quantity,
         unit_code, currency_code, unit_price, active, created_by_user_id)
        values ($1::uuid, $2::uuid, $3::text, $4::integer, $5::text, $6::text, 1,
                'US', 'BRL', 1, true, $7::uuid)`,
        [
          fixtureUuid(5200, index + 1),
          projectId,
          createSourceLineKey(identity.project_code, lineNumber),
          lineNumber,
          `SYN-${index % 4}`,
          `Item sintético ${index + 1}`,
          ADMIN_ID,
        ],
      );
    }
    await client.query(
      `insert into ltc_m.plan_versions
      (id, name, reference_date, status, is_baseline, created_by_user_id)
      values ($1::uuid, 'Baseline P013 D03 sintético', date '2026-07-01', 'draft', true, $2::uuid)`,
      [PLAN_ID, ADMIN_ID],
    );
    for (const projectId of projectByCode.values()) {
      await client.query(
        `insert into ltc_m.financial_plan_scopes
        (plan_version_id, project_id, metric_type, planning_level, currency_code, created_by_user_id)
        values ($1::uuid, $2::uuid, 'billing_planned', 'item', 'BRL', $3::uuid)`,
        [PLAN_ID, projectId, ADMIN_ID],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}

async function persistMatchingBaseline(
  client: PoolClient,
  source: Awaited<ReturnType<typeof loadP013CertifiedMonthlySource>>,
  plan: P013MonthlyBaselinePlan,
): Promise<void> {
  const batchId = fixtureUuid(5300, 1);
  const sheetId = fixtureUuid(5300, 2);
  const artifactId = fixtureUuid(5300, 3);
  const baselineId = fixtureUuid(5300, 4);
  const executionId = fixtureUuid(5300, 5);
  const stagingByRow = new Map<number, string>();
  const lineByGrain = new Map<string, string>();
  await client.query('begin');
  try {
    await client.query(
      `select ltc_m.set_actor_context($1::uuid, 'ci-p013-d03|admin',
        'p013-d04a-matching-baseline', null, 'import', false)`,
      [ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.import_batches (
         id, source_name, source_hash, source_size_bytes, source_mime_type,
         idempotency_key, status, received_rows, accepted_rows, submitted_by_user_id
       ) values ($1::uuid, $2::text, $3::text, $4::bigint,
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         $5::text, 'loaded', 48, 48, $6::uuid)`,
      [
        batchId,
        source.source_name,
        source.source_sha256,
        source.source_size_bytes,
        plan.idempotency_key,
        ADMIN_ID,
      ],
    );
    await client.query(
      `insert into ltc_m.import_batch_sheets (
         id, import_batch_id, sheet_key, sheet_name, sheet_index, detected_range,
         first_row, last_row, found_rows, staged_rows, status, created_by_user_id
       ) values ($1::uuid, $2::uuid, 'monthly_revenue', 'Prev. Receita Mensal', 1,
         'A1:T52', 1, 52, 48, 48, 'completed', $3::uuid)`,
      [sheetId, batchId, ADMIN_ID],
    );
    for (let sourceRow = 4; sourceRow <= 51; sourceRow += 1) {
      const stagingId = fixtureUuid(5400, sourceRow);
      stagingByRow.set(sourceRow, stagingId);
      await client.query(
        `insert into ltc_m.import_staging_rows (
           id, import_batch_sheet_id, source_row_number, source_range, row_kind,
           raw_payload, row_hash, status, created_by_user_id
         ) values ($1::uuid, $2::uuid, $3::integer, $4::text, 'data',
           $5::jsonb, $6::text, 'processed', $7::uuid)`,
        [
          stagingId,
          sheetId,
          sourceRow,
          `A${sourceRow}:T${sourceRow}`,
          JSON.stringify({ synthetic: true, source_row_number: sourceRow }),
          sourceRow.toString(16).padStart(64, '0'),
          ADMIN_ID,
        ],
      );
    }
    for (const [index, line] of plan.material_lines.entries()) {
      const lineId = fixtureUuid(5500, index + 1);
      lineByGrain.set(`${line.project_item_id}\0${line.competence_month}`, lineId);
      await client.query(
        `insert into ltc_m.financial_plan_lines (
           id, plan_version_id, project_id, project_item_id, metric_type,
           planning_level, competence_month, amount, currency_code, created_by_user_id
         ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'billing_planned',
           'item', $5::date, $6::numeric, $7::text, $8::uuid)`,
        [
          lineId,
          PLAN_ID,
          line.project_id,
          line.project_item_id,
          line.competence_month,
          line.amount,
          line.currency_code,
          ADMIN_ID,
        ],
      );
    }
    await client.query(
      `insert into ltc_m.monthly_source_artifacts (
         id, source_sha256, source_size_bytes, source_mime_type, source_name,
         source_contract_version, worksheet_key, worksheet_name, structural_range,
         source_semantic_fingerprint, created_by_user_id
       ) values ($1::uuid, $2::text, $3::bigint,
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', $4::text,
         'ltcm.p013.source-artifact.v1', 'monthly_revenue', 'Prev. Receita Mensal',
         'A1:T52', $5::text, $6::uuid)`,
      [
        artifactId,
        source.source_sha256,
        source.source_size_bytes,
        source.source_name,
        source.source_semantic_fingerprint,
        ADMIN_ID,
      ],
    );
    await client.query(
      `insert into ltc_m.monthly_plan_baselines (
         id, plan_version_id, metric_type, planning_level, semantic_contract_version,
         semantic_fingerprint, created_by_user_id
       ) values ($1::uuid, $2::uuid, 'billing_planned', 'item',
         'ltcm.p013.monthly-baseline-semantic.v1', $3::text, $4::uuid)`,
      [baselineId, PLAN_ID, plan.baseline_semantic_fingerprint, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.monthly_plan_import_executions (
         id, import_batch_id, source_artifact_id, source_sha256, baseline_id,
         baseline_semantic_fingerprint, plan_version_id, metric_type, planning_level,
         created_by_user_id
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::uuid, $6::text,
         $7::uuid, 'billing_planned', 'item', $8::uuid)`,
      [
        executionId,
        batchId,
        artifactId,
        source.source_sha256,
        baselineId,
        plan.baseline_semantic_fingerprint,
        PLAN_ID,
        ADMIN_ID,
      ],
    );
    for (const [index, cell] of plan.cells.entries()) {
      const financialLineId =
        cell.declaration_state === 'blank'
          ? null
          : lineByGrain.get(`${cell.project_item_id}\0${cell.competence_month}`)!;
      await client.query(
        `insert into ltc_m.monthly_plan_cells (
           id, import_batch_id, import_batch_sheet_id, import_staging_row_id,
           baseline_id, baseline_semantic_fingerprint, plan_version_id, project_id,
           project_item_id, metric_type, planning_level, competence_month,
           source_line_key, source_item_number, source_row_number, source_column,
           source_cell_reference, declaration_state, source_numeric_text,
           source_value_hash, canonical_amount, financial_plan_line_id, created_by_user_id
         ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::text,
           $7::uuid, $8::uuid, $9::uuid, 'billing_planned', 'item', $10::date,
           $11::text, $12::text, $13::integer, $14::text, $15::text, $16::text,
           $17::text, $18::text, $19::numeric, $20::uuid, $21::uuid)`,
        [
          fixtureUuid(5600, index + 1),
          batchId,
          sheetId,
          stagingByRow.get(cell.source_row_number),
          baselineId,
          plan.baseline_semantic_fingerprint,
          PLAN_ID,
          cell.project_id,
          cell.project_item_id,
          cell.competence_month,
          cell.source_line_key,
          cell.source_item_number,
          cell.source_row_number,
          cell.source_column,
          cell.source_cell_reference,
          cell.declaration_state,
          cell.source_numeric_text,
          cell.source_value_hash,
          cell.canonical_amount,
          financialLineId,
          ADMIN_ID,
        ],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}

async function counts(client: PoolClient): Promise<Record<string, unknown>> {
  return (
    (
      await client.query(`select
    (select count(*)::integer from ltc_m.projects) as projects,
    (select count(*)::integer from ltc_m.project_items) as items,
    (select count(*)::integer from ltc_m.plan_versions) as plans,
    (select count(*)::integer from ltc_m.financial_plan_scopes) as scopes,
    (select count(*)::integer from ltc_m.financial_plan_lines) as financial_lines,
    (select count(*)::integer from ltc_m.import_batches) as import_batches,
    (select count(*)::integer from ltc_m.import_batch_sheets) as import_sheets,
    (select count(*)::integer from ltc_m.import_staging_rows) as staging_rows,
    (select count(*)::integer from ltc_m.monthly_source_artifacts) as artifacts,
    (select count(*)::integer from ltc_m.monthly_plan_baselines) as baselines,
    (select count(*)::integer from ltc_m.monthly_plan_import_executions) as executions,
    (select count(*)::integer from ltc_m.monthly_plan_cells) as monthly_cells,
    (select count(*)::integer from ltc_m.audit_log) as audit_rows`)
    ).rows[0] ?? {}
  );
}

test(
  'P013 D04A executa dry-run real sob runtime, READ ONLY, no-op e conflito',
  { skip: !ENABLED },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl(), max: 2 });
    let adapter: ReturnType<typeof createP013LocalPostgresDryRunAdapter> | undefined;
    let invalidAdapter: ReturnType<typeof createP013LocalPostgresDryRunAdapter> | undefined;
    try {
      await rebuildFromZero(pool);
      const client = await pool.connect();
      try {
        await setupFixtures(client);
        const source = await loadP013CertifiedMonthlySource(await localSourcePath());
        const before = await counts(client);
        await createRuntimeLogin(client);
        const invalidRuntimeUrl = new URL(runtimeDatabaseUrl());
        const passwordSentinel = 'P013_D04A_DATABASE_PASSWORD_SENTINEL';
        invalidRuntimeUrl.password = passwordSentinel;
        invalidAdapter = createP013LocalPostgresDryRunAdapter({
          databaseUrl: invalidRuntimeUrl.toString(),
        });
        await assert.rejects(
          runP013MonthlyBaselineDryRun({
            source,
            adapter: invalidAdapter,
            actor: {
              app_user_id: ADMIN_ID,
              auth_subject: 'ci-p013-d03|admin',
              request_id: 'p013-d04a-invalid-connection',
              justification: null,
              source: 'import',
            },
            targetPlanVersionId: PLAN_ID,
          }),
          (error: unknown) =>
            error instanceof Error &&
            error.message === 'P013_DRY_RUN_FAILED' &&
            !String(error).includes(passwordSentinel) &&
            !String(error).includes(RUNTIME_LOGIN),
        );
        await invalidAdapter.close();
        adapter = createP013LocalPostgresDryRunAdapter({
          databaseUrl: runtimeDatabaseUrl(),
        });
        const first = await runP013MonthlyBaselineDryRun({
          source,
          adapter,
          actor: {
            app_user_id: ADMIN_ID,
            auth_subject: 'ci-p013-d03|admin',
            request_id: 'p013-d04a-first',
            justification: null,
            source: 'import',
          },
          targetPlanVersionId: PLAN_ID,
        });
        const after = await counts(client);
        assert.deepEqual(after, before);
        assert.equal(before['projects'], 9);
        assert.equal(before['items'], 48);
        assert.equal(before['plans'], 1);
        assert.equal(before['scopes'], 9);
        assert.equal(before['financial_lines'], 0);
        assert.equal(before['import_batches'], 0);
        assert.equal(before['import_sheets'], 0);
        assert.equal(before['staging_rows'], 0);
        assert.equal(before['artifacts'], 0);
        assert.equal(before['baselines'], 0);
        assert.equal(before['executions'], 0);
        assert.equal(before['monthly_cells'], 0);
        assert.equal(first.receipt.status, 'ready');
        assert.equal(first.receipt.position_count, 432);
        assert.equal(first.receipt.material_line_count, 102);
        assert.equal(first.receipt.select_statement_count, 6);
        assert.equal(first.receipt.write_statement_count, 0);
        assert.equal(first.receipt.transaction_read_only, true);
        assert.deepEqual(first.receipt.statement_evidence, {
          transaction_control: 2,
          set_role: 1,
          runtime_attestation: 2,
          actor_context: 1,
          authorization_attestation: 1,
          read_only_attestation: 1,
          business_select: 1,
          insert: 0,
          update: 0,
          delete: 0,
          ddl: 0,
        });
        assert.ok(first.plan);
        assert.equal(first.plan.item_reconciliation.length, 48);
        assert.doesNotThrow(() =>
          assertP013CertifiedMonthlyBaselinePlan({
            plan: first.plan!,
            source,
            snapshot: first.snapshot,
          }),
        );
        const second = await runP013MonthlyBaselineDryRun({
          source,
          adapter,
          actor: {
            app_user_id: ADMIN_ID,
            auth_subject: 'ci-p013-d03|admin',
            request_id: 'p013-d04a-second',
            justification: null,
            source: 'import',
          },
          targetPlanVersionId: PLAN_ID,
        });
        assert.equal(second.plan?.plan_hash, first.plan.plan_hash);
        assert.equal(second.snapshot.snapshot_fingerprint, first.snapshot.snapshot_fingerprint);
        assert.throws(
          () =>
            assertP013CertifiedMonthlyBaselinePlan({
              plan: first.plan!,
              source,
              snapshot: second.snapshot,
            }),
          /P013_PLAN_AUTHORITY_REQUIRED/u,
        );
        const replaySource = await loadP013CertifiedMonthlySource(await localSourcePath());
        assert.notEqual(replaySource, source);
        assert.equal(replaySource.source_semantic_fingerprint, source.source_semantic_fingerprint);
        assert.throws(
          () =>
            assertP013CertifiedMonthlyBaselinePlan({
              plan: first.plan!,
              source: replaySource,
              snapshot: first.snapshot,
            }),
          /P013_PLAN_AUTHORITY_REQUIRED/u,
        );
        await assert.rejects(
          runP013MonthlyBaselineDryRun({
            source,
            adapter,
            actor: {
              app_user_id: VIEWER_ID,
              auth_subject: 'ci-p013-d04a|viewer',
              request_id: 'p013-d04a-viewer',
              justification: null,
              source: 'import',
            },
            targetPlanVersionId: PLAN_ID,
          }),
          /P013_ACTOR_NOT_AUTHORIZED/u,
        );
        const protections = await client.query(
          `select relname, relrowsecurity, relforcerowsecurity
             from pg_catalog.pg_class
            where relnamespace = 'ltc_m'::regnamespace
              and relname = any($1::text[])
            order by relname`,
          [
            [
              'monthly_plan_baselines',
              'monthly_plan_cells',
              'monthly_plan_import_executions',
              'monthly_source_artifacts',
            ],
          ],
        );
        assert.equal(protections.rowCount, 4);
        assert.equal(
          protections.rows.every(
            (row) => row['relrowsecurity'] === true && row['relforcerowsecurity'] === true,
          ),
          true,
        );
        const role = await client.query(
          `select rolsuper, rolbypassrls from pg_catalog.pg_roles where rolname = $1::text`,
          [RUNTIME_LOGIN],
        );
        assert.deepEqual(role.rows[0], { rolsuper: false, rolbypassrls: false });
        const runtimePool = new Pool({ connectionString: runtimeDatabaseUrl(), max: 1 });
        const runtimeClient = await runtimePool.connect();
        try {
          await runtimeClient.query('begin transaction read only');
          await runtimeClient.query('set local role ltc_m_runtime');
          await runtimeClient.query(
            `select ltc_m.set_actor_context($1::uuid, $2::text, $3::text, null, 'import', false)`,
            [ADMIN_ID, 'ci-p013-d03|admin', 'p013-d04a-read-only-mutation'],
          );
          await assert.rejects(
            runtimeClient.query(
              `insert into ltc_m.monthly_source_artifacts (
                 source_sha256, source_size_bytes, source_mime_type, source_name,
                 source_contract_version, worksheet_key, worksheet_name, structural_range,
                 source_semantic_fingerprint, created_by_user_id
               ) values ($1::text, 1,
                 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                 'read-only-proof.xlsx', 'ltcm.p013.source-artifact.v1', 'monthly_revenue',
                 'Prev. Receita Mensal', 'A1:T52', $2::text, $3::uuid)`,
              ['d'.repeat(64), 'e'.repeat(64), ADMIN_ID],
            ),
            (error: unknown) =>
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              error.code === '25006',
          );
          await runtimeClient.query('rollback');
        } finally {
          runtimeClient.release();
          await runtimePool.end();
        }
        await persistMatchingBaseline(client, source, first.plan);
        const persistedBefore = await counts(client);
        const noOp = await runP013MonthlyBaselineDryRun({
          source,
          adapter,
          actor: {
            app_user_id: ADMIN_ID,
            auth_subject: 'ci-p013-d03|admin',
            request_id: 'p013-d04a-no-op',
            justification: null,
            source: 'import',
          },
          targetPlanVersionId: PLAN_ID,
        });
        assert.equal(noOp.receipt.status, 'no_op_candidate');
        assert.equal(
          noOp.plan?.baseline_semantic_fingerprint,
          first.plan.baseline_semantic_fingerprint,
        );
        assert.deepEqual(await counts(client), persistedBefore);
        await client.query('begin');
        try {
          await client.query(
            `select ltc_m.set_actor_context($1::uuid, 'ci-p013-d03|admin',
              'p013-d04a-divergent-line', null, 'import', false)`,
            [ADMIN_ID],
          );
          const blankCell = first.plan.cells.find((cell) => cell.declaration_state === 'blank')!;
          await client.query(
            `insert into ltc_m.financial_plan_lines (
               id, plan_version_id, project_id, project_item_id, metric_type,
               planning_level, competence_month, amount, currency_code, created_by_user_id
             ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'billing_planned',
               'item', $5::date, 999.99, 'BRL', $6::uuid)`,
            [
              fixtureUuid(5700, 1),
              PLAN_ID,
              blankCell.project_id,
              blankCell.project_item_id,
              blankCell.competence_month,
              ADMIN_ID,
            ],
          );
          await client.query('commit');
        } catch (error) {
          await client.query('rollback').catch(() => undefined);
          throw error;
        }
        const divergentBefore = await counts(client);
        const divergent = await runP013MonthlyBaselineDryRun({
          source,
          adapter,
          actor: {
            app_user_id: ADMIN_ID,
            auth_subject: 'ci-p013-d03|admin',
            request_id: 'p013-d04a-divergent',
            justification: null,
            source: 'import',
          },
          targetPlanVersionId: PLAN_ID,
        });
        assert.equal(divergent.receipt.status, 'conflict');
        assert.match(divergent.receipt.diagnostics.join('\n'), /P013_EXISTING_BASELINE_CONFLICT/u);
        assert.deepEqual(await counts(client), divergentBefore);
        await assert.rejects(
          client.query(
            `update ltc_m.monthly_plan_cells
                set baseline_id = $1::uuid
              where id = (select id from ltc_m.monthly_plan_cells order by id limit 1)`,
            [fixtureUuid(5700, 2)],
          ),
        );
        await adapter.close();
        await dropRuntimeLogin(client);
        const residual = await client.query(
          `select
             (select count(*)::integer from pg_catalog.pg_stat_activity
               where usename = $1::text) as sessions,
             (select count(*)::integer
                from pg_catalog.pg_locks as locks
                join pg_catalog.pg_stat_activity as activity on activity.pid = locks.pid
               where activity.usename = $1::text) as locks`,
          [RUNTIME_LOGIN],
        );
        assert.deepEqual(residual.rows[0], { sessions: 0, locks: 0 });
      } finally {
        await adapter?.close().catch(() => undefined);
        await invalidAdapter?.close().catch(() => undefined);
        await dropRuntimeLogin(client).catch(() => undefined);
        client.release();
      }
    } finally {
      await rebuildFromZero(pool).catch(() => undefined);
      await pool.end();
    }
  },
);
