// Only fixed labels may enter logs. Driver messages can contain credentials,
// connection strings, tokens, or user documents.
export function dependencyFailureReason(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown';
  const { code, name, cause } = error as {
    code?: unknown;
    name?: unknown;
    cause?: unknown;
  };
  if (code === 18) return 'authentication_failed';
  if (code === 13) return 'permission_denied';
  if (code === 11000) return 'duplicate_index_data';
  if (
    [
      'ENOTFOUND',
      'EAI_AGAIN',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ECONNRESET',
      'ENETUNREACH',
      'UND_ERR_CONNECT_TIMEOUT',
      'CERT_HAS_EXPIRED',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'ERR_TLS_CERT_ALTNAME_INVALID',
    ].includes(code as string)
  )
    return code as string;
  if (name === 'MongoServerSelectionError') return 'database_unreachable';
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  // Fetch wraps transport failures in a TypeError with a system-error cause.
  if (cause && cause !== error) {
    const nested = cause as { code?: unknown };
    // Do not recursively traverse arbitrary exception objects.
    return dependencyFailureReason({ code: nested.code });
  }
  return 'unknown';
}
