import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Pool, type PoolClient } from 'pg';

import { sha256Canonical } from '../src/canonical-json.js';
import {
  createSourceLineKey,
  deriveTotalAmount,
  parseP012ExistingItemsSnapshot,
  parseQuantity,
  parseUnitPrice,
} from '../src/item-contracts.js';
import type {
  P012ActorContext,
  P012PersistenceOperation,
  P012PersistencePlan,
  P012PersistencePort,
} from '../src/item-persistence.js';
import {
  createP012PostgresTestHarness,
  parseP012LoopbackDatabaseUrlForTestHarness,
  type P012PostgresTestHarness,
} from './support/postgres-item-persistence.js';

const D12A_DATABASE_URL = process.env['LTCM_P012_TEST_DATABASE_URL'];
const D12A_LOCAL = D12A_DATABASE_URL !== undefined && D12A_DATABASE_URL !== '';
const ENABLED = process.env['LTCM_P012_INTEGRATION'] === '1';
const EXPECTED_MIGRATION_COUNT = 11;
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ADMIN_ID = '00000000-0000-4000-8000-000000012001';
const CLIENT_ID = '00000000-0000-4000-8000-000000012002';
const PROJECT_ID = '00000000-0000-4000-8000-000000012003';
const BATCH_ID = '00000000-0000-4000-8000-000000012004';
const SHEET_ID = '00000000-0000-4000-8000-000000012005';
const PROJECT_CODE = '2025-08-14656';
const PROJECT_CANDIDATE_ID = 'project-000000000000000000000012';
const MANIFEST_HASH = 'a'.repeat(64);
const WORKBOOK_HASH = 'b'.repeat(64);
const ACTOR: P012ActorContext = {
  appUserId: ADMIN_ID,
  authSubject: 'ci-p012|admin',
  requestId: 'ci-p012-apply',
  justification: 'Fixture sintética PostgreSQL P012 D12',
  source: 'import',
};

function databaseUrlFromEnvironment(): string {
  if (D12A_LOCAL) {
    parseP012LoopbackDatabaseUrlForTestHarness(D12A_DATABASE_URL);
    return D12A_DATABASE_URL;
  }
  const url = new URL('postgresql://127.0.0.1');
  url.hostname = process.env['PGHOST'] ?? '';
  url.port = process.env['PGPORT'] ?? '';
  url.pathname = `/${process.env['PGDATABASE'] ?? ''}`;
  url.username = 'postgres';
  url.password = process.env['LTCM_CI_POSTGRES_PASSWORD'] ?? '';
  parseP012LoopbackDatabaseUrlForTestHarness(url.href);
  return url.href;
}

function poolFromEnvironment(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl, max: 6 });
}

async function assertD12ADatabaseGuard(client: PoolClient): Promise<void> {
  const result = await client.query(
    `select current_database() as database_name,
            current_user,
            current_setting('server_version_num') as server_version_num,
            roles.rolsuper,
            roles.rolbypassrls
       from pg_catalog.pg_roles as roles
      where roles.rolname = current_user`,
  );
  const row = result.rows[0];
  const version = row?.['server_version_num'];
  if (
    result.rowCount !== 1 ||
    row?.['database_name'] !== 'ltcm_test' ||
    row?.['current_user'] !== 'postgres' ||
    typeof version !== 'string' ||
    !version.startsWith('17') ||
    row?.['rolsuper'] !== true ||
    row?.['rolbypassrls'] !== true
  ) {
    throw new Error('P012_D12A_DATABASE_GUARD_FAILED');
  }
}

async function installD12AAdminBeforeRls(client: PoolClient): Promise<void> {
  await client.query('begin');
  try {
    await client.query(
      `select ltc_m.set_actor_context(null, null, $1::text, null, 'system', false)`,
      ['d12a-migration-bootstrap'],
    );
    await client.query(
      `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
       values ($1::uuid, $2::text, $3::text, 'admin', true)`,
      [ADMIN_ID, ACTOR.authSubject, 'D12A P012 Admin'],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}

async function applyD12AMigrations(pool: Pool): Promise<boolean> {
  const migrationsDirectory = path.join(REPOSITORY_ROOT, 'supabase', 'migrations');
  const migrations = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right, 'en'));
  assert.equal(migrations.length, EXPECTED_MIGRATION_COUNT);
  const client = await pool.connect();
  try {
    await assertD12ADatabaseGuard(client);
    const preflight = await client.query(
      `select pg_catalog.to_regnamespace('ltc_m') is not null as schema_exists`,
    );
    const createdSchema = preflight.rows[0]?.['schema_exists'] === false;
    if (createdSchema) {
      for (const [index, migration] of migrations.entries()) {
        const sql = await readFile(path.join(migrationsDirectory, migration), 'utf8');
        await client.query(sql);
        if (index === 6) await installD12AAdminBeforeRls(client);
      }
    } else {
      await installD12AAdminBeforeRls(client);
    }
    const result = await client.query(
      `select count(*)::integer as table_count
         from pg_catalog.pg_tables
        where schemaname = 'ltc_m'`,
    );
    assert.equal(result.rows[0]?.['table_count'], 15);
    return createdSchema;
  } finally {
    client.release();
  }
}

async function ensureD12ARuntimeMembership(pool: Pool): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `select pg_catalog.pg_has_role(current_user, 'ltc_m_runtime', 'set') as can_set`,
    );
    if (result.rows[0]?.['can_set'] === true) return false;
    await client.query('grant ltc_m_runtime to current_user');
    return true;
  } finally {
    client.release();
  }
}

async function assertD12ARuntimeSecurityCompatibility(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `select target.relforcerowsecurity as force_rls,
              owner.rolsuper as owner_superuser,
              owner.rolbypassrls as owner_bypass_rls
         from pg_catalog.pg_class as target
         join pg_catalog.pg_namespace as target_namespace
           on target_namespace.oid = target.relnamespace
         join pg_catalog.pg_proc as context_function
           on context_function.oid = pg_catalog.to_regprocedure(
             'ltc_m.set_actor_context(uuid,text,text,text,text,boolean)'
           )
         join pg_catalog.pg_roles as owner
           on owner.oid = context_function.proowner
        where target_namespace.nspname = 'ltc_m'
          and target.relname = 'app_users'`,
    );
    const row = result.rows[0];
    if (
      result.rowCount !== 1 ||
      row === undefined ||
      (row['force_rls'] === true &&
        row['owner_superuser'] !== true &&
        row['owner_bypass_rls'] !== true)
    ) {
      throw new Error('P012_D12A_RUNTIME_SECURITY_INCOMPATIBLE');
    }
  } finally {
    client.release();
  }
}

async function cleanupD12A(
  pool: Pool,
  cleanupFixtures: boolean,
  revokeRuntimeMembership: boolean,
): Promise<void> {
  const client = await pool.connect();
  try {
    await assertD12ADatabaseGuard(client);
    if (cleanupFixtures) {
      await client.query('truncate table ltc_m.app_users, ltc_m.currencies, ltc_m.units cascade');
    }
    if (revokeRuntimeMembership) {
      await client.query('revoke ltc_m_runtime from current_user');
    }
  } finally {
    client.release();
  }
}

async function assertMigratedSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const tables = await client.query(
      `select count(*)::integer as table_count,
              count(*) filter (where target.relrowsecurity)::integer as rls_count,
              count(*) filter (where target.relforcerowsecurity)::integer as force_rls_count
         from pg_catalog.pg_class as target
         join pg_catalog.pg_namespace as target_namespace
           on target_namespace.oid = target.relnamespace
        where target_namespace.nspname = 'ltc_m'
          and target.relkind = 'r'`,
    );
    assert.deepEqual(tables.rows[0], {
      table_count: EXPECTED_MIGRATION_COUNT + 4,
      rls_count: EXPECTED_MIGRATION_COUNT + 4,
      force_rls_count: EXPECTED_MIGRATION_COUNT + 4,
    });
    const objects = await client.query(
      `select
         pg_catalog.to_regprocedure(
           'ltc_m.set_actor_context(uuid,text,text,text,text,boolean)'
         ) is not null as actor_function,
         pg_catalog.to_regprocedure('ltc_m.authorization_context()') is not null
           as authorization_function,
         exists (
           select 1
             from information_schema.columns
            where table_schema = 'ltc_m'
              and table_name = 'project_items'
              and column_name = 'total_amount'
              and is_generated = 'ALWAYS'
         ) as generated_total,
         exists (
           select 1
             from pg_catalog.pg_constraint
            where conrelid = 'ltc_m.project_items'::pg_catalog.regclass
              and conname = 'fk_project_items_project_currency'
         ) as project_currency_fk,
         exists (
           select 1
             from pg_catalog.pg_indexes
            where schemaname = 'ltc_m'
              and indexname = 'uq_project_items_source_key_active'
         ) as source_key_unique,
         exists (
           select 1
             from pg_catalog.pg_indexes
            where schemaname = 'ltc_m'
              and indexname = 'uq_project_items_line_number_active'
         ) as line_number_unique,
         (
           select count(*)
             from pg_catalog.pg_trigger
            where tgrelid = 'ltc_m.project_items'::pg_catalog.regclass
              and not tgisinternal
         ) = 4 as item_triggers`,
    );
    assert.ok(Object.values(objects.rows[0] ?? {}).every((value) => value === true));
  } finally {
    client.release();
  }
}

async function assertActorContextAndRls(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role ltc_m_runtime');
    await client.query(
      `select ltc_m.set_actor_context($1::uuid, $2::text, $3::text, $4::text, 'import', false)`,
      [ADMIN_ID, ACTOR.authSubject, 'ci-p012-actor-proof', ACTOR.justification],
    );
    const result = await client.query(
      `select auth_context.app_user_id::text as app_user_id,
              auth_context.app_role::text as app_role,
              target.relrowsecurity as rls,
              target.relforcerowsecurity as force_rls
         from ltc_m.authorization_context() as auth_context
         cross join pg_catalog.pg_class as target
        where target.oid = 'ltc_m.project_items'::pg_catalog.regclass`,
    );
    assert.deepEqual(result.rows[0], {
      app_user_id: ADMIN_ID,
      app_role: 'admin',
      rls: true,
      force_rls: true,
    });
    await client.query('rollback');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function assertSerializableAndAdvisoryLocks(pool: Pool): Promise<void> {
  const first = await pool.connect();
  const second = await pool.connect();
  const lockName = `ltc_m.p012.project:${PROJECT_ID}`;
  try {
    await first.query('begin isolation level serializable');
    const isolation = await first.query(
      `select current_setting('transaction_isolation') as isolation_level`,
    );
    assert.equal(isolation.rows[0]?.['isolation_level'], 'serializable');
    await first.query(
      `select pg_catalog.pg_advisory_xact_lock(
         pg_catalog.hashtextextended($1::text, 0)
       )`,
      [lockName],
    );
    await second.query('begin');
    const blocked = await second.query(
      `select pg_catalog.pg_try_advisory_xact_lock(
         pg_catalog.hashtextextended($1::text, 0)
       ) as acquired`,
      [lockName],
    );
    assert.equal(blocked.rows[0]?.['acquired'], false);
    await first.query('commit');
    const afterCommit = await second.query(
      `select pg_catalog.pg_try_advisory_xact_lock(
         pg_catalog.hashtextextended($1::text, 0)
       ) as acquired`,
      [lockName],
    );
    assert.equal(afterCommit.rows[0]?.['acquired'], true);
    await second.query('rollback');

    await first.query('begin');
    await first.query(
      `select pg_catalog.pg_advisory_xact_lock(
         pg_catalog.hashtextextended($1::text, 0)
       )`,
      [lockName],
    );
    await second.query('begin');
    const blockedAgain = await second.query(
      `select pg_catalog.pg_try_advisory_xact_lock(
         pg_catalog.hashtextextended($1::text, 0)
       ) as acquired`,
      [lockName],
    );
    assert.equal(blockedAgain.rows[0]?.['acquired'], false);
    await first.query('rollback');
    const afterRollback = await second.query(
      `select pg_catalog.pg_try_advisory_xact_lock(
         pg_catalog.hashtextextended($1::text, 0)
       ) as acquired`,
      [lockName],
    );
    assert.equal(afterRollback.rows[0]?.['acquired'], true);
    await second.query('rollback');
  } finally {
    await first.query('rollback').catch(() => undefined);
    await second.query('rollback').catch(() => undefined);
    first.release();
    second.release();
  }
}

async function assertCanonicalMultiProjectLockOrder(port: P012PersistencePort): Promise<void> {
  const secondProjectId = '00000000-0000-4000-8000-000000012099';
  const results = await Promise.all([
    port.serializableTransaction('test', ACTOR, async (transaction) => {
      await transaction.acquireProjectLocks([PROJECT_ID, secondProjectId]);
      return 'forward';
    }),
    port.serializableTransaction('test', ACTOR, async (transaction) => {
      await transaction.acquireProjectLocks([secondProjectId, PROJECT_ID]);
      return 'reverse';
    }),
  ]);
  assert.deepEqual(results.sort(), ['forward', 'reverse']);
}

interface DirectItemInput {
  projectId?: string;
  sourceLineKey: string;
  lineNumber: number;
  quantity: string;
  unitCode?: string;
  currencyCode?: string;
  unitPrice: string;
}

async function insertDirectItem(client: PoolClient, input: DirectItemInput) {
  return client.query(
    `insert into ltc_m.project_items
       (project_id, source_line_key, line_number, quantity, unit_code,
        currency_code, unit_price, active)
     values ($1::uuid, $2::text, $3::integer, $4::numeric, $5::text,
             $6::text, $7::numeric, true)
     returning id::text as id, quantity::text as quantity,
               unit_price::text as unit_price, total_amount::text as total_amount,
               row_version::text as row_version`,
    [
      input.projectId ?? PROJECT_ID,
      input.sourceLineKey,
      input.lineNumber,
      input.quantity,
      input.unitCode ?? 'US',
      input.currencyCode ?? 'BRL',
      input.unitPrice,
    ],
  );
}

async function withRuntimeRollback(
  pool: Pool,
  requestId: string,
  work: (client: PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role ltc_m_runtime');
    await client.query(
      `select ltc_m.set_actor_context($1::uuid, $2::text, $3::text, $4::text, 'import', false)`,
      [ADMIN_ID, ACTOR.authSubject, requestId, ACTOR.justification],
    );
    await work(client);
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
}

async function establishRuntimeActor(client: PoolClient, requestId: string): Promise<void> {
  await client.query('set local role ltc_m_runtime');
  await client.query(
    `select ltc_m.set_actor_context($1::uuid, $2::text, $3::text, $4::text, 'import', false)`,
    [ADMIN_ID, ACTOR.authSubject, requestId, ACTOR.justification],
  );
}

async function assertSqlState(
  pool: Pool,
  requestId: string,
  input: DirectItemInput,
  expectedCode: string,
  duplicate = false,
): Promise<void> {
  await withRuntimeRollback(pool, requestId, async (client) => {
    if (duplicate) await insertDirectItem(client, input);
    await assert.rejects(
      insertDirectItem(client, duplicate ? { ...input, lineNumber: input.lineNumber + 1 } : input),
      (error: unknown) =>
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === expectedCode,
    );
  });
}

async function assertNumericAndConstraints(pool: Pool): Promise<void> {
  await withRuntimeRollback(pool, 'ci-p012-numeric-valid', async (client) => {
    const minimum = await insertDirectItem(client, {
      sourceLineKey: 'p012-d12a-minimum',
      lineNumber: 901,
      quantity: '0.0001',
      unitPrice: '0.0000',
    });
    assert.deepEqual(minimum.rows[0], {
      id: minimum.rows[0]?.['id'],
      quantity: '0.0001',
      unit_price: '0.0000',
      total_amount: '0.00',
      row_version: '1',
    });
    const large = await insertDirectItem(client, {
      sourceLineKey: 'p012-d12a-large',
      lineNumber: 902,
      quantity: '9999999999999999.9999',
      unitPrice: '0.0001',
    });
    assert.equal(large.rows[0]?.['total_amount'], '1000000000000.00');
    const carry = await insertDirectItem(client, {
      sourceLineKey: 'p012-d12a-carry',
      lineNumber: 903,
      quantity: '1.0000',
      unitPrice: '9999999999999999.9950',
    });
    assert.equal(carry.rows[0]?.['total_amount'], '10000000000000000.00');
  });
  await assertSqlState(
    pool,
    'ci-p012-zero-quantity',
    {
      sourceLineKey: 'p012-d12a-zero-quantity',
      lineNumber: 904,
      quantity: '0.0000',
      unitPrice: '1.0000',
    },
    '23514',
  );
  await assertSqlState(
    pool,
    'ci-p012-overflow',
    {
      sourceLineKey: 'p012-d12a-overflow',
      lineNumber: 905,
      quantity: '10000000000000000.0000',
      unitPrice: '1.0000',
    },
    '22003',
  );
  await assertSqlState(
    pool,
    'ci-p012-project-fk',
    {
      projectId: '00000000-0000-4000-8000-000000012099',
      sourceLineKey: 'p012-d12a-project-fk',
      lineNumber: 906,
      quantity: '1.0000',
      unitPrice: '1.0000',
    },
    '23503',
  );
  await assertSqlState(
    pool,
    'ci-p012-unit-fk',
    {
      sourceLineKey: 'p012-d12a-unit-fk',
      lineNumber: 907,
      quantity: '1.0000',
      unitCode: 'MISSING',
      unitPrice: '1.0000',
    },
    '23503',
  );
  await assertSqlState(
    pool,
    'ci-p012-currency-fk',
    {
      sourceLineKey: 'p012-d12a-currency-fk',
      lineNumber: 908,
      quantity: '1.0000',
      currencyCode: 'USD',
      unitPrice: '1.0000',
    },
    '23503',
  );
  await assertSqlState(
    pool,
    'ci-p012-unique',
    {
      sourceLineKey: 'p012-d12a-unique',
      lineNumber: 909,
      quantity: '1.0000',
      unitPrice: '1.0000',
    },
    '23505',
    true,
  );
}

async function databaseMutationState(pool: Pool): Promise<Record<string, number>> {
  const result = await pool.query(
    `select
       (select count(*)::integer from ltc_m.project_items) as items,
       (
         select count(*)::integer
           from ltc_m.import_staging_rows
          where target_table is not null or target_record_id is not null
       ) as linked_staging,
       (
         select coalesce(sum(row_version), 0)::integer
           from ltc_m.project_items
       ) as item_row_versions`,
  );
  return result.rows[0] as Record<string, number>;
}

async function assertRealSerializationFailure(pool: Pool): Promise<void> {
  const first = await pool.connect();
  const second = await pool.connect();
  try {
    await first.query('begin isolation level serializable');
    await second.query('begin isolation level serializable');
    await establishRuntimeActor(first, 'ci-p012-40001-a');
    await establishRuntimeActor(second, 'ci-p012-40001-b');
    await Promise.all([
      first.query(`select count(*) from ltc_m.project_items where project_id = $1::uuid`, [
        PROJECT_ID,
      ]),
      second.query(`select count(*) from ltc_m.project_items where project_id = $1::uuid`, [
        PROJECT_ID,
      ]),
    ]);
    await insertDirectItem(first, {
      sourceLineKey: 'p012-d12a-40001-a',
      lineNumber: 950,
      quantity: '1.0000',
      unitPrice: '1.0000',
    });
    await insertDirectItem(second, {
      sourceLineKey: 'p012-d12a-40001-b',
      lineNumber: 951,
      quantity: '1.0000',
      unitPrice: '1.0000',
    });
    const commits = await Promise.allSettled([first.query('commit'), second.query('commit')]);
    const failures = commits.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    assert.equal(failures.length, 1);
    assert.equal((failures[0]?.reason as { code?: string }).code, '40001');
    const persisted = await pool.query(
      `select count(*)::integer as item_count
         from ltc_m.project_items
        where source_line_key = any($1::text[])`,
      [['p012-d12a-40001-a', 'p012-d12a-40001-b']],
    );
    assert.equal(persisted.rows[0]?.['item_count'], 1);
  } finally {
    await first.query('rollback').catch(() => undefined);
    await second.query('rollback').catch(() => undefined);
    first.release();
    second.release();
  }
}

async function assertRealDeadlock(pool: Pool): Promise<void> {
  const first = await pool.connect();
  const second = await pool.connect();
  try {
    await first.query('begin');
    await second.query('begin');
    await first.query(`set local deadlock_timeout = '100ms'`);
    await second.query(`set local deadlock_timeout = '100ms'`);
    await first.query(`select pg_catalog.pg_advisory_xact_lock(12001)`);
    await second.query(`select pg_catalog.pg_advisory_xact_lock(12002)`);
    const firstWait = first.query(`select pg_catalog.pg_advisory_xact_lock(12002)`);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const secondWait = second.query(`select pg_catalog.pg_advisory_xact_lock(12001)`);
    const waits = await Promise.allSettled([firstWait, secondWait]);
    const failures = waits.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    assert.equal(failures.length, 1);
    assert.equal((failures[0]?.reason as { code?: string }).code, '40P01');
  } finally {
    await first.query('rollback').catch(() => undefined);
    await second.query('rollback').catch(() => undefined);
    first.release();
    second.release();
  }
}

async function assertConcurrentDivergentIdentity(pool: Pool): Promise<void> {
  const first = await pool.connect();
  const second = await pool.connect();
  const sourceLineKey = 'p012-d12a-concurrent-divergent';
  try {
    await first.query('begin isolation level serializable');
    await second.query('begin isolation level serializable');
    await establishRuntimeActor(first, 'ci-p012-divergent-a');
    await establishRuntimeActor(second, 'ci-p012-divergent-b');
    await insertDirectItem(first, {
      sourceLineKey,
      lineNumber: 960,
      quantity: '1.0000',
      unitPrice: '1.0000',
    });
    const competingInsert = insertDirectItem(second, {
      sourceLineKey,
      lineNumber: 961,
      quantity: '2.0000',
      unitPrice: '3.0000',
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await first.query('commit');
    await assert.rejects(
      competingInsert,
      (error: unknown) =>
        error !== null && typeof error === 'object' && 'code' in error && error.code === '23505',
    );
    await second.query('rollback');
    const final = await pool.query(
      `select count(*)::integer as item_count,
              min(quantity)::text as quantity,
              min(unit_price)::text as unit_price
         from ltc_m.project_items
        where source_line_key = $1::text`,
      [sourceLineKey],
    );
    assert.deepEqual(final.rows[0], {
      item_count: 1,
      quantity: '1.0000',
      unit_price: '1.0000',
    });
  } finally {
    await first.query('rollback').catch(() => undefined);
    await second.query('rollback').catch(() => undefined);
    first.release();
    second.release();
  }
}

function operation(line: number): P012PersistenceOperation {
  const quantity = line === 2 ? '0.0001' : '1.0000';
  const unitPrice = line === 1 ? '0.0000' : line === 3 ? '2.3450' : `${line}.0000`;
  return {
    order: line,
    action: 'insert',
    candidate_id: `item-${line.toString(16).padStart(24, '0')}`,
    candidate_hash: sha256Canonical({ line }),
    project_candidate_id: PROJECT_CANDIDATE_ID,
    project_id: PROJECT_ID,
    source_line_key: createSourceLineKey(PROJECT_CODE, line),
    line_number: line,
    item_code: 'REPEATED-CODE',
    description: `Item sintético ${line}`,
    quantity,
    unit_code: 'US',
    currency_code: 'BRL',
    unit_price: unitPrice,
    total_amount: deriveTotalAmount(parseQuantity(quantity), parseUnitPrice(unitPrice)),
    expected_target_id: null,
    expected_row_version: null,
    staging: {
      sheet_key: 'monthly_revenue',
      source_row_number: line + 3,
      row_hash: sha256Canonical({ contract: 'ci.p012.row.v1', line }),
    },
  };
}

function plan(operations: P012PersistenceOperation[]): P012PersistencePlan {
  return {
    contract: 'ltcm.p012.persistence-plan.v1',
    payload_schema_version: 1,
    logical_environment: 'test',
    batch: {
      id: BATCH_ID,
      idempotency_key: `ltcm-p011:${MANIFEST_HASH}`,
      source_hash: WORKBOOK_HASH,
    },
    p010_manifest_hash: MANIFEST_HASH,
    input_hash: 'c'.repeat(64),
    workbook_hash: WORKBOOK_HASH,
    p011_artifacts_hash: 'd'.repeat(64),
    p012_candidate_set_hash: 'e'.repeat(64),
    snapshot_hash: 'f'.repeat(64),
    project_targets: [{ project_candidate_id: PROJECT_CANDIDATE_ID, project_id: PROJECT_ID }],
    operations,
    expected_counts: {
      attempted: 48,
      insert: operations.filter(({ action }) => action === 'insert').length,
      no_op: operations.filter(({ action }) => action === 'no_op').length,
      conflict: 0,
      rejected: 0,
      pending: 0,
    },
    plan_hash: '0'.repeat(64),
  };
}

async function setup(pool: Pool, operations: P012PersistenceOperation[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (D12A_LOCAL) {
      await client.query('set local role ltc_m_runtime');
    } else {
      await client.query(
        `select ltc_m.set_actor_context(null, null, $1::text, null, 'system', false)`,
        ['ci-p012-setup-actor'],
      );
      await client.query(
        `insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
         values ($1::uuid, $2::text, $3::text, 'admin', true)`,
        [ADMIN_ID, ACTOR.authSubject, 'CI P012 Admin'],
      );
    }
    await client.query(
      `select ltc_m.set_actor_context($1::uuid, $2::text, $3::text, $4::text, 'import', false)`,
      [ADMIN_ID, ACTOR.authSubject, 'ci-p012-setup-data', ACTOR.justification],
    );
    await client.query(
      `insert into ltc_m.currencies (code, name, decimal_places, active)
       values ('BRL', 'Real sintÃ©tico D12A', 2, true)
       on conflict (code) do nothing`,
    );
    await client.query(
      `insert into ltc_m.units (code, name, category, active)
       values ('US', 'Unidade e ServiÃ§o sintÃ©tica D12A', 'd12a', true)
       on conflict (code) do nothing`,
    );
    await client.query(
      `insert into ltc_m.clients (id, legal_name, display_name)
       values ($1::uuid, $2::text, $2::text)`,
      [CLIENT_ID, 'Cliente sintético CI P012'],
    );
    await client.query(
      `insert into ltc_m.projects
         (id, project_code, project_name, client_id, base_currency,
          contract_value, data_reference_date, status)
       values ($1::uuid, $2::text, $3::text, $4::uuid, 'BRL', 100, date '2026-08-17', 'active')`,
      [PROJECT_ID, PROJECT_CODE, 'Projeto sintético CI P012', CLIENT_ID],
    );
    await client.query(
      `insert into ltc_m.import_batches
         (id, source_name, source_hash, idempotency_key, submitted_by_user_id, status)
       values ($1::uuid, 'ci-p012.xlsx', $2::text, $3::text, $4::uuid, 'received')`,
      [BATCH_ID, WORKBOOK_HASH, `ltcm-p011:${MANIFEST_HASH}`, ADMIN_ID],
    );
    await client.query(
      `insert into ltc_m.import_batch_sheets
         (id, import_batch_id, sheet_key, sheet_name, sheet_index,
          found_rows, staged_rows, status, created_by_user_id)
       values ($1::uuid, $2::uuid, 'monthly_revenue', 'Receita Mensal', 1,
               48, 48, 'completed', $3::uuid)`,
      [SHEET_ID, BATCH_ID, ADMIN_ID],
    );
    for (const current of operations) {
      await client.query(
        `insert into ltc_m.import_staging_rows
           (import_batch_sheet_id, source_row_number, source_range, row_kind,
            raw_payload, row_hash, status, created_by_user_id)
         values ($1::uuid, $2::integer, $3::text, 'data', $4::jsonb,
                 $5::text, 'valid', $6::uuid)`,
        [
          SHEET_ID,
          current.staging.source_row_number,
          `A${current.staging.source_row_number}:T${current.staging.source_row_number}`,
          JSON.stringify({ synthetic: true, line: current.line_number }),
          current.staging.row_hash,
          ADMIN_ID,
        ],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

test(
  'P012 PostgreSQL 17 integra rollback tardio, 48 inserts, concorrência e rerun no-op',
  { skip: !ENABLED },
  async () => {
    const databaseUrl = databaseUrlFromEnvironment();
    const rawPool = poolFromEnvironment(databaseUrl);
    let testHarness: P012PostgresTestHarness | null = null;
    let revokeRuntimeMembership = false;
    let d12aSchemaReady = false;
    let d12aCleanupRequired = false;
    try {
      if (D12A_LOCAL) {
        const guardClient = await rawPool.connect();
        try {
          await assertD12ADatabaseGuard(guardClient);
        } finally {
          guardClient.release();
        }
        d12aCleanupRequired = await applyD12AMigrations(rawPool);
        d12aSchemaReady = true;
        await assertD12ARuntimeSecurityCompatibility(rawPool);
        revokeRuntimeMembership = await ensureD12ARuntimeMembership(rawPool);
      }
      await assertMigratedSchema(rawPool);
      const pool = rawPool;
      testHarness = createP012PostgresTestHarness('test', databaseUrl, {
        setLocalRuntimeRoleForTests: true,
      });
      const adapter = testHarness.adapter;
      const operations = Array.from({ length: 48 }, (_, index) => operation(index + 1));
      const scope = {
        projects: [
          {
            project_candidate_id: PROJECT_CANDIDATE_ID,
            project_code: PROJECT_CODE,
            expected_id: PROJECT_ID,
          },
        ],
      };
      if (D12A_LOCAL) d12aCleanupRequired = true;
      await setup(pool, operations);
      await assertActorContextAndRls(pool);
      await assertSerializableAndAdvisoryLocks(pool);
      await assertCanonicalMultiProjectLockOrder(adapter);
      await assertNumericAndConstraints(pool);
      const invalid = operations.map((current) => ({ ...current }));
      invalid[46] = { ...invalid[46]!, currency_code: 'USD' };
      await assert.rejects(
        adapter.serializableTransaction('test', ACTOR, async (transaction) => {
          await transaction.acquireProjectLocks([PROJECT_ID]);
          const staging = await transaction.validateBatchAndStaging(plan(invalid));
          const stagingByCandidate = new Map(
            staging.map((row) => [row.candidate_id, row.staging_row_id]),
          );
          for (const current of invalid) {
            const inserted = await transaction.insertItem(current);
            const target = inserted as { id: string };
            await transaction.linkStaging(stagingByCandidate.get(current.candidate_id)!, target.id);
          }
        }),
      );
      const afterRollback = parseP012ExistingItemsSnapshot(
        await adapter.readExistingItemsSnapshot(scope, ACTOR),
      );
      assert.equal(afterRollback.items.length, 0);
      const dryRunStateBefore = await databaseMutationState(pool);
      await adapter.readExistingItemsSnapshot(scope, ACTOR);
      assert.deepEqual(await databaseMutationState(pool), dryRunStateBefore);

      const runImport = async (): Promise<{ inserted: number; noOp: number; conflict: number }> => {
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            return await adapter.serializableTransaction('test', ACTOR, async (transaction) => {
              await transaction.acquireProjectLocks([PROJECT_ID]);
              const snapshot = parseP012ExistingItemsSnapshot(
                await transaction.readExistingItemsSnapshot(scope),
              );
              const existingByLine = new Map(
                snapshot.items.map((item) => [item.line_number, item]),
              );
              const currentOperations = operations.map((current) => {
                const existing = existingByLine.get(current.line_number);
                return existing === undefined
                  ? current
                  : {
                      ...current,
                      action: 'no_op' as const,
                      expected_target_id: existing.id,
                      expected_row_version: existing.row_version,
                    };
              });
              const staging = await transaction.validateBatchAndStaging(plan(currentOperations));
              const stagingByCandidate = new Map(
                staging.map((row) => [row.candidate_id, row.staging_row_id]),
              );
              let inserted = 0;
              let noOp = 0;
              for (const current of currentOperations) {
                const existing = existingByLine.get(current.line_number);
                let targetId: string;
                if (existing === undefined) {
                  const raw = await transaction.insertItem(current);
                  const parsed = parseP012ExistingItemsSnapshot({
                    ...snapshot,
                    items: [...snapshot.items, raw],
                  });
                  const item = parsed.items.find(
                    ({ line_number }) => line_number === current.line_number,
                  )!;
                  assert.equal(item.total_amount, current.total_amount);
                  targetId = item.id;
                  inserted += 1;
                } else {
                  targetId = existing.id;
                  noOp += 1;
                }
                await transaction.linkStaging(
                  stagingByCandidate.get(current.candidate_id)!,
                  targetId,
                );
              }
              return { inserted, noOp, conflict: 0 };
            });
          } catch (error) {
            const code = (error as { code?: string }).code;
            if ((code === '40001' || code === '40P01') && attempt < 2) continue;
            if (code === '23505') return { inserted: 0, noOp: 0, conflict: 1 };
            throw error;
          }
        }
        throw new Error('retry P012 esgotado');
      };

      const results = await Promise.all([runImport(), runImport()]);
      const ordered = results.sort((left, right) => right.inserted - left.inserted);
      assert.deepEqual(ordered[0], { inserted: 48, noOp: 0, conflict: 0 });
      assert.deepEqual(ordered[1], { inserted: 0, noOp: 48, conflict: 0 });
      const finalSnapshot = parseP012ExistingItemsSnapshot(
        await adapter.readExistingItemsSnapshot(scope, ACTOR),
      );
      assert.equal(finalSnapshot.items.length, 48);
      assert.equal(new Set(finalSnapshot.items.map(({ id }) => id)).size, 48);
      assert.equal(new Set(finalSnapshot.items.map(({ item_code }) => item_code)).size, 1);
      assert.ok(finalSnapshot.items.every(({ row_version }) => row_version === 1));
      const firstPersisted = finalSnapshot.items.find(({ line_number }) => line_number === 1);
      assert.deepEqual(firstPersisted, {
        id: firstPersisted?.id,
        project_id: PROJECT_ID,
        source_line_key: createSourceLineKey(PROJECT_CODE, 1),
        line_number: 1,
        item_code: 'REPEATED-CODE',
        description: operations[0]?.description,
        quantity: '1.0000',
        unit_code: 'US',
        currency_code: 'BRL',
        unit_price: '0.0000',
        total_amount: '0.00',
        active: true,
        deleted_at: null,
        row_version: 1,
      });
      const identitiesBeforeRerun = finalSnapshot.items.map(({ id, row_version }) => ({
        id,
        row_version,
      }));
      assert.deepEqual(await runImport(), { inserted: 0, noOp: 48, conflict: 0 });
      const afterLostReceiptRerun = parseP012ExistingItemsSnapshot(
        await adapter.readExistingItemsSnapshot(scope, ACTOR),
      );
      assert.deepEqual(
        afterLostReceiptRerun.items.map(({ id, row_version }) => ({ id, row_version })),
        identitiesBeforeRerun,
      );
      const stagingLinks = await pool.query(
        `select count(*)::integer as linked_count
           from ltc_m.import_staging_rows
          where target_table = 'project_items'
            and target_record_id is not null`,
      );
      assert.equal(stagingLinks.rows[0]?.['linked_count'], 48);
      await assertRealSerializationFailure(pool);
      await assertRealDeadlock(pool);
      await assertConcurrentDivergentIdentity(pool);
    } finally {
      await testHarness?.close();
      if (D12A_LOCAL && d12aSchemaReady) {
        await cleanupD12A(rawPool, d12aCleanupRequired, revokeRuntimeMembership);
      }
      const locks = await rawPool.query(
        `select count(*)::integer as lock_count
           from pg_catalog.pg_locks
          where locktype = 'advisory'
            and database = (
              select oid from pg_catalog.pg_database where datname = current_database()
            )`,
      );
      assert.equal(locks.rows[0]?.['lock_count'], 0);
      assert.equal(rawPool.waitingCount, 0);
      await rawPool.end();
      assert.equal(rawPool.totalCount, 0);
    }
  },
);
