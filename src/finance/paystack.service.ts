import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

@Injectable()
export class PaystackService {
  constructor(private readonly config: ConfigService) {}

  private key(): string {
    const key = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!key)
      throw new ServiceUnavailableException('Payments are not configured yet.');
    return key;
  }

  async request(path: string, body?: unknown) {
    const key = this.key();
    try {
      const response = await fetch(`https://api.paystack.co${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      const result = await response.json();
      if (!response.ok || !result.status || !result.data)
        throw new Error('Provider rejected request');
      return result.data;
    } catch {
      throw new BadGatewayException(
        'Payment provider unavailable. Check this payment before trying again.',
      );
    }
  }

  verifySignature(raw: Buffer | undefined, signature: string | undefined) {
    const expected = createHmac('sha512', this.key())
      .update(raw ?? Buffer.alloc(0))
      .digest('hex');
    if (
      !raw ||
      !signature ||
      !/^[a-f0-9]{128}$/i.test(signature) ||
      !timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(signature, 'hex'),
      )
    ) {
      throw new UnauthorizedException('Invalid payment signature');
    }
  }
}
