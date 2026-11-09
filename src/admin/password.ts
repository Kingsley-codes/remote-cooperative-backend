import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 32768, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  encoded?: string,
): Promise<boolean> {
  const parts = encoded?.split('$');
  const valid =
    parts?.length === 3 &&
    parts[0] === 'scrypt' &&
    /^[a-f0-9]{32}$/.test(parts[1]!) &&
    /^[a-f0-9]{128}$/.test(parts[2]!);
  // Missing accounts still perform the same expensive password derivation.
  const salt = valid ? Buffer.from(parts[1]!, 'hex') : Buffer.alloc(16);
  const expected = valid ? Buffer.from(parts[2]!, 'hex') : Buffer.alloc(64);
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected) && Boolean(valid);
}
