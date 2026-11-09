import { hashPassword, verifyPassword } from './password.js';

describe('Admin password storage', () => {
  it('salts passwords, verifies correct passwords and rejects incorrect or malformed hashes', async () => {
    const first = await hashPassword('LongAdminPassword!');
    const second = await hashPassword('LongAdminPassword!');
    expect(first).not.toBe(second);
    expect(first).not.toContain('LongAdminPassword!');
    expect(await verifyPassword('LongAdminPassword!', first)).toBe(true);
    expect(await verifyPassword('wrong', first)).toBe(false);
    expect(await verifyPassword('wrong', 'malformed')).toBe(false);
    expect(await verifyPassword('wrong')).toBe(false);
  });
});
