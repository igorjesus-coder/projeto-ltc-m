import { Module } from '@nestjs/common';

import { QualityController } from './quality.controller.js';
import { QualityService, SystemQualityClock } from './quality.service.js';

@Module({ controllers: [QualityController], providers: [QualityService, SystemQualityClock] })
export class QualityModule {}
