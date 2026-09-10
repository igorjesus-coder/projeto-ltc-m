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
const SOURCE_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DRAFT_SOURCE_HASH = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const LINE_KEY = `p012-line-v1:${'c'.repeat(64)}`;
const SYNTHETIC_PASSWORD = 'p034_local_test_only';
const ADMIN_BOOTSTRAP_MIGRATION = '20260731103000_add_ltcm_audit_read_event.sql';

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
              ($4::uuid, 'p034-b.xlsx', $5::text, $3::uuid)`,
      [BATCH_ID, SOURCE_HASH, ADMIN_ID, DRAFT_BATCH_ID, DRAFT_SOURCE_HASH],
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
      await installSyntheticRoles(admin);
      writer = new Pool({ connectionString: roleDatabaseUrl(WRITER_LOGIN), max: 1 });
      runtime = new Pool({ connectionString: roleDatabaseUrl(RUNTIME_LOGIN), max: 1 });

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
        snapshots: 1,
        project_observations: 1,
        item_observations: 1,
        source_references: 2,
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
