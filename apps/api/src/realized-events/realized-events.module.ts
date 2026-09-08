import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { RealizedEventsController } from './realized-events.controller.js';
import { RealizedEventsService } from './realized-events.service.js';

@Module({
  imports: [AuthModule],
  controllers: [RealizedEventsController],
  providers: [RealizedEventsService],
})
export class RealizedEventsModule {}
