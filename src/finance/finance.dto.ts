import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class ContributionDto {
  @IsIn(['long_term', 'short_term']) type!: 'long_term' | 'short_term';
  @IsInt() @Min(10000) @Max(1000000000) amount!: number;
}
export class RepaymentDto {
  @IsInt() @Min(100) @Max(1000000000) amount!: number;
}
export class LoanDto extends RepaymentDto {
  @IsInt() @Min(1) @Max(60) months!: number;
  @IsString() @Length(10, 1000) purpose!: string;
  @IsBoolean() consent!: boolean;
  @IsString() @Length(1, 100) termsVersion!: string;
}
export class DecisionDto {
  @IsIn(['approve', 'reject']) decision!: 'approve' | 'reject';
  @IsString() @Length(5, 1000) reason!: string;
}
export class EligibilityDto {
  @Matches(/^[a-f0-9]{24}$/) memberId!: string;
  @IsInt() @Min(1) @Max(1000000000000) investmentValue!: number;
  @IsInt() @Min(1) @Max(1000000000) maximum!: number;
  @IsString() @Length(10, 500) source!: string;
}

export class BankAccountDto {
  @Matches(/^\d{10}$/) accountNumber!: string;
  @Matches(/^\d{3,10}$/) bankCode!: string;
}
