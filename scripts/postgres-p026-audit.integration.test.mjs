import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

const ENABLED = process.env.LTCM_P026_INTEGRATION === '1';
const ISOLATED = process.env.LTCM_P026_ISOLATED_CLUSTER === '1';
const DATABASE_URL = process.env.LTCM_P026_DATABASE_URL;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ADMIN_ID = '00000000-0000-4000-8000-000000026001';
const CLIENT_ID = '00000000-0000-4000-8000-000000026002';

function isolatedDatabaseUrl() {
  if (!ENABLED) return undefined;
  if (!ISOLATED || !DATABASE_URL) throw new Error('P026_POSTGRES_ENV_MISSING');
  let parsed;
  try {
    parsed = new URL(DATABASE_URL);
  } catch {
    throw new Error('P026_POSTGRES_ENV_INVALID');
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
    throw new Error('P026_POSTGRES_ENV_INVALID');
  }
  return DATABASE_URL;
}

async function migrationInventory() {
  const directory = path.join(ROOT, 'supabase', 'migrations');
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'));
  assert.equal(names.length, 16);
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

async function installAdmin(client) {
  await client.query('begin');
  try {
    await client.query(
      `select ltc_m.set_actor_context(null, null, 'p026-bootstrap', null, 'system', false)`,
    );
    await client.query(
      `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
       values ($1::uuid, 'ci-p026|admin', 'P026 Synthetic Admin', 'admin', true)`,
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
    throw new Error(`P026_MIGRATION_FROM_ZERO_FAILED:${currentMigration}`, { cause: error });
  } finally {
    client.release();
  }
}

async function setAdminContext(client, requestId) {
  await client.query(
    `select ltc_m.set_actor_context($1::uuid, 'ci-p026|admin', $2::text, null, 'p026-test', false)`,
    [ADMIN_ID, requestId],
  );
}

test('P026-D21 preserva code, id UUID, RLS/FORCE e bloqueia DELETE no runtime', async (t) => {
  const databaseUrl = isolatedDatabaseUrl();
  if (!databaseUrl) {
    t.skip('P026 PostgreSQL integration disabled');
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  try {
    await rebuildFromZero(pool);

    const runtime = await pool.connect();
    try {
      await runtime.query('set role ltc_m_runtime');
      await runtime.query('begin');
      await setAdminContext(runtime, 'p026-catalog-dml');
      await runtime.query(
        `insert into ltc_m.currencies (code, name) values ('XCU', 'P026 Currency')`,
      );
      await runtime.query(
        `insert into ltc_m.units (code, name, category) values ('P26', 'P026 Unit', 'synthetic')`,
      );
      await runtime.query(
        `insert into ltc_m.clients (id, legal_name, display_name)
         values ($1::uuid, 'P026 Synthetic Client', 'P026 Client')`,
        [CLIENT_ID],
      );
      await runtime.query(
        `update ltc_m.currencies set name = 'P026 Currency Updated' where code = 'XCU'`,
      );
      await runtime.query(`update ltc_m.units set name = 'P026 Unit Updated' where code = 'P26'`);
      await runtime.query('commit');
      await assert.rejects(
        runtime.query(`delete from ltc_m.currencies where code = 'XCU'`),
        /permission denied|row-level security/iu,
      );
      await runtime.query('reset role');
    } finally {
      await runtime.query('rollback').catch(() => undefined);
      runtime.release();
    }

    const inspector = await pool.connect();
    try {
      const audit = await inspector.query(
        `select table_name, record_id, operation
           from ltc_m.audit_log
          where table_name in ('ltc_m.currencies', 'ltc_m.units', 'ltc_m.clients')
            and record_id in ('XCU', 'P26', $1)
          order by id`,
        [CLIENT_ID],
      );
      assert.deepEqual(
        audit.rows.map(({ table_name, record_id, operation }) => [
          table_name,
          record_id,
          operation,
        ]),
        [
          ['ltc_m.currencies', 'XCU', 'INSERT'],
          ['ltc_m.units', 'P26', 'INSERT'],
          ['ltc_m.clients', CLIENT_ID, 'INSERT'],
          ['ltc_m.currencies', 'XCU', 'UPDATE'],
          ['ltc_m.units', 'P26', 'UPDATE'],
        ],
      );
      const invalidIds = await inspector.query(
        `select count(*)::integer as count
           from ltc_m.audit_log
          where record_id is null or btrim(record_id) = ''`,
      );
      assert.equal(invalidIds.rows[0].count, 0);

      const security = await inspector.query(
        `select c.relname, c.relrowsecurity, c.relforcerowsecurity
           from pg_catalog.pg_class as c
           join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
          where n.nspname = 'ltc_m'
            and c.relname = any($1::text[])
          order by c.relname`,
        [['audit_log', 'clients', 'currencies', 'units']],
      );
      assert.deepEqual(security.rows, [
        { relname: 'audit_log', relrowsecurity: true, relforcerowsecurity: true },
        { relname: 'clients', relrowsecurity: true, relforcerowsecurity: true },
        { relname: 'currencies', relrowsecurity: true, relforcerowsecurity: true },
        { relname: 'units', relrowsecurity: true, relforcerowsecurity: true },
      ]);
      const remaining = await inspector.query(
        `select count(*)::integer as count from ltc_m.currencies where code = 'XCU'`,
      );
      assert.equal(remaining.rows[0].count, 1);
      await assert.rejects(
        inspector.query(`delete from ltc_m.currencies where code = 'XCU'`),
        /delete físico (?:rejeitado|não pode ser auditado)/iu,
      );
    } finally {
      inspector.release();
    }

    const invalidIdentity = await pool.connect();
    try {
      await invalidIdentity.query(
        `create temp table p026_missing_identity (code text);
         create trigger p026_missing_identity_audit
         after insert on p026_missing_identity
         for each row execute function ltc_m.audit_row_change('id')`,
      );
      await assert.rejects(
        invalidIdentity.query(`insert into p026_missing_identity (code) values ('missing-id')`),
        /identidade de auditoria ausente ou vazia/iu,
      );
      await invalidIdentity.query(
        `create temp table p026_null_identity (code text);
         create trigger p026_null_identity_audit
         after insert on p026_null_identity
         for each row execute function ltc_m.audit_row_change('code')`,
      );
      await assert.rejects(
        invalidIdentity.query(`insert into p026_null_identity (code) values (null)`),
        /identidade de auditoria ausente ou vazia/iu,
      );
    } finally {
      invalidIdentity.release();
    }
  } finally {
    await rebuildFromZero(pool).catch(() => undefined);
    await pool.end();
  }
});
