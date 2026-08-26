import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';

import type { ActorContext, TransactionOperation } from './transaction.js';
import { withActorTransaction, withTransaction } from './transaction.js';
import { DATABASE_POOL } from './database.tokens.js';
import type { DatabasePool } from './database-pool.js';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: DatabasePool) {}

  transaction<T>(operation: TransactionOperation<T>): Promise<T> {
    return withTransaction(this.pool, operation);
  }

  actorTransaction<T>(context: ActorContext, operation: TransactionOperation<T>): Promise<T> {
    return withActorTransaction(this.pool, context, operation);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.close();
  }
}
