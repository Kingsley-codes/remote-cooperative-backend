import { MongoClient } from 'mongodb';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { hashPassword } from '../dist/admin/password.js';

const uri = process.env.ADMIN_MONGO_URI;
const database = process.env.ADMIN_MONGO_DB || 'remote_cooperative';
if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri)) throw new Error('Configure ADMIN_MONGO_URI in .env first');
if (!/^[a-zA-Z0-9_-]{1,64}$/.test(database)) throw new Error('Invalid ADMIN_MONGO_DB');
let hidden = false;
const output = new Writable({ write(chunk, _encoding, callback) { if (!hidden) process.stdout.write(chunk); callback(); } });
const input = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
let client;
try {
  const email = (await input.question('Admin email: ')).trim().toLowerCase();
  const name = (await input.question('Admin full name: ')).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 100) throw new Error('Enter a valid email and name');
  process.stdout.write('Password (12-128 characters, hidden): ');
  hidden = true;
  const password = await input.question('');
  hidden = false;
  process.stdout.write('\n');
  if (password.length < 12 || password.length > 128) throw new Error('Use a password between 12 and 128 characters');
  process.stdout.write('Confirm password (hidden): ');
  hidden = true;
  const confirmation = await input.question('');
  hidden = false;
  process.stdout.write('\n');
  if (password !== confirmation) throw new Error('Passwords do not match');
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const admins = client.db(database).collection('admins');
  await admins.createIndex({ email: 1 }, { unique: true });
  await admins.insertOne({ email, name, passwordHash: await hashPassword(password), active: true, sessionVersion: 0, createdAt: new Date() });
  console.log('Cooperative admin created. Sign in at /admin/login.');
} catch (error) {
  console.error(error?.code === 11000 ? 'An admin with this email already exists. No changes were made.' : 'Admin creation failed. Check the inputs, database configuration and connection.');
  process.exitCode = 1;
} finally {
  input.close();
  await client?.close();
}
