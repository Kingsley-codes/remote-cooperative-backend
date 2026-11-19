import { ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { User, UserProfile } from './user.model.js';
import { COOPERATIVE_TERMS_VERSION } from './user.model.js';

@Injectable()
export class UserStore {
  constructor(private readonly database: DatabaseService) {}

  async findByRemoteId(remoteAgricUserId: string) {
    return (await this.database.db())
      .collection<User>('users')
      .findOne({ remoteAgricUserId });
  }

  async syncProfile(
    remoteAgricUserId: string,
    profile: UserProfile,
  ): Promise<User> {
    const users = (await this.database.db()).collection<User>('users');
    const now = new Date();
    // Allowlist remote profile fields. Never overwrite local membership/consent.
    const update = {
      $set: {
        email: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        farmerID: profile.farmerID,
        updatedAt: now,
      },
      $setOnInsert: {
        remoteAgricUserId,
        membershipStatus: 'pending' as const,
        termsAcceptedAt: null,
        termsVersion: null,
        createdAt: now,
      },
    };
    return (await users.findOneAndUpdate({ remoteAgricUserId }, update, {
      upsert: true,
      returnDocument: 'after',
    }))!;
  }

  async acceptTerms(remoteAgricUserId: string): Promise<User> {
    const users = (await this.database.db()).collection<User>('users');
    const now = new Date();
    const activated = await users.findOneAndUpdate(
      { remoteAgricUserId, membershipStatus: 'pending' },
      {
        $set: {
          membershipStatus: 'active',
          termsAcceptedAt: now,
          termsVersion: COOPERATIVE_TERMS_VERSION,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' },
    );
    if (activated) return activated;
    const existing = await users.findOne({ remoteAgricUserId });
    // Retries preserve the original consent timestamp; suspension is never lifted.
    if (
      existing?.membershipStatus === 'active' &&
      existing.termsVersion === COOPERATIVE_TERMS_VERSION
    )
      return existing;
    throw new ForbiddenException('Membership cannot be activated');
  }
}
