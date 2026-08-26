import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import { loadApiConfig } from '../src/config/api-config.js';
import { createDatabasePool } from '../src/database/database-pool.js';
import { withActorTransaction, withTransaction } from '../src/database/transaction.js';

const ENABLED = process.env['LTCM_P019_INTEGRATION'] === '1';
const ADMIN_DATABASE_URL = process.env['LTCM_P019_DATABASE_URL'];
const RUNTIME_ROLE = 'p019_runtime_test';
const RUNTIME_PASSWORD = 'p019_ci_local_only';
const ADMIN_ID = '00000000-0000-4000-8000-000000017001';

function isolatedAdminUrl(): string {
  if (!ENABLED) return '';
  if (!ADMIN_DATABASE_URL) throw new Error('P019_POSTGRES_ENV_MISSING');
  let parsed: URL;
  try {
    parsed = new URL(ADMIN_DATABASE_URL);
  } catch {
    throw new Error('P019_POSTGRES_ENV_INVALID');
  }
  const port = Number(parsed.port);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase()) ||
    parsed.pathname !== '/ltcm_test' ||
    parsed.search ||
    parsed.hash ||
    !Number.isSafeInteger(port) ||
    port < 1_024 ||
    port > 65_535
  ) {
    throw new Error('P019_POSTGRES_ENV_INVALID');
  }
  return ADMIN_DATABASE_URL;
}

function runtimeUrl(adminUrl: string): string {
  const parsed = new URL(adminUrl);
  parsed.username = RUNTIME_ROLE;
  parsed.password = RUNTIME_PASSWORD;
  return parsed.toString();
}

test(
  'P019 isola pool, transação, contexto P008 e FORCE RLS em PostgreSQL 17 from-zero',
  { skip: !ENABLED },
  async () => {
    const adminUrl = isolatedAdminUrl();
    const admin = new Pool({ connectionString: adminUrl, max: 1 });
    let databasePool: ReturnType<typeof createDatabasePool> | undefined;
    try {
      const environment = await admin.query<{
        database_name: string;
        server_version_num: string;
        admin_exists: boolean;
      }>(
        `select current_database() as database_name,
                current_setting('server_version_num') as server_version_num,
                exists (
                  select 1 from ltc_m.app_users
                   where id = $1::uuid and auth_subject = 'ci-p017|admin' and active
                ) as admin_exists`,
        [ADMIN_ID],
      );
      assert.equal(environment.rows[0]?.database_name, 'ltcm_test');
      assert.match(environment.rows[0]?.server_version_num ?? '', /^17/u);
      assert.equal(environment.rows[0]?.admin_exists, true);

      await admin.query(`drop role if exists ${RUNTIME_ROLE}`);
      await admin.query(
        `create role ${RUNTIME_ROLE}
           login password '${RUNTIME_PASSWORD}'
           nosuperuser inherit nocreatedb nocreaterole noreplication nobypassrls`,
      );
      await admin.query(`grant ltc_m_runtime to ${RUNTIME_ROLE} with inherit true, set false`);

      const apiConfig = loadApiConfig({
        NODE_ENV: 'test',
        PORT: '3000',
        CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
        DATABASE_URL: runtimeUrl(adminUrl),
        DATABASE_SSL_MODE: 'disable',
      });
      databasePool = createDatabasePool(apiConfig.database);

      const identity = await withTransaction(databasePool, async (client) => {
        const result = await client.query<{
          current_user: string;
          rolsuper: boolean;
          rolbypassrls: boolean;
        }>(
          `select current_user, rolsuper, rolbypassrls
             from pg_catalog.pg_roles where rolname = current_user`,
        );
        return result.rows[0];
      });
      assert.deepEqual(identity, {
        current_user: RUNTIME_ROLE,
        rolsuper: false,
        rolbypassrls: false,
      });

      let actorBackendPid = 0;
      const actor = await withActorTransaction(
        databasePool,
        {
          appUserId: ADMIN_ID,
          authSubject: 'ci-p017|admin',
          requestId: 'p019-valid-context',
          source: 'api',
        },
        async (client) => {
          const result = await client.query<{
            app_user_id: string;
            app_role: string;
            backend_pid: number;
          }>(
            `select app_user_id, app_role, pg_backend_pid()::integer as backend_pid
               from ltc_m.authorization_context()`,
          );
          return result.rows[0];
        },
      );
      assert.equal(actor?.app_user_id, ADMIN_ID);
      assert.equal(actor?.app_role, 'admin');
      actorBackendPid = actor?.backend_pid ?? 0;

      const absent = await withTransaction(databasePool, async (client) => {
        const context = await client.query(`select * from ltc_m.authorization_context()`);
        const settings = await client.query<{
          app_user_id: string;
          backend_pid: number;
        }>(
          `select current_setting('ltc_m.app_user_id', true) as app_user_id,
                  pg_backend_pid()::integer as backend_pid`,
        );
        return { rows: context.rows.length, settings: settings.rows[0] };
      });
      assert.equal(absent.rows, 0);
      assert.equal(absent.settings?.app_user_id, '');
      assert.equal(absent.settings?.backend_pid, actorBackendPid);

      await assert.rejects(
        withActorTransaction(
          databasePool,
          {
            appUserId: '00000000-0000-4000-8000-000000019999',
            authSubject: 'auth0|p019-missing',
            requestId: 'p019-invalid-context',
            source: 'api',
          },
          async () => undefined,
        ),
        (error: unknown) =>
          typeof error === 'object' && error !== null && 'code' in error && error.code === 'P0001',
      );

      const afterRollback = await withTransaction(databasePool, async (client) => {
        const result = await client.query<{
          app_user_id: string;
          visible: number;
        }>(
          `select current_setting('ltc_m.app_user_id', true) as app_user_id,
                  (select count(*)::integer from ltc_m.app_users) as visible`,
        );
        return result.rows[0];
      });
      assert.deepEqual(afterRollback, { app_user_id: '', visible: 0 });

      const rls = await admin.query<{ missing: number }>(
        `select count(*)::integer as missing
           from pg_catalog.pg_class as relation
           join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
          where namespace.nspname = 'ltc_m'
            and relation.relkind = 'r'
            and (not relation.relrowsecurity or not relation.relforcerowsecurity)`,
      );
      assert.equal(rls.rows[0]?.missing, 0);
      assert.deepEqual(databasePool.counts, { total: 1, idle: 1, waiting: 0 });
      await databasePool.close();
      assert.deepEqual(databasePool.counts, { total: 0, idle: 0, waiting: 0 });
      databasePool = undefined;

      const sessions = await admin.query<{ count: number }>(
        `select count(*)::integer as count
           from pg_catalog.pg_stat_activity where usename = $1`,
        [RUNTIME_ROLE],
      );
      assert.equal(sessions.rows[0]?.count, 0);
      const locks = await admin.query<{ count: number }>(
        `select count(*)::integer as count
           from pg_catalog.pg_locks
          where locktype = 'advisory'
            and database = (select oid from pg_catalog.pg_database where datname = current_database())`,
      );
      assert.equal(locks.rows[0]?.count, 0);
    } finally {
      await databasePool?.close().catch(() => undefined);
      await admin.query(`revoke ltc_m_runtime from ${RUNTIME_ROLE}`).catch(() => undefined);
      await admin.query(`drop role if exists ${RUNTIME_ROLE}`).catch(() => undefined);
      await admin.end();
    }
  },
);
