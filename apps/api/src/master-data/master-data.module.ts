import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { MasterDataController } from './master-data.controller.js';
import { MasterDataService } from './master-data.service.js';

@Module({
  imports: [AuthModule],
  controllers: [MasterDataController],
  providers: [MasterDataService],
})
export class MasterDataModule {}
