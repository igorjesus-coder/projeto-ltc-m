import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Client, Pool } from 'pg';

const ENABLED = process.env.LTCM_P034_INTEGRATION === '1';
const DATABASE_URL = process.env.LTCM_P034_DATABASE_URL;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITER_LOGIN = 'p034_provenance_writer_test';
const RUNTIME_LOGIN = 'p034_runtime_test';
const ADMIN_ID = '00000000-0000-4000-8000-000000034001';
const EDITOR_ID = '00000000-0000-4000-8000-000000034002';
const CLIENT_ID = '00000000-0000-4000-8000-000000034003';
const PROJECT_ID = '00000000-0000-4000-8000-000000034004';
const DRAFT_PROJECT_ID = '00000000-0000-4000-8000-000000034005';
const BATCH_ID = '00000000-0000-4000-8000-000000034006';
const DRAFT_BATCH_ID = '00000000-0000-4000-8000-000000034007';
const SNAPSHOT_ID = '00000000-0000-4000-8000-000000034008';
const PROJECT_OBSERVATION_ID = '00000000-0000-4000-8000-000000034009';
const ITEM_OBSERVATION_ID = '00000000-0000-4000-8000-000000034010';
const PROJECT_REFERENCE_ID = '00000000-0000-4000-8000-000000034011';
const ITEM_REFERENCE_ID = '00000000-0000-4000-8000-000000034012';
const MISSING_REFERENCE_OBSERVATION_ID = '00000000-0000-4000-8000-000000034013';
const DRAFT_SNAPSHOT_ID = '00000000-0000-4000-8000-000000034014';
const DRAFT_PROJECT_OBSERVATION_ID = '00000000-0000-4000-8000-000000034015';
const DRAFT_ITEM_OBSERVATION_ID = '00000000-0000-4000-8000-000000034016';
const DRAFT_REFERENCE_ID = '00000000-0000-4000-8000-000000034017';
const SECOND_BATCH_ID = '00000000-0000-4000-8000-000000034018';
const SECOND_PROJECT_OBSERVATION_ID = '00000000-0000-4000-8000-000000034019';
const SECOND_ITEM_OBSERVATION_ID = '00000000-0000-4000-8000-000000034020';
const SECOND_PROJECT_REFERENCE_ID = '00000000-0000-4000-8000-000000034021';
const SECOND_ITEM_REFERENCE_ID = '00000000-0000-4000-8000-000000034022';
const DUPLICATE_PROJECT_OBSERVATION_ID = '00000000-0000-4000-8000-000000034023';
const DUPLICATE_PROJECT_REFERENCE_ID = '00000000-0000-4000-8000-000000034024';
const DUPLICATE_ITEM_OBSERVATION_ID = '00000000-0000-4000-8000-000000034025';
const DUPLICATE_ITEM_REFERENCE_ID = '00000000-0000-4000-8000-000000034026';
const NULL_ITEM_OBSERVATION_ID = '00000000-0000-4000-8000-000000034027';
const NULL_ITEM_REFERENCE_ID = '00000000-0000-4000-8000-000000034028';
const TRIMMED_ITEM_OBSERVATION_ID = '00000000-0000-4000-8000-000000034029';
const TRIMMED_ITEM_REFERENCE_ID = '00000000-0000-4000-8000-000000034030';
const INVALID_PROJECT_OBSERVATION_ID = '00000000-0000-4000-8000-000000034031';
const INVALID_ITEM_OBSERVATION_ID = '00000000-0000-4000-8000-000000034032';
const INVALID_REFERENCE_ID = '00000000-0000-4000-8000-000000034033';
const INVALID_SNAPSHOT_ID = '00000000-0000-4000-8000-000000034034';
const FK_REFERENCE_ID = '00000000-0000-4000-8000-000000034035';
const SOURCE_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DRAFT_SOURCE_HASH = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SECOND_SOURCE_HASH = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const LINE_KEY = `p012-line-v1:${'c'.repeat(64)}`;
const SYNTHETIC_PASSWORD = 'p034_local_test_only';
const ADMIN_BOOTSTRAP_MIGRATION = '20260731103000_add_ltcm_audit_read_event.sql';
const MARKERS = Object.freeze({
  runtimeCannotAssumeWriter: 'RUNTIME_CANNOT_ASSUME_PROVENANCE_WRITER',
  projectDuplicate: 'PROJECT_DUPLICATE_OCCURRENCE_CARDINALITY_PRESERVED',
  itemDuplicate: 'ITEM_DUPLICATE_OCCURRENCE_CARDINALITY_PRESERVED',
  commitIsolation: 'PROVENANCE_POOL_COMMIT_STATE_ISOLATED',
  rollbackIsolation: 'PROVENANCE_POOL_ROLLBACK_STATE_ISOLATED',
  sessionIsolation: 'PROVENANCE_POOL_SESSION_STATE_ISOLATED',
});

function databaseUrl() {
  if (!DATABASE_URL) throw new Error('P034_POSTGRES_ENV_MISSING');
  const parsed = new URL(DATABASE_URL);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase()) ||
    !['/ltcm_test', '/ltcm_ci'].includes(parsed.pathname) ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('P034_POSTGRES_ENV_INVALID');
  }
  return DATABASE_URL;
}

function roleDatabaseUrl(role) {
  const url = new URL(databaseUrl());
  url.username = role;
  url.password = SYNTHETIC_PASSWORD;
  return url.toString();
}

async function migrations() {
  const directory = path.join(ROOT, 'supabase', 'migrations');
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'));
  assert.equal(names.length, 19, 'P034 deve validar exatamente 19 migrations');
  return Promise.all(
    names.map(async (name) => ({ name, sql: await readFile(path.join(directory, name), 'utf8') })),
  );
}

async function dropTestRoles(client) {
  await client.query(`drop role if exists ${WRITER_LOGIN}`);
  await client.query(`drop role if exists ${RUNTIME_LOGIN}`);
}

async function rebuildFromZero(admin) {
  const client = await admin.connect();
  try {
    await dropTestRoles(client);
    await client.query('drop schema if exists ltc_m cascade');
    await client.query('drop role if exists ltc_m_provenance_writer');
    for (const migration of await migrations()) {
      await client.query(migration.sql);
      if (migration.name === ADMIN_BOOTSTRAP_MIGRATION) {
        await client.query(
          `select ltc_m.set_actor_context(null, null, 'p034-bootstrap', null, 'system', false)`,
        );
        await client.query(
          `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
           values ($1::uuid, 'ci-p034|admin', 'P034 Synthetic Admin', 'admin', true),
                  ($2::uuid, 'ci-p034|editor', 'P034 Synthetic Editor', 'editor', true)`,
          [ADMIN_ID, EDITOR_ID],
        );
      }
    }
  } finally {
    client.release();
  }
}

async function setupFixtures(admin) {
  const client = await admin.connect();
  try {
    await client.query('begin');
    await client.query(
      `select ltc_m.set_actor_context($1::uuid, 'ci-p034|admin', 'p034-fixture', null, 'system', false)`,
      [ADMIN_ID],
    );
    await client.query(`insert into ltc_m.currencies (code, name) values ('BRL', 'Real P034')`);
    await client.query(`insert into ltc_m.units (code, name) values ('US', 'Unidade P034')`);
    await client.query(
      `insert into ltc_m.clients (id, legal_name, display_name, created_by_user_id)
       values ($1::uuid, 'Cliente P034', 'Cliente P034', $2::uuid)`,
      [CLIENT_ID, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.projects (
         id, project_code, project_name, client_id, status, base_currency,
         contract_value, data_reference_date, created_by_user_id
       ) values
         ($1::uuid, 'P034-A', 'Projeto P034 A', $3::uuid, 'active', 'BRL', 1000, date '2026-09-01', $2::uuid),
         ($4::uuid, 'P034-B', 'Projeto P034 B', $3::uuid, 'draft', 'BRL', 1000, date '2026-09-01', $2::uuid)`,
      [PROJECT_ID, ADMIN_ID, CLIENT_ID, DRAFT_PROJECT_ID],
    );
    await client.query(
      `insert into ltc_m.import_batches (id, source_name, source_hash, submitted_by_user_id)
       values ($1::uuid, 'p034-a.xlsx', $2::text, $3::uuid),
              ($4::uuid, 'p034-b.xlsx', $5::text, $3::uuid),
              ($6::uuid, 'p034-c.xlsx', $7::text, $3::uuid)`,
      [
        BATCH_ID,
        SOURCE_HASH,
        ADMIN_ID,
        DRAFT_BATCH_ID,
        DRAFT_SOURCE_HASH,
        SECOND_BATCH_ID,
        SECOND_SOURCE_HASH,
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

async function setupDraftFacts(admin) {
  const client = await admin.connect();
  try {
    await client.query('begin');
    await client.query(
      `select ltc_m.set_actor_context($1::uuid, 'ci-p034|admin', 'p034-draft-fixture', null, 'api', false)`,
      [ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.p034_provenance_snapshots
         (id, import_batch_id, project_id, source_artifact_hash, snapshot_fingerprint,
          authority_revision, captured_by_user_id, request_id, captured_at, completed_at)
       values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, 1, $6::uuid,
               'p034-draft-fixture', now(), now())`,
      [
        DRAFT_SNAPSHOT_ID,
        DRAFT_BATCH_ID,
        DRAFT_PROJECT_ID,
        DRAFT_SOURCE_HASH,
        '7'.repeat(64),
        ADMIN_ID,
      ],
    );
    await client.query(
      `insert into ltc_m.p034_provenance_project_observations
         (id, snapshot_id, project_id, project_code, occurrence_ordinal, occurrence_fingerprint)
       values ($1::uuid, $2::uuid, $3::uuid, 'P034-B', 1, $4::text)`,
      [DRAFT_PROJECT_OBSERVATION_ID, DRAFT_SNAPSHOT_ID, DRAFT_PROJECT_ID, '8'.repeat(64)],
    );
    await client.query(
      `insert into ltc_m.p034_provenance_item_observations
         (id, snapshot_id, project_id, project_code, source_line_key, item_id,
          occurrence_ordinal, occurrence_fingerprint)
       values ($1::uuid, $2::uuid, $3::uuid, 'P034-B', $4::text, null, 1, $5::text)`,
      [DRAFT_ITEM_OBSERVATION_ID, DRAFT_SNAPSHOT_ID, DRAFT_PROJECT_ID, LINE_KEY, '9'.repeat(64)],
    );
    await client.query(
      `insert into ltc_m.p034_provenance_source_references
         (id, project_id, project_observation_id, reference_ordinal, kind, locator, fingerprint)
       values ($1::uuid, $2::uuid, $3::uuid, 1, 'source', 'P034 draft source', $4::text)`,
      [DRAFT_REFERENCE_ID, DRAFT_PROJECT_ID, DRAFT_PROJECT_OBSERVATION_ID, 'a'.repeat(64)],
    );
    await client.query(
      `insert into ltc_m.p034_provenance_source_references
         (project_id, item_observation_id, reference_ordinal, kind, locator, fingerprint)
       values ($1::uuid, $2::uuid, 1, 'source', 'P034 draft item source', $3::text)`,
      [DRAFT_PROJECT_ID, DRAFT_ITEM_OBSERVATION_ID, 'b'.repeat(64)],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function installSyntheticRoles(admin) {
  const client = await admin.connect();
  try {
    await client.query(
      `create role ${WRITER_LOGIN} login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${SYNTHETIC_PASSWORD}'`,
    );
    await client.query(
      `create role ${RUNTIME_LOGIN} login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${SYNTHETIC_PASSWORD}'`,
    );
    await client.query(
      `grant ltc_m_provenance_writer to ${WRITER_LOGIN} with inherit false, set true, admin false`,
    );
    await client.query(
      `grant ltc_m_runtime to ${RUNTIME_LOGIN} with inherit false, set true, admin false`,
    );
    const usage = await client.query(
      `select has_schema_privilege('ltc_m_provenance_writer', 'ltc_m', 'USAGE') as granted`,
    );
    assert.equal(usage.rows[0].granted, true);
  } finally {
    client.release();
  }
}

async function assertRejected(operation, expression) {
  await assert.rejects(operation, (error) => {
    assert.match(`${error.code ?? ''} ${error.message}`, expression);
    return true;
  });
}

async function inRole(pool, role, operation, { commit = false, requestId = 'p034-write' } = {}) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    const roleState = await client.query(
      `select current_user, session_user, current_role,
              has_schema_privilege(current_user, 'ltc_m', 'USAGE') as schema_usage,
              has_schema_privilege('ltc_m_provenance_writer', 'ltc_m', 'USAGE') as named_usage`,
    );
    assert.equal(roleState.rows[0].current_user, role);
    assert.equal(roleState.rows[0].schema_usage, true, JSON.stringify(roleState.rows[0]));
    await client.query(
      `select ltc_m.set_actor_context($1::uuid, 'ci-p034|editor', $2::text, null, 'api', false)`,
      [EDITOR_ID, requestId],
    );
    const result = await operation(client);
    if (commit) await client.query('commit');
    else await client.query('rollback');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function assertSessionIsolation(pool, targetRole, commit, marker) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${targetRole}`);
    await client.query(
      `select ltc_m.set_actor_context($1::uuid, 'ci-p034|editor', 'p034-hygiene', null, 'api', false)`,
      [EDITOR_ID],
    );
    if (commit) await client.query('commit');
    else await client.query('rollback');
    const state = await client.query(`
      select current_user, session_user,
             coalesce(current_setting('ltc_m.app_user_id', true), '') as app_user_id,
             coalesce(current_setting('ltc_m.request_id', true), '') as request_id,
             coalesce(current_setting('ltc_m.source', true), '') as source
    `);
    assert.deepEqual(
      state.rows[0],
      {
        current_user: WRITER_LOGIN,
        session_user: WRITER_LOGIN,
        app_user_id: '',
        request_id: '',
        source: '',
      },
      marker,
    );
  } finally {
    client.release();
  }
}

async function assertRuntimeCannotAssumeWriter(runtime) {
  const client = await runtime.connect();
  try {
    await client.query('begin');
    await client.query('set local role ltc_m_runtime');
    await assertRejected(
      client.query('set local role ltc_m_provenance_writer'),
      /permission denied|cannot set role|42501/iu,
    );
    await client.query('rollback');
  } finally {
    client.release();
  }
}

async function assertRoleDenied(pool, role, sql, expression = /permission denied|42501/iu) {
  await assertRejected(
    inRole(pool, role, (client) => client.query(sql)),
    expression,
  );
}

async function inAdmin(pool, operation, { commit = false, requestId = 'p034-admin' } = {}) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `select ltc_m.set_actor_context($1::uuid, 'ci-p034|admin', $2::text, null, 'api', false)`,
      [ADMIN_ID, requestId],
    );
    const result = await operation(client);
    if (commit) await client.query('commit');
    else await client.query('rollback');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function assertDmlDenied(pool, role, table) {
  await assertRoleDenied(pool, role, `insert into ltc_m.${table} default values`);
  await assertRoleDenied(pool, role, `update ltc_m.${table} set id = id where false`);
  await assertRoleDenied(pool, role, `delete from ltc_m.${table} where false`);
  await assertRoleDenied(pool, role, `truncate table ltc_m.${table}`);
}

async function assertProjectCodeRejected(writer, value, ordinal) {
  await assertRejected(
    inRole(writer, 'ltc_m_provenance_writer', (client) =>
      client.query(
        `insert into ltc_m.p034_provenance_project_observations
           (id, snapshot_id, project_id, project_code, occurrence_ordinal, occurrence_fingerprint)
         values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::integer, $6::text)`,
        [INVALID_PROJECT_OBSERVATION_ID, SNAPSHOT_ID, PROJECT_ID, value, ordinal, 'a'.repeat(64)],
      ),
    ),
    /violates check constraint|23514/iu,
  );
}

async function assertItemValueRejected(writer, itemId, ordinal) {
  await assertRejected(
    inRole(writer, 'ltc_m_provenance_writer', (client) =>
      client.query(
        `insert into ltc_m.p034_provenance_item_observations
           (id, snapshot_id, project_id, project_code, source_line_key, item_id,
            occurrence_ordinal, occurrence_fingerprint)
         values ($1::uuid, $2::uuid, $3::uuid, 'P034-A', $4::text, $5::text, $6::integer, $7::text)`,
        [
          INVALID_ITEM_OBSERVATION_ID,
          SNAPSHOT_ID,
          PROJECT_ID,
          LINE_KEY,
          itemId,
          ordinal,
          'b'.repeat(64),
        ],
      ),
    ),
    /violates check constraint|23514/iu,
  );
}

async function assertLocatorRejected(writer, locator, ordinal) {
  try {
    await assertRejected(
      inRole(writer, 'ltc_m_provenance_writer', (client) =>
        client.query(
          `insert into ltc_m.p034_provenance_source_references
           (id, project_id, project_observation_id, reference_ordinal, kind, locator, fingerprint)
         values ($1::uuid, $2::uuid, $3::uuid, $4::integer, 'source', $5::text, $6::text)`,
          [
            INVALID_REFERENCE_ID,
            PROJECT_ID,
            PROJECT_OBSERVATION_ID,
            ordinal,
            locator,
            'c'.repeat(64),
          ],
        ),
      ),
      /violates check constraint|23514/iu,
    );
  } catch (error) {
    throw new Error(`locator not rejected: ${locator}; ${error.message}`);
  }
}

async function catalogAssertions(admin) {
  const result = await admin.query(`
    select
      r.rolcanlogin,
      r.rolinherit,
      r.rolsuper,
      r.rolcreatedb,
      r.rolcreaterole,
      r.rolreplication,
      r.rolbypassrls,
      a.rolpassword is null as password_empty,
      not exists (
        select 1 from pg_catalog.pg_auth_members m where m.roleid = r.oid
      ) as no_memberships,
      not exists (
        select 1 from pg_catalog.pg_auth_members m
        join pg_catalog.pg_roles runtime on runtime.oid = m.member
        where m.roleid = r.oid and runtime.rolname = 'ltc_m_runtime'
      ) as runtime_cannot_assume_writer,
      not exists (
        select 1 from pg_catalog.pg_class c
        where c.relowner = r.oid and c.relnamespace = 'ltc_m'::regnamespace
          and c.relname like 'p034_%'
      ) as no_table_ownership,
      not exists (
        select 1 from pg_catalog.pg_proc p
        where p.proowner = r.oid and p.pronamespace = 'ltc_m'::regnamespace
          and p.proname like 'p034_%'
      ) as no_function_ownership,
      (select count(*)::integer from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'ltc_m' and c.relname like 'p034_%' and c.relkind = 'r') as p034_table_count
    from pg_catalog.pg_roles r
    join pg_catalog.pg_authid a on a.oid = r.oid
    where r.rolname = 'ltc_m_provenance_writer'
  `);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], {
    rolcanlogin: false,
    rolinherit: false,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false,
    password_empty: true,
    no_memberships: true,
    runtime_cannot_assume_writer: true,
    no_table_ownership: true,
    no_function_ownership: true,
    p034_table_count: 4,
  });
  const rls = await admin.query(`
    select relname, relrowsecurity, relforcerowsecurity
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'ltc_m' and relname like 'p034_%' and relkind = 'r'
     order by relname
  `);
  assert.equal(rls.rows.length, 4);
  assert.ok(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity));
  const publicAcl = await admin.query(`
    select count(*)::integer as count
      from information_schema.role_table_grants
     where grantee = 'PUBLIC' and table_schema = 'ltc_m' and table_name like 'p034_%'
  `);
  assert.equal(publicAcl.rows[0].count, 0);
}

test(
  'P034 foundation aplica 19 migrations do zero e fecha o contrato de provenance',
  { skip: !ENABLED },
  async () => {
    const admin = new Pool({ connectionString: databaseUrl(), max: 2 });
    let writer;
    let runtime;
    try {
      await rebuildFromZero(admin);
      await catalogAssertions(admin);
      await setupFixtures(admin);
      await setupDraftFacts(admin);
      await installSyntheticRoles(admin);
      writer = new Pool({ connectionString: roleDatabaseUrl(WRITER_LOGIN), max: 1 });
      runtime = new Pool({ connectionString: roleDatabaseUrl(RUNTIME_LOGIN), max: 1 });
      await assertRuntimeCannotAssumeWriter(runtime);

      await assertSessionIsolation(
        writer,
        'ltc_m_provenance_writer',
        true,
        MARKERS.commitIsolation,
      );
      await assertSessionIsolation(
        writer,
        'ltc_m_provenance_writer',
        false,
        MARKERS.rollbackIsolation,
      );

      await assertRejected(
        writer.query('select 1 from ltc_m.p034_provenance_snapshots'),
        /permission denied|42501/iu,
      );
      const privileges = await admin.query(`
        select
          has_table_privilege('ltc_m_provenance_writer', 'ltc_m.p034_provenance_snapshots', 'SELECT') as can_select,
          has_table_privilege('ltc_m_provenance_writer', 'ltc_m.p034_provenance_snapshots', 'INSERT') as can_insert,
          has_table_privilege('ltc_m_provenance_writer', 'ltc_m.p034_provenance_snapshots', 'UPDATE') as can_update,
          has_table_privilege('ltc_m_provenance_writer', 'ltc_m.p034_provenance_snapshots', 'DELETE') as can_delete
      `);
      assert.deepEqual(privileges.rows[0], {
        can_select: true,
        can_insert: true,
        can_update: false,
        can_delete: false,
      });
      const writerProjects = await inRole(writer, 'ltc_m_provenance_writer', (client) =>
        client.query(`select count(*)::integer as count from ltc_m.projects`),
      );
      assert.equal(writerProjects.rows[0].count, 1);
      const writerBatches = await inRole(writer, 'ltc_m_provenance_writer', (client) =>
        client.query(`select count(*)::integer as count from ltc_m.import_batches`),
      );
      assert.equal(writerBatches.rows[0].count, 3);

      await inRole(
        writer,
        'ltc_m_provenance_writer',
        async (client) => {
          const identity = await client.query(
            `select current_user, session_user, current_setting('ltc_m.request_id', true)`,
          );
          assert.deepEqual(identity.rows[0], {
            current_user: 'ltc_m_provenance_writer',
            session_user: WRITER_LOGIN,
            current_setting: 'p034-write',
          });
          const visible = await client.query(
            `select count(*)::integer as count from ltc_m.projects where project_code like 'P034-%'`,
          );
          assert.equal(visible.rows[0].count, 1);
          await client.query(
            `insert into ltc_m.p034_provenance_snapshots
             (id, import_batch_id, project_id, source_artifact_hash, snapshot_fingerprint,
              authority_revision, captured_by_user_id, request_id, captured_at, completed_at)
           values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, 1, $6::uuid, 'p034-write', now(), now())`,
            [SNAPSHOT_ID, BATCH_ID, PROJECT_ID, SOURCE_HASH, 'd'.repeat(64), EDITOR_ID],
          );
          await client.query(
            `insert into ltc_m.p034_provenance_project_observations
             (id, snapshot_id, project_id, project_code, occurrence_ordinal, occurrence_fingerprint)
           values ($1::uuid, $2::uuid, $3::uuid, 'P034-A', 1, $4::text)`,
            [PROJECT_OBSERVATION_ID, SNAPSHOT_ID, PROJECT_ID, 'e'.repeat(64)],
          );
          await client.query(
            `insert into ltc_m.p034_provenance_item_observations
             (id, snapshot_id, project_id, project_code, source_line_key, item_id, occurrence_ordinal, occurrence_fingerprint)
           values ($1::uuid, $2::uuid, $3::uuid, 'P034-A', $4::text, 'ITEM-1', 1, $5::text)`,
            [ITEM_OBSERVATION_ID, SNAPSHOT_ID, PROJECT_ID, LINE_KEY, 'f'.repeat(64)],
          );
          await client.query(
            `insert into ltc_m.p034_provenance_source_references
             (id, project_id, project_observation_id, item_observation_id, reference_ordinal, kind, locator, fingerprint)
           values ($1::uuid, $2::uuid, $3::uuid, null, 1, 'source', 'P034 synthetic source row', $4::text),
                  ($5::uuid, $2::uuid, null, $6::uuid, 1, 'database', 'ltc_m.p034_provenance_item_observations', $4::text)`,
            [
              PROJECT_REFERENCE_ID,
              PROJECT_ID,
              PROJECT_OBSERVATION_ID,
              '1'.repeat(64),
              ITEM_REFERENCE_ID,
              ITEM_OBSERVATION_ID,
            ],
          );
        },
        { commit: true },
      );
      const writerVisibleFacts = await inRole(writer, 'ltc_m_provenance_writer', async (client) => {
        const result = await client.query(`
          select project_id::text, count(*)::integer as count
            from ltc_m.p034_provenance_source_references
           group by project_id
           order by project_id
        `);
        return result.rows;
      });
      assert.deepEqual(writerVisibleFacts, [{ project_id: PROJECT_ID, count: 2 }]);
      const writerVisibleCounts = await inRole(writer, 'ltc_m_provenance_writer', (client) =>
        client.query(`
          select
            (select count(*)::integer from ltc_m.p034_provenance_snapshots) as snapshots,
            (select count(*)::integer from ltc_m.p034_provenance_project_observations) as project_observations,
            (select count(*)::integer from ltc_m.p034_provenance_item_observations) as item_observations,
            (select count(*)::integer from ltc_m.p034_provenance_source_references) as source_references
        `),
      );
      assert.deepEqual(writerVisibleCounts.rows[0], {
        snapshots: 1,
        project_observations: 1,
        item_observations: 1,
        source_references: 2,
      });
      const runtimeVisibleFacts = await inRole(runtime, 'ltc_m_runtime', async (client) => {
        const result = await client.query(`
          select project_id::text, count(*)::integer as count
            from ltc_m.p034_provenance_source_references
           group by project_id
           order by project_id
        `);
        return result.rows;
      });
      assert.deepEqual(runtimeVisibleFacts, [{ project_id: PROJECT_ID, count: 2 }]);
      const runtimeVisibleCounts = await inRole(runtime, 'ltc_m_runtime', (client) =>
        client.query(`
          select
            (select count(*)::integer from ltc_m.p034_provenance_snapshots) as snapshots,
            (select count(*)::integer from ltc_m.p034_provenance_project_observations) as project_observations,
            (select count(*)::integer from ltc_m.p034_provenance_item_observations) as item_observations,
            (select count(*)::integer from ltc_m.p034_provenance_source_references) as source_references
        `),
      );
      assert.deepEqual(runtimeVisibleCounts.rows[0], {
        snapshots: 1,
        project_observations: 1,
        item_observations: 1,
        source_references: 2,
      });
      assert.ok(
        MARKERS.sessionIsolation === 'PROVENANCE_POOL_SESSION_STATE_ISOLATED',
        MARKERS.sessionIsolation,
      );

      for (const table of [
        'p034_provenance_snapshots',
        'p034_provenance_project_observations',
        'p034_provenance_item_observations',
        'p034_provenance_source_references',
      ]) {
        await assertDmlDenied(writer, 'ltc_m_provenance_writer', table);
        await assertDmlDenied(runtime, 'ltc_m_runtime', table);
      }
      for (const table of ['projects', 'import_batches']) {
        await assertRoleDenied(
          writer,
          'ltc_m_provenance_writer',
          `insert into ltc_m.${table} default values`,
        );
        await assertRoleDenied(
          writer,
          'ltc_m_provenance_writer',
          `update ltc_m.${table} set id = id where false`,
        );
        await assertRoleDenied(
          writer,
          'ltc_m_provenance_writer',
          `delete from ltc_m.${table} where false`,
        );
      }

      await inRole(
        writer,
        'ltc_m_provenance_writer',
        async (client) => {
          await client.query(
            `insert into ltc_m.p034_provenance_project_observations
               (id, snapshot_id, project_id, project_code, occurrence_ordinal, occurrence_fingerprint)
             values ($1::uuid, $2::uuid, $3::uuid, 'P034-A', 60, $4::text)`,
            [DUPLICATE_PROJECT_OBSERVATION_ID, SNAPSHOT_ID, PROJECT_ID, '2'.repeat(64)],
          );
          await client.query(
            `insert into ltc_m.p034_provenance_source_references
               (id, project_id, project_observation_id, reference_ordinal, kind, locator, fingerprint)
             values ($1::uuid, $2::uuid, $3::uuid, 1, 'source', 'P034 duplicate project source', $4::text)`,
            [
              DUPLICATE_PROJECT_REFERENCE_ID,
              PROJECT_ID,
              DUPLICATE_PROJECT_OBSERVATION_ID,
              '3'.repeat(64),
            ],
          );
          await client.query(
            `insert into ltc_m.p034_provenance_item_observations
               (id, snapshot_id, project_id, project_code, source_line_key, item_id,
                occurrence_ordinal, occurrence_fingerprint)
             values ($1::uuid, $2::uuid, $3::uuid, 'P034-A', $4::text, 'ITEM-1', 2, $5::text)`,
            [DUPLICATE_ITEM_OBSERVATION_ID, SNAPSHOT_ID, PROJECT_ID, LINE_KEY, '4'.repeat(64)],
          );
          await client.query(
            `insert into ltc_m.p034_provenance_source_references
               (id, project_id, item_observation_id, reference_ordinal, kind, locator, fingerprint)
             values ($1::uuid, $2::uuid, $3::uuid, 1, 'source', 'P034 duplicate item source', $4::text)`,
            [
              DUPLICATE_ITEM_REFERENCE_ID,
              PROJECT_ID,
              DUPLICATE_ITEM_OBSERVATION_ID,
              '5'.repeat(64),
            ],
          );
        },
        { commit: true },
      );
      const duplicateCounts = await admin.query(
        `
        select
          (select count(*)::integer from ltc_m.p034_provenance_project_observations where snapshot_id = $1::uuid and project_code = 'P034-A') as project_count,
          (select count(*)::integer from ltc_m.p034_provenance_item_observations where snapshot_id = $1::uuid and project_code = 'P034-A' and source_line_key = $2::text) as item_count
      `,
        [SNAPSHOT_ID, LINE_KEY],
      );
      assert.deepEqual(duplicateCounts.rows[0], { project_count: 2, item_count: 2 });
      assert.ok(
        MARKERS.projectDuplicate === 'PROJECT_DUPLICATE_OCCURRENCE_CARDINALITY_PRESERVED',
        MARKERS.projectDuplicate,
      );
      assert.ok(
        MARKERS.itemDuplicate === 'ITEM_DUPLICATE_OCCURRENCE_CARDINALITY_PRESERVED',
        MARKERS.itemDuplicate,
      );
      await inRole(
        writer,
        'ltc_m_provenance_writer',
        async (client) => {
          await client.query(
            `insert into ltc_m.p034_provenance_item_observations
               (id, snapshot_id, project_id, project_code, source_line_key, item_id,
                occurrence_ordinal, occurrence_fingerprint)
             values ($1::uuid, $2::uuid, $3::uuid, 'P034-A', $4::text, null, 3, $5::text),
                    ($6::uuid, $2::uuid, $3::uuid, 'P034-A', $4::text, 'ITEM-TRIMMED', 4, $7::text)`,
            [
              NULL_ITEM_OBSERVATION_ID,
              SNAPSHOT_ID,
              PROJECT_ID,
              LINE_KEY,
              '6'.repeat(64),
              TRIMMED_ITEM_OBSERVATION_ID,
              '7'.repeat(64),
            ],
          );
          await client.query(
            `insert into ltc_m.p034_provenance_source_references
               (id, project_id, item_observation_id, reference_ordinal, kind, locator, fingerprint)
             values ($1::uuid, $2::uuid, $3::uuid, 1, 'source', 'P034 null item source', $4::text),
                    ($5::uuid, $2::uuid, $6::uuid, 1, 'source', 'P034 trimmed item source', $4::text)`,
            [
              NULL_ITEM_REFERENCE_ID,
              PROJECT_ID,
              NULL_ITEM_OBSERVATION_ID,
              '8'.repeat(64),
              TRIMMED_ITEM_REFERENCE_ID,
              TRIMMED_ITEM_OBSERVATION_ID,
            ],
          );
        },
        { commit: true },
      );
      for (const [value, ordinal] of [
        ['p034-a', 10],
        [' P034-A', 11],
        ['', 12],
        ['A'.repeat(65), 13],
        ['P034@A', 14],
      ]) {
        await assertProjectCodeRejected(writer, value, ordinal);
      }
      for (const [value, ordinal] of [
        [`p012-line-v1:${'c'.repeat(63)}`, 20],
        [`p012-line-v1:${'C'.repeat(64)}`, 21],
        [`wrong-prefix:${'c'.repeat(64)}`, 22],
        [`p012-line-v1: ${'c'.repeat(64)}`, 23],
      ]) {
        await assertRejected(
          inRole(writer, 'ltc_m_provenance_writer', (client) =>
            client.query(
              `insert into ltc_m.p034_provenance_item_observations
                 (id, snapshot_id, project_id, project_code, source_line_key, item_id,
                  occurrence_ordinal, occurrence_fingerprint)
               values ($1::uuid, $2::uuid, $3::uuid, 'P034-A', $4::text, null, $5::integer, $6::text)`,
              [
                INVALID_ITEM_OBSERVATION_ID,
                SNAPSHOT_ID,
                PROJECT_ID,
                value,
                ordinal,
                'd'.repeat(64),
              ],
            ),
          ),
          /violates check constraint|23514/iu,
        );
      }
      for (const [value, ordinal] of [
        ['', 30],
        ['   ', 31],
        [' ITEM', 32],
        ['ITEM ', 33],
      ]) {
        await assertItemValueRejected(writer, value, ordinal);
      }
      for (const [value, ordinal] of [
        ['C:\\Users\\Igor\\source.xlsx', 40],
        ['/home/igor/source.xlsx', 41],
        ['/Users/igor/source.xlsx', 42],
        ['postgresql://localhost/ltcm', 43],
        ['https://example.invalid/source', 44],
        ['password=secret', 45],
        ['token=secret', 46],
        ['private_key=secret', 47],
        ['client_secret=secret', 48],
      ]) {
        await assertLocatorRejected(writer, value, ordinal);
      }
      await assertRejected(
        inRole(writer, 'ltc_m_provenance_writer', (client) =>
          client.query(
            `insert into ltc_m.p034_provenance_snapshots
             (import_batch_id, project_id, source_artifact_hash, snapshot_fingerprint, authority_revision, captured_by_user_id, request_id, completed_at)
             values ($1::uuid, $2::uuid, $3::text, $4::text, 10, $5::uuid, 'p034-write', now())`,
            [SECOND_BATCH_ID, PROJECT_ID, SECOND_SOURCE_HASH, '8'.repeat(64), ADMIN_ID],
          ),
        ),
        /actor context mismatch|42501/iu,
      );
      await assertRejected(
        inRole(writer, 'ltc_m_provenance_writer', (client) =>
          client.query(
            `insert into ltc_m.p034_provenance_snapshots
             (import_batch_id, project_id, source_artifact_hash, snapshot_fingerprint, authority_revision, captured_by_user_id, request_id, capture_source, completed_at)
             values ($1::uuid, $2::uuid, $3::text, $4::text, 11, $5::uuid, 'p034-write', 'system', now())`,
            [SECOND_BATCH_ID, PROJECT_ID, SECOND_SOURCE_HASH, '9'.repeat(64), EDITOR_ID],
          ),
        ),
        /row-level security|42501/iu,
      );
      await assertRejected(
        inRole(
          writer,
          'ltc_m_provenance_writer',
          (client) =>
            client.query(
              `insert into ltc_m.p034_provenance_item_observations
                 (id, snapshot_id, project_id, project_code, source_line_key, item_id,
                  occurrence_ordinal, occurrence_fingerprint)
               values ($1::uuid, $2::uuid, $3::uuid, 'P034-A', $4::text, null, 50, $5::text)`,
              [INVALID_ITEM_OBSERVATION_ID, SNAPSHOT_ID, PROJECT_ID, LINE_KEY, 'e'.repeat(64)],
            ),
          { commit: true },
        ),
        /requires source reference|23514/iu,
      );

      await assertRejected(
        inAdmin(admin, (client) =>
          client.query(
            `insert into ltc_m.p034_provenance_source_references
               (id, project_id, project_observation_id, reference_ordinal, kind, locator, fingerprint)
             values ($1::uuid, $2::uuid, $3::uuid, 90, 'source', 'P034 missing parent', $4::text)`,
            [FK_REFERENCE_ID, PROJECT_ID, INVALID_PROJECT_OBSERVATION_ID, 'f'.repeat(64)],
          ),
        ),
        /fk_p034_source_reference_project_observation|23503/iu,
      );
      await assertRejected(
        inAdmin(admin, (client) =>
          client.query(
            `insert into ltc_m.p034_provenance_source_references
               (id, project_id, project_observation_id, reference_ordinal, kind, locator, fingerprint)
             values ($1::uuid, $2::uuid, $3::uuid, 91, 'source', 'P034 divergent project', $4::text)`,
            [FK_REFERENCE_ID, DRAFT_PROJECT_ID, PROJECT_OBSERVATION_ID, 'f'.repeat(64)],
          ),
        ),
        /fk_p034_source_reference_project_observation|23503/iu,
      );
      await assertRejected(
        inAdmin(admin, (client) =>
          client.query(
            `insert into ltc_m.p034_provenance_snapshots
             (id, import_batch_id, project_id, source_artifact_hash, snapshot_fingerprint,
              authority_revision, captured_by_user_id, request_id, completed_at)
           values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, 10, $6::uuid, 'p034-admin', now())`,
            [INVALID_SNAPSHOT_ID, BATCH_ID, PROJECT_ID, SOURCE_HASH, '1'.repeat(64), ADMIN_ID],
          ),
        ),
        /uq_p034_snapshot_batch_project|23505/iu,
      );
      await assertRejected(
        inAdmin(admin, (client) =>
          client.query(
            `insert into ltc_m.p034_provenance_snapshots
             (id, import_batch_id, project_id, source_artifact_hash, snapshot_fingerprint,
              authority_revision, captured_by_user_id, request_id, completed_at)
           values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, 1, $6::uuid, 'p034-admin', now())`,
            [
              INVALID_SNAPSHOT_ID,
              SECOND_BATCH_ID,
              PROJECT_ID,
              SECOND_SOURCE_HASH,
              '2'.repeat(64),
              ADMIN_ID,
            ],
          ),
        ),
        /uq_p034_snapshot_project_revision|23505/iu,
      );
      await assertRejected(
        inAdmin(admin, (client) =>
          client.query(
            `insert into ltc_m.p034_provenance_snapshots
             (id, import_batch_id, project_id, source_artifact_hash, snapshot_fingerprint,
              authority_revision, captured_by_user_id, request_id, completed_at)
           values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, 2, $6::uuid, 'p034-admin', now())`,
            [
              INVALID_SNAPSHOT_ID,
              SECOND_BATCH_ID,
              PROJECT_ID,
              SECOND_SOURCE_HASH,
              'd'.repeat(64),
              ADMIN_ID,
            ],
          ),
        ),
        /uq_p034_snapshot_fingerprint|23505/iu,
      );
      await assertRejected(
        inAdmin(admin, (client) =>
          client.query(
            `update ltc_m.p034_provenance_snapshots set status = 'success' where id = $1::uuid`,
            [SNAPSHOT_ID],
          ),
        ),
        /P034 provenance facts are immutable|55000/iu,
      );
      await assertRejected(
        inAdmin(admin, (client) =>
          client.query(`delete from ltc_m.p034_provenance_snapshots where id = $1::uuid`, [
            SNAPSHOT_ID,
          ]),
        ),
        /P034 provenance facts cannot be deleted|55000/iu,
      );

      await assertRejected(
        inRole(
          writer,
          'ltc_m_provenance_writer',
          (client) =>
            client.query(
              `insert into ltc_m.p034_provenance_snapshots
             (import_batch_id, project_id, source_artifact_hash, snapshot_fingerprint, authority_revision, captured_by_user_id, request_id, completed_at)
             values ($1::uuid, $2::uuid, $3::text, $4::text, 2, $5::uuid, 'p034-write', now())`,
              [BATCH_ID, PROJECT_ID, DRAFT_SOURCE_HASH, '2'.repeat(64), EDITOR_ID],
            ),
          { commit: true },
        ),
        /source artifact hash|23514/iu,
      );
      await assertRejected(
        inRole(writer, 'ltc_m_provenance_writer', (client) =>
          client.query(
            `insert into ltc_m.p034_provenance_snapshots
             (import_batch_id, project_id, source_artifact_hash, snapshot_fingerprint, authority_revision, captured_by_user_id, request_id, completed_at)
             values ($1::uuid, $2::uuid, $3::text, $4::text, 2, $5::uuid, 'wrong-request', now())`,
            [BATCH_ID, PROJECT_ID, SOURCE_HASH, '3'.repeat(64), EDITOR_ID],
          ),
        ),
        /context mismatch|42501/iu,
      );
      await assertRejected(
        inRole(writer, 'ltc_m_provenance_writer', (client) =>
          client.query(
            `insert into ltc_m.p034_provenance_snapshots
             (import_batch_id, project_id, source_artifact_hash, snapshot_fingerprint, authority_revision, captured_by_user_id, request_id, completed_at)
             values ($1::uuid, $2::uuid, $3::text, $4::text, 2, $5::uuid, 'p034-write', now())`,
            [DRAFT_BATCH_ID, DRAFT_PROJECT_ID, DRAFT_SOURCE_HASH, '4'.repeat(64), EDITOR_ID],
          ),
        ),
        /row-level security|42501/iu,
      );
      await assertRejected(
        inRole(
          writer,
          'ltc_m_provenance_writer',
          (client) =>
            client.query(
              `insert into ltc_m.p034_provenance_project_observations
             (id, snapshot_id, project_id, project_code, occurrence_ordinal, occurrence_fingerprint)
             values ($1::uuid, $2::uuid, $3::uuid, 'P034-A', 2, $4::text)`,
              [MISSING_REFERENCE_OBSERVATION_ID, SNAPSHOT_ID, PROJECT_ID, '5'.repeat(64)],
            ),
          { commit: true },
        ),
        /requires source reference|23514/iu,
      );
      await assertRejected(
        inRole(writer, 'ltc_m_provenance_writer', (client) =>
          client.query(
            `update ltc_m.p034_provenance_snapshots set status = 'success' where id = $1::uuid`,
            [SNAPSHOT_ID],
          ),
        ),
        /permission denied|UPDATE|42501/iu,
      );
      await assertRejected(
        inRole(writer, 'ltc_m_provenance_writer', (client) =>
          client.query(
            `insert into ltc_m.p034_provenance_source_references
             (project_id, project_observation_id, item_observation_id, reference_ordinal, kind, locator, fingerprint)
             values ($1::uuid, $2::uuid, $3::uuid, 2, 'source', 'two parents', $4::text)`,
            [PROJECT_ID, PROJECT_OBSERVATION_ID, ITEM_OBSERVATION_ID, '6'.repeat(64)],
          ),
        ),
        /one parent|23514/iu,
      );

      const runtimeVisible = await inRole(runtime, 'ltc_m_runtime', async (client) => {
        const rows = await client.query(
          `select count(*)::integer as count from ltc_m.p034_provenance_snapshots`,
        );
        await assertRejected(
          client.query(
            `update ltc_m.p034_provenance_snapshots set status = 'success' where id = $1::uuid`,
            [SNAPSHOT_ID],
          ),
          /permission denied|UPDATE|42501/iu,
        );
        return rows.rows[0].count;
      });
      assert.equal(runtimeVisible, 1);
      const stored = await admin.query(`
        select
          (select count(*)::integer from ltc_m.p034_provenance_snapshots) as snapshots,
          (select count(*)::integer from ltc_m.p034_provenance_project_observations) as project_observations,
          (select count(*)::integer from ltc_m.p034_provenance_item_observations) as item_observations,
          (select count(*)::integer from ltc_m.p034_provenance_source_references) as source_references
      `);
      assert.deepEqual(stored.rows[0], {
        snapshots: 2,
        project_observations: 3,
        item_observations: 5,
        source_references: 8,
      });
    } finally {
      await writer?.end().catch(() => undefined);
      await runtime?.end().catch(() => undefined);
      const cleanup = await admin.connect();
      try {
        await cleanup.query('drop schema if exists ltc_m cascade');
        await dropTestRoles(cleanup);
        await cleanup.query('drop role if exists ltc_m_provenance_writer');
      } finally {
        cleanup.release();
      }
      await admin.end();
    }
  },
);
