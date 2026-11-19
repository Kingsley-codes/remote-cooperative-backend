import type { ObjectId } from 'mongodb';

export interface AdminAccount {
  _id: ObjectId;
  email: string;
  name: string;
  passwordHash: string;
  active: boolean;
  createdAt: Date;
}
