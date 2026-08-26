import type { PoolClient, QueryResultRow } from 'pg';

import type { DatabasePool } from './database-pool.js';

export interface ActorContext {
  readonly appUserId: string | null;
  readonly authSubject: string | null;
  readonly requestId?: string | null;
  readonly justification?: string | null;
  readonly source: 'api' | 'system';
  readonly exceptionalSelfApproval?: boolean;
}

export type TransactionOperation<T> = (client: PoolClient) => Promise<T>;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function validateOptionalText(value: string | null | undefined, max: number, code: string): void {
  if (value !== undefined && value !== null && (!value.trim() || value.length > max)) {
    throw new Error(code);
  }
}

export function validateActorContext(context: ActorContext): void {
  validateOptionalText(context.requestId, 200, 'P019_ACTOR_REQUEST_ID_INVALID');
  validateOptionalText(context.justification, 2_000, 'P019_ACTOR_JUSTIFICATION_INVALID');
  if (context.appUserId === null) {
    if (context.authSubject !== null || context.source !== 'system') {
      throw new Error('P019_ACTOR_SYSTEM_CONTEXT_INVALID');
    }
    return;
  }
  if (!isUuid(context.appUserId) || !context.authSubject?.trim()) {
    throw new Error('P019_ACTOR_IDENTITY_INVALID');
  }
}

export async function setActorContext(client: PoolClient, context: ActorContext): Promise<void> {
  validateActorContext(context);
  await client.query(
    `select ltc_m.set_actor_context(
       $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::boolean
     )`,
    [
      context.appUserId,
      context.authSubject,
      context.requestId ?? null,
      context.justification ?? null,
      context.source,
      context.exceptionalSelfApproval ?? false,
    ],
  );
}

export async function withTransaction<T>(
  pool: DatabasePool,
  operation: TransactionOperation<T>,
): Promise<T> {
  const client = await pool.acquire();
  let began = false;
  try {
    await client.query('BEGIN');
    began = true;
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (began) {
      try {
        await client.query('ROLLBACK');
      } catch {
        throw new Error('P019_TRANSACTION_ROLLBACK_FAILED', { cause: error });
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function withActorTransaction<T>(
  pool: DatabasePool,
  context: ActorContext,
  operation: TransactionOperation<T>,
): Promise<T> {
  validateActorContext(context);
  return withTransaction(pool, async (client) => {
    await setActorContext(client, context);
    return operation(client);
  });
}

export async function queryOne<Row extends QueryResultRow>(
  client: PoolClient,
  text: string,
  values: readonly unknown[] = [],
): Promise<Row | undefined> {
  const result = await client.query<Row>(text, [...values]);
  return result.rows[0];
}
