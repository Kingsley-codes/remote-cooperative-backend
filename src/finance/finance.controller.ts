import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminOnly } from '../admin/admin.decorator.js';
import { Public } from '../common/security/public.decorator.js';
import { FinanceService, paymentKey } from './finance.service.js';
import {
  BankAccountDto,
  ContributionDto,
  DecisionDto,
  EligibilityDto,
  LoanDto,
  RepaymentDto,
} from './finance.dto.js';
import { PayoutService } from './payout.service.js';
import type { MemberIdentity } from './finance.model.js';

type MemberRequest = Request & { user: MemberIdentity };

@Controller('finance')
export class FinanceController {
  constructor(
    private readonly service: FinanceService,
    private readonly payouts: PayoutService,
  ) {}
  @Get('banks') banks() {
    return this.payouts.banks();
  }
  @Get('destination') destination(@Req() req: MemberRequest) {
    return this.payouts.destination(req.user.localUserId);
  }
  @Post('destination') saveDestination(
    @Req() req: MemberRequest,
    @Body() dto: BankAccountDto,
  ) {
    return this.payouts.saveDestination(req.user, dto);
  }
  @Post('withdrawals') withdraw(
    @Req() req: MemberRequest,
    @Body() dto: RepaymentDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.payouts.withdraw(req.user, dto.amount, paymentKey(key));
  }
  @Post('payouts/:reference/verify') verifyPayout(
    @Req() req: MemberRequest,
    @Param('reference') reference: string,
  ) {
    return this.payouts.verify(reference, req.user.localUserId);
  }
  @Get('summary') summary(@Req() req: MemberRequest) {
    return this.service.summary(req.user.localUserId);
  }
  @Get('contributions') contributions(
    @Req() req: MemberRequest,
    @Query() query: Record<string, string>,
  ) {
    return this.service.list('contributions', query, req.user.localUserId);
  }
  @Get('transactions') transactions(
    @Req() req: MemberRequest,
    @Query() query: Record<string, string>,
  ) {
    return this.service.list('transactions', query, req.user.localUserId);
  }
  @Get('loans') loans(
    @Req() req: MemberRequest,
    @Query() query: Record<string, string>,
  ) {
    return this.service.list('loans', query, req.user.localUserId);
  }
  @Get('eligibility') eligibility(@Req() req: MemberRequest) {
    return this.service.eligibility(req.user.localUserId);
  }
  @Post('contributions') contribute(
    @Req() req: MemberRequest,
    @Body() dto: ContributionDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.service.contribute(req.user, dto, paymentKey(key));
  }
  @Post('loans') apply(@Req() req: MemberRequest, @Body() dto: LoanDto) {
    return this.service.apply(req.user, dto);
  }
  @Post('loans/:id/repay') repay(
    @Req() req: MemberRequest,
    @Param('id') id: string,
    @Body() dto: RepaymentDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.service.repay(req.user, id, dto.amount, paymentKey(key));
  }
  @Post('payments/:reference/verify') verify(
    @Req() req: MemberRequest,
    @Param('reference') reference: string,
  ) {
    return this.service.verify(reference, req.user.localUserId);
  }
  @Public()
  @Post('paystack/webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature?: string,
  ) {
    await this.payouts.webhook(req.rawBody, signature, req.body);
    return this.service.webhook(req.rawBody, signature, req.body);
  }
}

@AdminOnly()
@Controller('admin/finance')
export class AdminFinanceController {
  constructor(
    private readonly service: FinanceService,
    private readonly payouts: PayoutService,
  ) {}
  @Post('loans/:id/disburse') disburse(
    @Req() req: Request & { admin: { id: string } },
    @Param('id') id: string,
  ) {
    return this.payouts.disburse(id, req.admin.id);
  }
  @Post('payouts/:reference/verify') verifyPayout(
    @Param('reference') reference: string,
  ) {
    return this.payouts.verify(reference);
  }
  @Post('payouts/:reference/retry') retryPayout(
    @Req() req: Request & { admin: { id: string } },
    @Param('reference') reference: string,
    @Body() dto: DecisionDto,
  ) {
    return this.payouts.retry(reference, req.admin.id, dto.reason);
  }
  @Get('summary') summary() {
    return this.service.summary();
  }
  @Get('contributions') contributions(@Query() query: Record<string, string>) {
    return this.service.list('contributions', query);
  }
  @Get('transactions') transactions(@Query() query: Record<string, string>) {
    return this.service.list('transactions', query);
  }
  @Get('loans') loans(@Query() query: Record<string, string>) {
    return this.service.list('loans', query);
  }
  @Get('eligibility') eligibility(@Query('memberId') id: string) {
    return this.service.eligibility(id ?? '');
  }
  @Post('eligibility') setEligibility(
    @Req() req: Request & { admin: { id: string } },
    @Body() dto: EligibilityDto,
  ) {
    return this.service.setEligibility(dto, req.admin.id);
  }
  @Post('loans/:id/decision') decide(
    @Req() req: Request & { admin: { id: string } },
    @Param('id') id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.service.decide(id, dto, req.admin.id);
  }
  @Post('payments/:reference/verify') verify(
    @Param('reference') reference: string,
  ) {
    return this.service.verify(reference);
  }
}
