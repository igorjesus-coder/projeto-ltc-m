import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { MasterDataModule } from './master-data/master-data.module.js';
import { ProjectItemsModule } from './project-items/project-items.module.js';

@Module({
  imports: [DatabaseModule, AuthModule, ProjectsModule, MasterDataModule, ProjectItemsModule],
})
export class AppModule {}
