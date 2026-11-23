import { randomBytes } from 'node:crypto';

export function recordId(prefix: 'CON' | 'LOA' | 'TRX') {
  return `${prefix}-${randomBytes(5).toString('hex').toUpperCase()}`;
}
