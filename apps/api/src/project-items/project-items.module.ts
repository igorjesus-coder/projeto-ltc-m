import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { ProjectItemsController } from './project-items.controller.js';
import { ProjectItemsService } from './project-items.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ProjectItemsController],
  providers: [ProjectItemsService],
})
export class ProjectItemsModule {}
