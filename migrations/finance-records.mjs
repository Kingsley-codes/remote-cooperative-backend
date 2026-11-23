import { MongoClient } from 'mongodb';
import { randomBytes } from 'node:crypto';

// Run with: node --env-file=.env migrations/finance-records.mjs
// Idempotent: leaves existing public IDs and provider references intact.
const client = new MongoClient(process.env.MONGO_URI);
await client.connect();
try {
  const db = client.db();
  for (const [name, prefix] of [
    ['contributions', 'CON'],
    ['loans', 'LOA'],
    ['transactions', 'TRX'],
  ]) {
    for await (const record of db
      .collection(name)
      .find({ id: { $exists: false } })) {
      await db.collection(name).updateOne(
        { _id: record._id, id: { $exists: false } },
        {
          $set: {
            id: `${prefix}-${randomBytes(5).toString('hex').toUpperCase()}`,
          },
        },
      );
    }
    await db
      .collection(name)
      .createIndex({ id: 1 }, { unique: true, sparse: true });
  }
  for await (const transaction of db
    .collection('transactions')
    .find({ linkedId: { $exists: true } })) {
    const contribution = ['long_term', 'short_term'].includes(
      transaction.category,
    );
    const loan = ['loan_repayment', 'loan_disbursement'].includes(
      transaction.category,
    );
    let linked;
    if (contribution)
      linked = await db
        .collection('contributions')
        .findOne({ reference: transaction.reference });
    if (loan) {
      const { ObjectId } = await import('mongodb');
      linked = await db
        .collection('loans')
        .findOne({ _id: new ObjectId(transaction.linkedId) });
    }
    if ((contribution || loan) && !linked)
      throw new Error(
        `Missing related record for ${transaction.id}; repair it and rerun.`,
      );
    await db.collection('transactions').updateOne(
      { _id: transaction._id },
      {
        ...(linked
          ? {
              $set: { [contribution ? 'contributionid' : 'loanid']: linked.id },
            }
          : {}),
        $unset: { linkedId: '', direction: '', checkoutUrl: '' },
      },
    );
  }
  await db
    .collection('transactions')
    .updateMany({}, { $unset: { direction: '', checkoutUrl: '' } });
  console.log('Finance public IDs and transaction links migrated.');
} finally {
  await client.close();
}
