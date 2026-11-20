import { dependencyFailureReason } from './dependency-failure.js';

describe('dependency error redaction', () => {
  it.each([
    [{ code: 18 }, 'authentication_failed'],
    [{ code: 13 }, 'permission_denied'],
    [{ code: 11000 }, 'duplicate_index_data'],
    [{ name: 'MongoServerSelectionError' }, 'database_unreachable'],
    [{ name: 'TimeoutError' }, 'timeout'],
    [{ cause: { code: 'ENOTFOUND' } }, 'ENOTFOUND'],
    [{ cause: { code: 'CERT_HAS_EXPIRED' } }, 'CERT_HAS_EXPIRED'],
  ])('classifies known failures without their messages', (error, reason) => {
    expect(dependencyFailureReason({ ...error, message: 'secret' })).toBe(
      reason,
    );
  });

  it('never returns arbitrary driver fields or traverses cyclic causes', () => {
    const error = {
      name: 'mongodb://user:password@host/db',
      code: 'secret-token',
      message: 'private-user-document',
      cause: {},
    };
    error.cause = error;
    expect(dependencyFailureReason(error)).toBe('unknown');
    expect(dependencyFailureReason({ cause: error })).toBe('unknown');
    expect(dependencyFailureReason(null)).toBe('unknown');
  });
});
