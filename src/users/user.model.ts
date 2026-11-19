import type { ObjectId } from 'mongodb';

export const COOPERATIVE_TERMS_VERSION = '1.0';

export interface UserProfile {
  email: string;
  firstName: string;
  lastName: string;
  farmerID: string;
}

// Cooperative data only. Passwords and authentication tokens belong to Remote Agric.
export interface User extends UserProfile {
  _id: ObjectId;
  remoteAgricUserId: string;
  membershipStatus: 'pending' | 'active' | 'suspended';
  termsAcceptedAt: Date | null;
  termsVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}
