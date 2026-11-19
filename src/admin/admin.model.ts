import type { ObjectId } from 'mongodb';

export interface AdminAccount {
  _id: ObjectId;
  email: string;
  name: string;
  passwordHash: string;
  active: boolean;
  sessionVersion: number;
  createdAt: Date;
}

export interface AdminSession {
  _id: string;
  adminId: ObjectId;
  sessionVersion: number;
  expiresAt: Date;
}
