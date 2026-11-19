import { ObjectId } from 'mongodb';
import { DatabaseService } from '../database/database.service.js';
import { UserStore } from './user.store.js';

describe('local user persistence', () => {
  it('activates pending membership with versioned consent in one conditional update', async () => {
    const activated = { membershipStatus: 'active' };
    const findOneAndUpdate = vi.fn().mockResolvedValue(activated);
    const database = {
      db: vi
        .fn()
        .mockResolvedValue({ collection: () => ({ findOneAndUpdate }) }),
    };
    const store = new UserStore(database as unknown as DatabaseService);
    expect(await store.acceptTerms('remote-id')).toBe(activated);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { remoteAgricUserId: 'remote-id', membershipStatus: 'pending' },
      {
        $set: {
          membershipStatus: 'active',
          termsAcceptedAt: expect.any(Date),
          termsVersion: '1.0',
          updatedAt: expect.any(Date),
        },
      },
      { returnDocument: 'after' },
    );
  });

  it('keeps the original consent on retries and never reactivates suspended users', async () => {
    const accepted = {
      membershipStatus: 'active',
      termsVersion: '1.0',
      termsAcceptedAt: new Date(),
    };
    const findOne = vi.fn().mockResolvedValue(accepted);
    const findOneAndUpdate = vi.fn().mockResolvedValue(null);
    const database = {
      db: vi
        .fn()
        .mockResolvedValue({
          collection: () => ({ findOne, findOneAndUpdate }),
        }),
    };
    const store = new UserStore(database as unknown as DatabaseService);
    expect(await store.acceptTerms('remote-id')).toBe(accepted);
    findOne.mockResolvedValue({ ...accepted, membershipStatus: 'suspended' });
    await expect(store.acceptTerms('remote-id')).rejects.toThrow(
      'Membership cannot be activated',
    );
    expect(
      findOneAndUpdate.mock.calls.every(
        ([filter]) => filter.membershipStatus === 'pending',
      ),
    ).toBe(true);
  });

  it('links by remote ID, allowlists identity fields, and preserves local membership and consent', async () => {
    const saved = {
      _id: new ObjectId(),
      membershipStatus: 'suspended',
      termsAcceptedAt: new Date(),
    };
    const findOneAndUpdate = vi.fn().mockResolvedValue(saved);
    const database = {
      db: vi
        .fn()
        .mockResolvedValue({ collection: () => ({ findOneAndUpdate }) }),
    };
    const store = new UserStore(database as unknown as DatabaseService);
    const profile = {
      email: 'member@example.com',
      firstName: 'Remote',
      lastName: 'Farmer',
      farmerID: 'RAU-123',
      password: 'never-store',
      sessionToken: 'never-store',
      membershipStatus: 'active',
      termsAcceptedAt: new Date(),
    };

    expect(await store.syncProfile('remote-id', profile)).toBe(saved);
    const [filter, update, options] = findOneAndUpdate.mock.calls[0]!;
    expect(filter).toEqual({ remoteAgricUserId: 'remote-id' });
    expect(options).toEqual({ upsert: true, returnDocument: 'after' });
    expect(update.$set).toEqual({
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      farmerID: profile.farmerID,
      updatedAt: expect.any(Date),
    });
    expect(update.$setOnInsert).toEqual({
      remoteAgricUserId: 'remote-id',
      membershipStatus: 'pending',
      termsAcceptedAt: null,
      termsVersion: null,
      createdAt: expect.any(Date),
    });
    expect(JSON.stringify(update)).not.toContain('never-store');
  });
});
