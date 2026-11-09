import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class EmailDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class LoginDto extends EmailDto {
  @IsString()
  @Length(1, 72)
  password!: string;
}

export class SignupDto extends LoginDto {
  @IsString()
  @Length(1, 80)
  @Matches(/\S/)
  firstName!: string;

  @IsString()
  @Length(1, 80)
  @Matches(/\S/)
  lastName!: string;

  @Matches(/^\+[1-9]\d{7,14}$/)
  phone!: string;

  @IsString()
  @Length(8, 72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/)
  declare password: string;

  @IsString()
  @Length(8, 72)
  confirmPassword!: string;

  @Equals(true)
  acceptTerms!: boolean;
}

export class VerifyDto extends EmailDto {
  @Matches(/^\d{6}$/)
  otp!: string;
}

export class ResetDto extends VerifyDto {
  @IsString()
  @Length(8, 72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/)
  password!: string;

  @IsString()
  @Length(8, 72)
  confirmPassword!: string;
}

export class GoogleStartDto {
  @Matches(/^[\w-]{43,128}$/)
  state!: string;

  @Matches(/^[\w-]{43,128}$/)
  nonce!: string;

  @Matches(/^[\w-]{43}$/)
  codeChallenge!: string;
}

export class GoogleDto {
  @IsString()
  @Length(1, 4096)
  code!: string;

  @Matches(/^[\w-]{43,128}$/)
  codeVerifier!: string;

  @Matches(/^[\w-]{43,128}$/)
  nonce!: string;
}
