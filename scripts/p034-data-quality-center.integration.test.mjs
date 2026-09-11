import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Client, Pool } from 'pg';

import { QualityService } from '../apps/api/dist/src/quality/quality.service.js';
import { parseQualityQuery } from '../apps/api/dist/src/quality/quality.types.js';

const ENABLED = process.env.LTCM_P034_FUNCTIONAL_INTEGRATION === '1';
const DATABASE_URL = process.env.LTCM_P034_DATABASE_URL;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_ID = '00000000-0000-4000-8000-000000034101';
const CLIENT_ID = '00000000-0000-4000-8000-000000034102';
const APPROVER_ID = '00000000-0000-4000-8000-000000034103';
const PROJECTS = Object.freeze({
  active: '00000000-0000-4000-8000-000000034111',
  completed: '00000000-0000-4000-8000-000000034112',
  onHold: '00000000-0000-4000-8000-000000034113',
  draft: '00000000-0000-4000-8000-000000034114',
  cancelled: '00000000-0000-4000-8000-000000034115',
  deleted: '00000000-0000-4000-8000-000000034116',
  partial: '00000000-0000-4000-8000-000000034117',
  plan: '00000000-0000-4000-8000-000000034118',
});
const ITEM_IDS = Object.freeze({
  valid: '00000000-0000-4000-8000-000000034121',
  grain: '00000000-0000-4000-8000-000000034122',
  inactiveGrain: '00000000-0000-4000-8000-000000034123',
  deletedGrain: '00000000-0000-4000-8000-000000034124',
});
const SOURCE_LINE_KEY = `p012-line-v1:${'a'.repeat(64)}`;
const ACTIVE_SNAPSHOT_ID = '00000000-0000-4000-8000-111111111102';
const ACTIVE_SOURCE_SUFFIX = '1111111111';
const SEED_SQL = path.join(ROOT, 'supabase', 'seed.sql');

function databaseUrl() {
  if (!DATABASE_URL) throw new Error('P034_FUNCTIONAL_DATABASE_ENV_MISSING');
  const parsed = new URL(DATABASE_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(parsed.protocol));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase()));
  assert.ok(['/ltcm_test', '/ltcm_ci'].includes(parsed.pathname));
  assert.equal(parsed.search, '');
  assert.equal(parsed.hash, '');
  return DATABASE_URL;
}

async function migrationFiles() {
  const directory = path.join(ROOT, 'supabase', 'migrations');
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'));
  assert.equal(names.length, 19);
  return Promise.all(
    names.map(async (name) => ({ name, sql: await readFile(path.join(directory, name), 'utf8') })),
  );
}

async function rebuildDatabase(client) {
  await client.query('drop schema if exists ltc_m cascade');
  await client.query('drop role if exists ltc_m_provenance_writer');
  for (const migration of await migrationFiles()) await client.query(migration.sql);
  await client.query(
    `select ltc_m.set_actor_context(null, null, 'p034-functional-bootstrap', null, 'system', false)`,
  );
  await client.query(
    `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
     values ($1::uuid, 'ci-p034-functional|admin', 'P034 Functional Admin', 'admin', true)`,
    [ADMIN_ID],
  );
  await client.query(
    `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
     values ($1::uuid, 'ci-p034-functional|approver', 'P034 Functional Approver', 'approver', true)`,
    [APPROVER_ID],
  );
  await client.query(await readFile(SEED_SQL, 'utf8'));
}

async function insertProject(
  client,
  id,
  code,
  status,
  deleted = false,
  projectName = `Projeto ${code}`,
) {
  await client.query(
    `insert into ltc_m.projects (
       id, project_code, project_name, client_id, status, base_currency,
       contract_value, data_reference_date, created_by_user_id, deleted_at
     ) values ($1::uuid, $2::text, $3::text, $4::uuid, $5::ltc_m.project_status,
               'BRL', 1000, date '2026-09-01', $6::uuid,
               case when $7::boolean then timestamptz '2026-09-01 00:00:00+00' else null end)`,
    [id, code, projectName, CLIENT_ID, status, ADMIN_ID, deleted],
  );
}

async function insertSnapshot(client, projectId, code, revision, suffix, duplicate = false) {
  await client.query(
    `select ltc_m.set_actor_context(
       $1::uuid, 'ci-p034-functional|admin', 'p034-functional-fixture', null, 'api', false
     )`,
    [ADMIN_ID],
  );
  const batchId = `00000000-0000-4000-8000-${suffix}01`;
  const snapshotId = `00000000-0000-4000-8000-${suffix}02`;
  const projectObservationA = `00000000-0000-4000-8000-${suffix}03`;
  const projectObservationB = `00000000-0000-4000-8000-${suffix}04`;
  const itemObservationA = `00000000-0000-4000-8000-${suffix}05`;
  const itemObservationB = `00000000-0000-4000-8000-${suffix}06`;
  const hash = `${suffix}${'0'.repeat(64 - suffix.length)}`;
  await client.query(
    `insert into ltc_m.import_batches (id, source_name, source_hash, submitted_by_user_id)
     values ($1::uuid, $2::text, $3::text, $4::uuid)`,
    [batchId, `${code}.xlsx`, hash, ADMIN_ID],
  );
  await client.query(
    `insert into ltc_m.p034_provenance_snapshots
       (id, import_batch_id, project_id, source_artifact_hash, snapshot_fingerprint,
        authority_revision, captured_by_user_id, request_id, captured_at, completed_at)
     values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::bigint, $7::uuid,
             $8::text, timestamptz '2026-09-10 00:00:00+00', timestamptz '2026-09-10 00:00:01+00')`,
    [
      snapshotId,
      batchId,
      projectId,
      hash,
      `${suffix}${'1'.repeat(64 - suffix.length)}`,
      revision,
      ADMIN_ID,
      'p034-functional-fixture',
    ],
  );
  await client.query(
    `insert into ltc_m.p034_provenance_project_observations
       (id, snapshot_id, project_id, project_code, occurrence_ordinal, occurrence_fingerprint)
     values ($1::uuid, $2::uuid, $3::uuid, $4::text, 1, $5::text)`,
    [
      projectObservationA,
      snapshotId,
      projectId,
      code,
      `${suffix}${'2'.repeat(64 - suffix.length)}`,
    ],
  );
  await client.query(
    `insert into ltc_m.p034_provenance_source_references
       (project_id, project_observation_id, reference_ordinal, kind, locator, fingerprint)
     values ($1::uuid, $2::uuid, 1, 'source', $3::text, $4::text)`,
    [
      projectId,
      projectObservationA,
      `${code}!${code === 'P034-A' ? 'A6' : 'A1'}`,
      `${suffix}${'3'.repeat(64 - suffix.length)}`,
    ],
  );
  if (!duplicate) return;
  await client.query(
    `insert into ltc_m.p034_provenance_project_observations
       (id, snapshot_id, project_id, project_code, occurrence_ordinal, occurrence_fingerprint)
     values ($1::uuid, $2::uuid, $3::uuid, $4::text, 2, $5::text)`,
    [
      projectObservationB,
      snapshotId,
      projectId,
      code,
      `${suffix}${'4'.repeat(64 - suffix.length)}`,
    ],
  );
  await client.query(
    `insert into ltc_m.p034_provenance_source_references
       (project_id, project_observation_id, reference_ordinal, kind, locator, fingerprint)
     values ($1::uuid, $2::uuid, 1, 'source', $3::text, $4::text)`,
    [
      projectId,
      projectObservationB,
      `${code}!${code === 'P034-A' ? 'A7' : 'A2'}`,
      `${suffix}${'5'.repeat(64 - suffix.length)}`,
    ],
  );
  await client.query(
    `insert into ltc_m.p034_provenance_item_observations
       (id, snapshot_id, project_id, project_code, source_line_key, item_id,
        occurrence_ordinal, occurrence_fingerprint)
     values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, null, 1, $6::text),
            ($7::uuid, $2::uuid, $3::uuid, $4::text, $5::text, null, 2, $8::text)`,
    [
      itemObservationA,
      snapshotId,
      projectId,
      code,
      SOURCE_LINE_KEY,
      `${suffix}${'6'.repeat(64 - suffix.length)}`,
      itemObservationB,
      `${suffix}${'7'.repeat(64 - suffix.length)}`,
    ],
  );
  await client.query(
    `insert into ltc_m.p034_provenance_source_references
       (project_id, item_observation_id, reference_ordinal, kind, locator, fingerprint)
     values ($1::uuid, $2::uuid, 1, 'source', $3::text, $4::text),
            ($1::uuid, $5::uuid, 1, 'source', $6::text, $7::text)`,
    [
      projectId,
      itemObservationA,
      `${code}!B1`,
      `${suffix}${'8'.repeat(64 - suffix.length)}`,
      itemObservationB,
      `${code}!B2`,
      `${suffix}${'9'.repeat(64 - suffix.length)}`,
    ],
  );
}

async function insertFixtures(client) {
  await client.query(
    `select ltc_m.set_actor_context($1::uuid, 'ci-p034-functional|admin', 'p034-functional-fixture', null, 'api', false)`,
    [ADMIN_ID],
  );
  await client.query(
    `insert into ltc_m.clients (id, legal_name, display_name, created_by_user_id)
     values ($1::uuid, 'Cliente P034 Functional', 'Cliente P034 Functional', $2::uuid)`,
    [CLIENT_ID, ADMIN_ID],
  );
  await insertProject(
    client,
    PROJECTS.active,
    'P034-A',
    'active',
    false,
    `Projeto P034-A literal % _ ${String.fromCharCode(92)}`,
  );
  await insertProject(client, PROJECTS.completed, 'P034-B', 'completed');
  await insertProject(client, PROJECTS.onHold, 'P034-C', 'on_hold');
  await insertProject(client, PROJECTS.draft, 'P034-D', 'draft');
  await insertProject(client, PROJECTS.cancelled, 'P034-E', 'cancelled');
  await insertProject(client, PROJECTS.deleted, 'P034-DELETED', 'active', true);
  await insertProject(client, PROJECTS.plan, 'P034-PLAN', 'active');
  await client.query(
    `update ltc_m.projects
        set updated_at = timestamptz '2026-07-01 00:00:00+00'
      where id in ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
    [PROJECTS.completed, PROJECTS.onHold, PROJECTS.draft, PROJECTS.cancelled],
  );
  await insertSnapshot(client, PROJECTS.active, 'P034-A', 1, '1111111111', true);
  await insertSnapshot(client, PROJECTS.completed, 'P034-B', 1, '2222222222');
  await insertSnapshot(client, PROJECTS.onHold, 'P034-C', 1, '3333333333');
  await insertSnapshot(client, PROJECTS.draft, 'P034-D', 1, '4444444444');
  await insertSnapshot(client, PROJECTS.cancelled, 'P034-E', 1, '5555555555');
  await insertSnapshot(client, PROJECTS.plan, 'P034-PLAN', 1, '6666666666');
  await client.query(
    `insert into ltc_m.project_items
       (id, project_id, source_line_key, line_number, item_code, description, quantity,
        unit_code, currency_code, unit_price, created_by_user_id)
     values ($1::uuid, $2::uuid, $3::text, 1, 'PLAN-1', 'Plano válido', 1, 'US', 'BRL', 1, $4::uuid)`,
    [ITEM_IDS.valid, PROJECTS.plan, `p012-line-v1:${'b'.repeat(64)}`, ADMIN_ID],
  );
  await client.query(`set session_replication_role = replica`);
  await client.query(
    `insert into ltc_m.project_items
       (id, project_id, source_line_key, line_number, item_code, description, quantity,
        unit_code, currency_code, unit_price, active, deleted_at, created_by_user_id)
     values ($1::uuid, $2::uuid, 'p012-line-v1:${'c'.repeat(64)}', 2, 'GRAIN-1', 'GRAIN ativo', 1, 'US', 'USD', 1, true, null, $3::uuid),
            ($4::uuid, $2::uuid, 'p012-line-v1:${'d'.repeat(64)}', 3, 'GRAIN-2', 'GRAIN inativo', 1, 'US', 'USD', 1, false, null, $3::uuid),
            ($5::uuid, $2::uuid, 'p012-line-v1:${'e'.repeat(64)}', 4, 'GRAIN-3', 'GRAIN deleted', 1, 'US', 'USD', 1, true, timestamptz '2026-09-01 00:00:00+00', $3::uuid)`,
    [ITEM_IDS.grain, PROJECTS.active, ADMIN_ID, ITEM_IDS.inactiveGrain, ITEM_IDS.deletedGrain],
  );
  await client.query(`set session_replication_role = origin`);
  await client.query(
    `insert into ltc_m.plan_versions
       (id, name, reference_date, status, created_by_user_id)
     values ('00000000-0000-4000-8000-000000034131', 'P034 Functional Plan A', date '2026-09-01', 'draft', $1::uuid)`,
    [ADMIN_ID],
  );
  await client.query(
    `insert into ltc_m.financial_plan_scopes
       (plan_version_id, project_id, metric_type, planning_level, currency_code, created_by_user_id)
     values ('00000000-0000-4000-8000-000000034131', $1::uuid, 'billing_planned', 'item', 'BRL', $2::uuid)`,
    [PROJECTS.plan, ADMIN_ID],
  );
  await client.query(
    `insert into ltc_m.financial_plan_lines
       (plan_version_id, project_id, project_item_id, metric_type, planning_level,
        competence_month, amount, currency_code, created_by_user_id)
     values ('00000000-0000-4000-8000-000000034131', $1::uuid, $2::uuid, 'billing_planned', 'item', date '2026-09-01', 100, 'BRL', $3::uuid)`,
    [PROJECTS.plan, ITEM_IDS.valid, ADMIN_ID],
  );
  await client.query(
    `select ltc_m.set_actor_context(
       $1::uuid, 'ci-p034-functional|admin', 'p034-functional-fixture', null, 'api', false
     )`,
    [ADMIN_ID],
  );
  await client.query(
    `select * from ltc_m.submit_plan_version(
       '00000000-0000-4000-8000-000000034131'::uuid, 1::bigint
     )`,
  );
  await client.query(
    `select ltc_m.set_actor_context(
       $1::uuid, 'ci-p034-functional|approver', 'p034-functional-approval-a', 'P034 fixture approval', 'api', false
     )`,
    [APPROVER_ID],
  );
  await client.query(
    `select * from ltc_m.approve_plan_version_as_approver(
       '00000000-0000-4000-8000-000000034131'::uuid, 2::bigint
     )`,
  );
  await client.query(
    `select ltc_m.set_actor_context(
       $1::uuid, 'ci-p034-functional|admin', 'p034-functional-fixture', null, 'api', false
     )`,
    [ADMIN_ID],
  );
}

async function insertApprovedPlan(client, versionId, name, projectId, itemId = null) {
  await client.query(
    `insert into ltc_m.plan_versions
       (id, name, reference_date, status, created_by_user_id)
     values ($1::uuid, $2::text, date '2026-09-01', 'draft', $3::uuid)`,
    [versionId, name, ADMIN_ID],
  );
  await client.query(
    `insert into ltc_m.financial_plan_scopes
       (plan_version_id, project_id, metric_type, planning_level, currency_code, created_by_user_id)
     values ($1::uuid, $2::uuid, 'billing_planned', 'item', 'BRL', $3::uuid)`,
    [versionId, projectId, ADMIN_ID],
  );
  if (itemId) {
    await client.query(
      `insert into ltc_m.financial_plan_lines
         (plan_version_id, project_id, project_item_id, metric_type, planning_level,
          competence_month, amount, currency_code, created_by_user_id)
       values ($1::uuid, $2::uuid, $3::uuid, 'billing_planned', 'item', date '2026-09-01', 100, 'BRL', $4::uuid)`,
      [versionId, projectId, itemId, ADMIN_ID],
    );
  }
  await client.query(
    `select ltc_m.set_actor_context(
       $1::uuid, 'ci-p034-functional|admin', 'p034-functional-fixture', null, 'api', false
     )`,
    [ADMIN_ID],
  );
  await client.query(`select * from ltc_m.submit_plan_version($1::uuid, 1::bigint)`, [versionId]);
  await client.query(
    `select ltc_m.set_actor_context(
       $1::uuid, 'ci-p034-functional|approver', $2::text, 'P034 fixture approval', 'api', false
     )`,
    [APPROVER_ID, `p034-functional-approval-${versionId.slice(-2)}`],
  );
  await client.query(`select * from ltc_m.approve_plan_version_as_approver($1::uuid, 2::bigint)`, [
    versionId,
  ]);
  await client.query(
    `select ltc_m.set_actor_context(
       $1::uuid, 'ci-p034-functional|admin', 'p034-functional-fixture', null, 'api', false
     )`,
    [ADMIN_ID],
  );
}

function actorTransaction(pool) {
  return {
    actorTransaction: async (_actor, operation) => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(
          `select ltc_m.set_actor_context($1::uuid, 'ci-p034-functional|admin', 'p034-functional-read', null, 'api', false)`,
          [ADMIN_ID],
        );
        const result = await operation(client);
        await client.query('rollback');
        return result;
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function expectUnavailable(operation) {
  await assert.rejects(operation, /P034_PROVENANCE_SNAPSHOT_UNAVAILABLE/u);
}

function compareLexical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function publicPairOrder(projectId, itemId) {
  return [
    { kind: 'project', id: projectId },
    { kind: 'item', id: itemId },
  ]
    .sort((left, right) => compareLexical(left.id, right.id))
    .map(({ kind }) => kind);
}

function sourceFingerprint(suffix, digit) {
  return `${suffix}${String(digit).repeat(64 - suffix.length)}`;
}

function searchableFields(finding) {
  return [
    finding.project.code,
    finding.project.name,
    finding.rule.code,
    finding.rule.label,
    finding.origin.entity,
    finding.origin.findingOrigin,
  ].filter((value) => typeof value === 'string');
}

function assertLiteralSearch(response, literal) {
  assert.ok(response.totalItems > 0);
  assert.ok(
    response.items.every((finding) =>
      searchableFields(finding).some((value) => value.includes(literal)),
    ),
  );
}

test(
  'P034 functional PostgreSQL valida escopo, cobertura, GRAIN, planos e paginação',
  { skip: !ENABLED },
  async () => {
    const admin = new Client({ connectionString: databaseUrl() });
    await admin.connect();
    const pool = new Pool({ connectionString: databaseUrl(), max: 2 });
    const actor = {
      appUserId: ADMIN_ID,
      authSubject: 'ci-p034-functional|admin',
      requestId: 'p034-functional-read',
      source: 'api',
    };
    try {
      await rebuildDatabase(admin);
      await admin.query('begin');
      await insertFixtures(admin);
      await admin.query('commit');

      const service = new QualityService(actorTransaction(pool), {
        now: () => new Date('2026-09-11T12:00:00.000Z'),
      });
      const all = await service.list(parseQualityQuery({}), actor);
      assert.ok(all.items.length > 0);
      assert.ok(all.items.every((finding) => finding.project.code !== 'P034-DELETED'));
      assert.ok(all.items.some((finding) => finding.project.code === 'P034-B'));
      assert.ok(all.items.some((finding) => finding.project.code === 'P034-C'));
      assert.ok(all.items.some((finding) => finding.project.code === 'P034-E'));

      const grain = await service.list(parseQualityQuery({ rule: 'GRAIN_MISMATCH' }), actor);
      assert.equal(grain.totalItems, 1);
      assert.equal(grain.items.length, 1);
      assert.ok(grain.items.every((finding) => finding.rule.code === 'GRAIN_MISMATCH'));
      assert.equal(grain.items[0]?.project.code, 'P034-A');
      assert.equal(grain.items[0]?.currencyCode, 'USD');
      const nonGrainRule = await service.list(
        parseQualityQuery({ rule: 'DUPLICATE_ITEM_SOURCE_IDENTITY' }),
        actor,
      );
      assert.equal(nonGrainRule.totalItems, 1);
      assert.ok(nonGrainRule.items.every((finding) => finding.rule.code !== 'GRAIN_MISMATCH'));
      process.stdout.write('P034_FUNCTIONAL_RULE_FILTER_EXACTLY_PROVEN\n');

      const errors = await service.list(parseQualityQuery({ severity: 'ERROR' }), actor);
      assert.ok(errors.totalItems > 0);
      assert.ok(errors.items.every((finding) => finding.severity === 'ERROR'));
      const blocking = await service.list(parseQualityQuery({ severity: 'BLOCKING' }), actor);
      assert.equal(blocking.totalItems, 0);
      assert.deepEqual(blocking.items, []);
      process.stdout.write('P034_FUNCTIONAL_SEVERITY_FILTER_EXACTLY_PROVEN\n');

      const grainOrigin = await service.list(
        parseQualityQuery({ rule: 'GRAIN_MISMATCH', origin: 'project_item' }),
        actor,
      );
      assert.equal(grainOrigin.totalItems, 1);
      assert.ok(grainOrigin.items.every((finding) => finding.origin.entity === 'project_item'));
      const incompatibleGrainOrigin = await service.list(
        parseQualityQuery({ rule: 'GRAIN_MISMATCH', origin: 'project' }),
        actor,
      );
      assert.equal(incompatibleGrainOrigin.totalItems, 0);
      assert.deepEqual(incompatibleGrainOrigin.items, []);

      const normalSearch = await service.list(parseQualityQuery({ search: 'P034-A' }), actor);
      assert.ok(normalSearch.totalItems > 0);
      assert.ok(normalSearch.items.every((finding) => finding.project.code === 'P034-A'));
      const literalPercent = await service.list(parseQualityQuery({ search: '%' }), actor);
      assertLiteralSearch(literalPercent, '%');
      assert.ok(literalPercent.items.some((finding) => finding.project.name.includes('%')));
      const literalUnderscore = await service.list(parseQualityQuery({ search: '_' }), actor);
      assertLiteralSearch(literalUnderscore, '_');
      assert.ok(literalUnderscore.items.some((finding) => finding.project.name.includes('_')));
      const literalBackslash = await service.list(
        parseQualityQuery({ search: String.fromCharCode(92) }),
        actor,
      );
      assertLiteralSearch(literalBackslash, String.fromCharCode(92));
      assert.ok(
        literalBackslash.items.some((finding) =>
          finding.project.name.includes(String.fromCharCode(92)),
        ),
      );
      const missingSearch = await service.list(
        parseQualityQuery({ search: 'P034-NOT-IN-FIXTURE' }),
        actor,
      );
      assert.equal(missingSearch.totalItems, 0);
      assert.deepEqual(missingSearch.items, []);
      const combined = await service.list(
        parseQualityQuery({
          rule: 'GRAIN_MISMATCH',
          severity: 'ERROR',
          origin: 'project_item',
          search: 'P034-A',
        }),
        actor,
      );
      assert.equal(combined.totalItems, 1);
      assert.equal(combined.items[0]?.rule.code, 'GRAIN_MISMATCH');
      assert.equal(combined.items[0]?.severity, 'ERROR');
      assert.equal(combined.items[0]?.origin.entity, 'project_item');
      assert.equal(combined.items[0]?.project.code, 'P034-A');
      process.stdout.write('P034_FUNCTIONAL_SEARCH_ESCAPING_POSTGRES_PROVEN\n');

      const projectOnly = await service.list(
        parseQualityQuery({ projectId: PROJECTS.active }),
        actor,
      );
      assert.ok(projectOnly.items.every((finding) => finding.project.id === PROJECTS.active));
      const hiddenOrMissing = await service.list(
        parseQualityQuery({ projectId: '00000000-0000-4000-8000-000000034199' }),
        actor,
      );
      assert.deepEqual(hiddenOrMissing.items, []);

      assert.equal(grain.items[0]?.navigationAction?.target, 'project_item');
      assert.equal(
        grain.items.some((finding) => finding.project.code === 'P034-DELETED'),
        false,
      );

      const duplicateProject = await service.list(
        parseQualityQuery({ rule: 'DUPLICATE_PROJECT_SOURCE_IDENTITY' }),
        actor,
      );
      assert.equal(duplicateProject.totalItems, 1);
      assert.equal(duplicateProject.items.length, 1);
      assert.equal(duplicateProject.items[0]?.rule.code, 'DUPLICATE_PROJECT_SOURCE_IDENTITY');
      assert.match(duplicateProject.items[0]?.id ?? '', /^p015-finding-v1:/u);
      assert.equal(duplicateProject.items[0]?.project.code, 'P034-A');
      assert.deepEqual(
        duplicateProject.items[0]?.origin.sourceReferences?.map((reference) => reference.locator),
        ['P034-A!A6', 'P034-A!A7'],
      );
      assert.deepEqual(
        duplicateProject.items[0]?.origin.sourceReferences?.map(
          (reference) => reference.fingerprint,
        ),
        [sourceFingerprint(ACTIVE_SOURCE_SUFFIX, 3), sourceFingerprint(ACTIVE_SOURCE_SUFFIX, 5)],
      );

      const duplicateItem = await service.list(
        parseQualityQuery({ rule: 'DUPLICATE_ITEM_SOURCE_IDENTITY' }),
        actor,
      );
      assert.equal(duplicateItem.totalItems, 1);
      assert.equal(duplicateItem.items.length, 1);
      assert.equal(duplicateItem.items[0]?.rule.code, 'DUPLICATE_ITEM_SOURCE_IDENTITY');
      assert.equal(duplicateItem.items[0]?.severity, 'ERROR');
      assert.equal(duplicateItem.items[0]?.project.code, 'P034-A');
      assert.match(duplicateItem.items[0]?.id ?? '', /^p015-finding-v1:/u);
      assert.deepEqual(
        duplicateItem.items[0]?.origin.sourceReferences?.map((reference) => reference.locator),
        ['P034-A!B1', 'P034-A!B2'],
      );
      assert.deepEqual(
        duplicateItem.items[0]?.origin.sourceReferences?.map((reference) => reference.fingerprint),
        [sourceFingerprint(ACTIVE_SOURCE_SUFFIX, 8), sourceFingerprint(ACTIVE_SOURCE_SUFFIX, 9)],
      );
      process.stdout.write('P034_FUNCTIONAL_DUPLICATE_ITEM_POSTGRES_PROVEN\n');

      const temporaryProjectId = `p034-provenance-project:${ACTIVE_SNAPSHOT_ID}:P034-A`;
      const temporaryItemId = `p034-provenance-item:${ACTIVE_SNAPSHOT_ID}:P034-A:${SOURCE_LINE_KEY}`;
      const temporaryOrder = publicPairOrder(temporaryProjectId, temporaryItemId);
      const expectedPublicOrder = [duplicateProject.items[0].id, duplicateItem.items[0].id].sort(
        compareLexical,
      );
      const actualPublicOrder = publicPairOrder(
        duplicateProject.items[0].id,
        duplicateItem.items[0].id,
      );
      assert.notDeepEqual(temporaryOrder, actualPublicOrder);
      assert.deepEqual(
        expectedPublicOrder,
        [duplicateProject.items[0].id, duplicateItem.items[0].id].sort(compareLexical),
      );
      process.stdout.write('P034_PUBLIC_ID_ADVERSARIAL_ORDER_INVERSION_PROVEN\n');

      const fullDataset = await service.list(
        parseQualityQuery({ sort: 'rule', order: 'asc', pageSize: '100' }),
        actor,
      );
      const allPublicIds = fullDataset.items.map((finding) => finding.id);
      assert.equal(fullDataset.totalItems, allPublicIds.length);
      assert.ok(allPublicIds.length > 1);
      const expectedAsc = [...allPublicIds].sort(compareLexical);
      const expectedDesc = [...expectedAsc].reverse();
      const actualAsc = await service.list(
        parseQualityQuery({ sort: 'id', order: 'asc', pageSize: '100' }),
        actor,
      );
      assert.deepEqual(
        actualAsc.items.map((finding) => finding.id),
        expectedAsc,
      );
      assert.equal(actualAsc.totalItems, expectedAsc.length);
      const actualDesc = await service.list(
        parseQualityQuery({ sort: 'id', order: 'desc', pageSize: '100' }),
        actor,
      );
      assert.deepEqual(
        actualDesc.items.map((finding) => finding.id),
        expectedDesc,
      );
      assert.equal(actualDesc.totalItems, expectedDesc.length);
      process.stdout.write('P034_PUBLIC_ID_FULL_ORDER_POSTGRES_PROVEN\n');

      for (const [index, expectedId] of expectedAsc.entries()) {
        const page = await service.list(
          parseQualityQuery({ sort: 'id', order: 'asc', pageSize: '1', page: String(index + 1) }),
          actor,
        );
        assert.equal(page.items.length, 1);
        assert.equal(page.items[0]?.id, expectedId);
        assert.equal(page.totalItems, expectedAsc.length);
        assert.equal(page.totalPages, expectedAsc.length);
      }
      const firstDesc = await service.list(
        parseQualityQuery({ sort: 'id', order: 'desc', pageSize: '1' }),
        actor,
      );
      assert.equal(firstDesc.items.length, 1);
      assert.equal(firstDesc.items[0]?.id, expectedDesc[0]);
      assert.equal(firstDesc.totalItems, expectedDesc.length);
      assert.equal(firstDesc.totalPages, expectedDesc.length);
      process.stdout.write('P034_PUBLIC_ID_PAGE_BOUNDARY_POSTGRES_PROVEN\n');

      for (const [kind, findingId] of [
        ['project', duplicateProject.items[0].id],
        ['item', duplicateItem.items[0].id],
      ]) {
        const pageNumber = expectedAsc.indexOf(findingId) + 1;
        assert.ok(pageNumber > 0, `missing ${kind} duplicate from expected public order`);
        const page = await service.list(
          parseQualityQuery({ sort: 'id', order: 'asc', pageSize: '1', page: String(pageNumber) }),
          actor,
        );
        assert.equal(page.items[0]?.id, findingId);
      }

      await admin.query('begin');
      await insertSnapshot(admin, PROJECTS.active, 'P034-A', 2, '7777777777', false);
      await admin.query('commit');
      const afterLatest = await service.list(
        parseQualityQuery({ rule: 'DUPLICATE_PROJECT_SOURCE_IDENTITY' }),
        actor,
      );
      assert.equal(afterLatest.totalItems, 0);

      await admin.query('begin');
      await insertSnapshot(admin, PROJECTS.active, 'P034-A', 3, '8888888888', true);
      await admin.query('commit');
      const afterDuplicate = await service.list(
        parseQualityQuery({ rule: 'DUPLICATE_PROJECT_SOURCE_IDENTITY' }),
        actor,
      );
      assert.equal(afterDuplicate.totalItems, 1);

      const planZero = await service.list(
        parseQualityQuery({ projectId: PROJECTS.active, rule: 'UNPLANNED_BALANCE' }),
        actor,
      );
      assert.equal(planZero.totalItems, 0);
      await admin.query('begin');
      await insertApprovedPlan(
        admin,
        '00000000-0000-4000-8000-000000034132',
        'P034 Functional Plan B',
        PROJECTS.active,
        ITEM_IDS.grain,
      );
      await admin.query('commit');
      const planOne = await service.list(
        parseQualityQuery({ projectId: PROJECTS.active, rule: 'UNPLANNED_BALANCE' }),
        actor,
      );
      assert.equal(planOne.totalItems, 1);
      await admin.query('begin');
      await insertApprovedPlan(
        admin,
        '00000000-0000-4000-8000-000000034133',
        'P034 Functional Plan C',
        PROJECTS.active,
      );
      await admin.query('commit');
      const planMultiple = await service.list(
        parseQualityQuery({ projectId: PROJECTS.active, rule: 'UNPLANNED_BALANCE' }),
        actor,
      );
      assert.equal(planMultiple.totalItems, 0);
      await admin.query('begin');
      await insertProject(admin, PROJECTS.partial, 'P034-PARTIAL', 'active');
      await admin.query('commit');
      await expectUnavailable(() =>
        service.list(parseQualityQuery({ projectId: PROJECTS.partial }), actor),
      );
      await expectUnavailable(() => service.list(parseQualityQuery({}), actor));
      process.stdout.write(
        'P034_FUNCTIONAL_POSTGRES_CI_EXECUTED_NOT_SKIPPED\nP034_FUNCTIONAL_SCENARIOS_PASSED\n',
      );
    } finally {
      await pool.end().catch(() => undefined);
      await admin.query('drop schema if exists ltc_m cascade').catch(() => undefined);
      await admin.query('drop role if exists ltc_m_provenance_writer').catch(() => undefined);
      await admin.end();
    }
  },
);
