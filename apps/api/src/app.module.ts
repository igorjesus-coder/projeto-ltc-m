import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';

@Module({ imports: [DatabaseModule, AuthModule] })
export class AppModule {}
