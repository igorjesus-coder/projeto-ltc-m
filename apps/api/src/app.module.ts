import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { MasterDataModule } from './master-data/master-data.module.js';
import { ProjectItemsModule } from './project-items/project-items.module.js';
import { PlanningModule } from './planning/planning.module.js';
import { RealizedEventsModule } from './realized-events/realized-events.module.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    ProjectsModule,
    MasterDataModule,
    ProjectItemsModule,
    PlanningModule,
    RealizedEventsModule,
  ],
})
export class AppModule {}
