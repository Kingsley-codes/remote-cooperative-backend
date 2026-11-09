import { SetMetadata } from '@nestjs/common';
export const ADMIN_ONLY = 'adminOnly';
export const AdminOnly = () => SetMetadata(ADMIN_ONLY, true);
