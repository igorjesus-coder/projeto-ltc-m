import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ProjectsModule } from './projects/projects.module.js';

@Module({ imports: [DatabaseModule, AuthModule, ProjectsModule] })
export class AppModule {}
