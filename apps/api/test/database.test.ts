import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import type { Pool, PoolClient, PoolConfig } from 'pg';

import type { DatabaseConfig } from '../src/config/api-config.js';
import { createDatabasePool, DatabasePool } from '../src/database/database-pool.js';
import {
  setActorContext,
  validateActorContext,
  withActorTransaction,
  withTransaction,
} from '../src/database/transaction.js';

class FakeClient {
  readonly commands: Array<{ text: string; values?: readonly unknown[] }> = [];
  releaseCount = 0;
  failOn = '';

  async query(text: string, values?: readonly unknown[]): Promise<unknown> {
    this.commands.push(values ? { text, values } : { text });
    if (text === this.failOn) throw new Error('synthetic failure');
    return { rows: [], rowCount: 0 };
  }

  release(): void {
    this.releaseCount += 1;
  }
}

class FakePgPool extends EventEmitter {
  endCount = 0;
  readonly client = new FakeClient();
  totalCount = 1;
  idleCount = 1;
  waitingCount = 0;

  async connect(): Promise<PoolClient> {
    return this.client as unknown as PoolClient;
  }

  async end(): Promise<void> {
    this.endCount += 1;
    this.totalCount = 0;
    this.idleCount = 0;
  }
}

const databaseConfig: DatabaseConfig = Object.freeze({
  connectionString: 'postgresql://p019_user:p019_local_only@127.0.0.1:5432/ltcm_test',
  sslMode: 'disable',
  poolMax: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 10_000,
  statementTimeoutMillis: 10_000,
});

function wrappedPool(): { wrapper: DatabasePool; pg: FakePgPool } {
  const pg = new FakePgPool();
  return { wrapper: new DatabasePool(pg as unknown as Pool), pg };
}

test('cria um pool com TLS e timeouts explícitos e sanitiza erro assíncrono', async () => {
  let receivedConfig: PoolConfig | undefined;
  let errorCode = '';
  const pg = new FakePgPool();
  const pool = createDatabasePool(
    { ...databaseConfig, sslMode: 'verify-full' },
    {
      createPool: (config) => {
        receivedConfig = config;
        return pg as unknown as Pool;
      },
      onUnexpectedError: (code) => {
        errorCode = code;
      },
    },
  );
  pg.emit('error', new Error('postgresql://secret@host/db'));
  assert.equal(errorCode, 'P019_DATABASE_POOL_ERROR');
  assert.deepEqual(receivedConfig?.ssl, { rejectUnauthorized: true });
  assert.equal(receivedConfig?.max, 10);
  await pool.close();
  await pool.close();
  assert.equal(pg.endCount, 1);
  await assert.rejects(pool.acquire(), /P019_DATABASE_POOL_CLOSED/u);
});

test('transação confirma e sempre libera a conexão', async () => {
  const { wrapper, pg } = wrappedPool();
  const result = await withTransaction(wrapper, async () => 'committed');
  assert.equal(result, 'committed');
  assert.deepEqual(
    pg.client.commands.map(({ text }) => text),
    ['BEGIN', 'COMMIT'],
  );
  assert.equal(pg.client.releaseCount, 1);
});

test('transação reverte e libera em erro', async () => {
  const { wrapper, pg } = wrappedPool();
  await assert.rejects(
    withTransaction(wrapper, async () => {
      throw new Error('operation failed');
    }),
    /operation failed/u,
  );
  assert.deepEqual(
    pg.client.commands.map(({ text }) => text),
    ['BEGIN', 'ROLLBACK'],
  );
  assert.equal(pg.client.releaseCount, 1);
});

test('contexto de ator usa função P008 parametrizada na mesma transação', async () => {
  const { wrapper, pg } = wrappedPool();
  const actor = Object.freeze({
    appUserId: '00000000-0000-4000-8000-000000019001',
    authSubject: 'auth0|p019-user',
    requestId: 'p019-request',
    source: 'api' as const,
  });
  await withActorTransaction(wrapper, actor, async () => undefined);
  assert.match(pg.client.commands[1]?.text ?? '', /ltc_m\.set_actor_context/u);
  assert.deepEqual(pg.client.commands[1]?.values, [
    actor.appUserId,
    actor.authSubject,
    actor.requestId,
    null,
    'api',
    false,
  ]);
  assert.deepEqual(
    pg.client.commands.map(({ text }) => text.trim()),
    ['BEGIN', pg.client.commands[1]?.text.trim(), 'COMMIT'],
  );
});

test('valida contexto ausente/sistema e identidade inválida antes do banco', async () => {
  assert.doesNotThrow(() =>
    validateActorContext({ appUserId: null, authSubject: null, source: 'system' }),
  );
  assert.throws(
    () => validateActorContext({ appUserId: null, authSubject: null, source: 'api' }),
    /P019_ACTOR_SYSTEM_CONTEXT_INVALID/u,
  );
  assert.throws(
    () => validateActorContext({ appUserId: 'not-a-uuid', authSubject: 'subject', source: 'api' }),
    /P019_ACTOR_IDENTITY_INVALID/u,
  );
  const { wrapper, pg } = wrappedPool();
  await setActorContext(pg.client as unknown as PoolClient, {
    appUserId: null,
    authSubject: null,
    source: 'system',
  });
  assert.deepEqual(pg.client.commands[0]?.values, [null, null, null, null, 'system', false]);
  await wrapper.close();
});
