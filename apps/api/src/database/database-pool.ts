import { Pool, types as pgTypes, type PoolClient, type PoolConfig } from 'pg';

import type { DatabaseConfig } from '../config/api-config.js';

const EXACT_TEXT_OIDS = new Set([20, 1082, 1114, 1184, 1700]);
const exactTypeParsers = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (format !== 'binary' && EXACT_TEXT_OIDS.has(oid)) return (value: string) => value;
    return pgTypes.getTypeParser(oid, format ?? 'text');
  },
} as PoolConfig['types'];

export type DatabasePoolErrorHandler = (code: 'P019_DATABASE_POOL_ERROR') => void;
export type PgPoolFactory = (config: PoolConfig) => Pool;

export class DatabasePool {
  private closed = false;

  constructor(
    private readonly pool: Pool,
    onUnexpectedError: DatabasePoolErrorHandler = () => undefined,
  ) {
    this.pool.on('error', () => onUnexpectedError('P019_DATABASE_POOL_ERROR'));
  }

  async acquire(): Promise<PoolClient> {
    if (this.closed) throw new Error('P019_DATABASE_POOL_CLOSED');
    return this.pool.connect();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }

  get counts(): Readonly<{ total: number; idle: number; waiting: number }> {
    return Object.freeze({
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    });
  }
}

export function createDatabasePool(
  config: DatabaseConfig,
  options: Readonly<{
    createPool?: PgPoolFactory;
    onUnexpectedError?: DatabasePoolErrorHandler;
  }> = {},
): DatabasePool {
  const poolConfig: PoolConfig = {
    connectionString: config.connectionString,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    idleTimeoutMillis: config.idleTimeoutMillis,
    statement_timeout: config.statementTimeoutMillis,
    application_name: 'ltcm-api',
    ssl: config.sslMode === 'verify-full' ? { rejectUnauthorized: true } : false,
    types: exactTypeParsers,
  };
  const pool = (options.createPool ?? ((value) => new Pool(value)))(poolConfig);
  return new DatabasePool(pool, options.onUnexpectedError);
}
