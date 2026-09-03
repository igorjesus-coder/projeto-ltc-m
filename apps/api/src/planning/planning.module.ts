import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { PlanningController } from './planning.controller.js';
import { PlanningService } from './planning.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PlanningController],
  providers: [PlanningService],
})
export class PlanningModule {}
