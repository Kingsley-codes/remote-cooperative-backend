import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'security:is-public';

// Use only for deliberately anonymous endpoints. Webhooks still need signatures.
export const Public = () => SetMetadata(IS_PUBLIC, true);
