import { Module } from '@nestjs/common';

import { QualityController } from './quality.controller.js';
import { QualityService } from './quality.service.js';

@Module({ controllers: [QualityController], providers: [QualityService] })
export class QualityModule {}
