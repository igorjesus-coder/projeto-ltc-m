import { Global, Module } from '@nestjs/common';

import { loadApiConfig } from '../config/api-config.js';
import { createDatabasePool } from './database-pool.js';
import { DatabaseService } from './database.service.js';
import { DATABASE_POOL } from './database.tokens.js';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      useFactory: () => createDatabasePool(loadApiConfig(process.env).database),
    },
    DatabaseService,
  ],
  exports: [DATABASE_POOL, DatabaseService],
})
export class DatabaseModule {}
