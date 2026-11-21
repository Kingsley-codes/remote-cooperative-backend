import { Module } from '@nestjs/common';
import {
  FinanceController,
  AdminFinanceController,
} from './finance.controller.js';
import { FinanceService } from './finance.service.js';
import { PaystackService } from './paystack.service.js';
import { PayoutService } from './payout.service.js';

@Module({
  controllers: [FinanceController, AdminFinanceController],
  providers: [FinanceService, PaystackService, PayoutService],
})
export class FinanceModule {}
