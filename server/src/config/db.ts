import mongoose from 'mongoose';
import { env } from './env.js';
import { CommitmentTransaction } from '../models/commitmentTransaction.model.js';

export const connectDB = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(env.MONGODB_URI);
    console.log(`[Database] MongoDB Connected: ${conn.connection.host} (${conn.connection.name})`);
    // Replaced by one_refund_per_payment; left in place it would reject a second REFUND row on the
    // same commitment (e.g. a duplicate payment). Absent on fresh databases, so failure is expected.
    await CommitmentTransaction.collection.dropIndex('one_refund_per_commitment').catch(() => undefined);
  } catch (error) {
    console.error('[Database] MongoDB connection error:', error);
    process.exit(1);
  }
};
