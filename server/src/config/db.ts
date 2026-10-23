import mongoose from 'mongoose';
import { env } from './env.js';
import { CommitmentTransaction } from '../models/commitmentTransaction.model.js';
import { logger } from '../utils/logger.js';

export const connectDB = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(env.MONGODB_URI);
    console.log(`[Database] MongoDB Connected: ${conn.connection.host} (${conn.connection.name})`);
    // Replaced by one_refund_per_payment; left in place it would reject a second REFUND row on the
    // same commitment (e.g. a duplicate payment). Absent on fresh databases, so failure is expected.
    await CommitmentTransaction.collection
      .dropIndex('one_refund_per_commitment')
      .catch(() => undefined);
  } catch (error) {
    console.error('[Database] MongoDB connection error:', error);
    process.exit(1);
  }
};

export interface IndexFailure {
  model: string;
  reason: string;
}

/**
 * Waits for every model's indexes to exist and reports the ones that could not be built.
 *
 * Mongoose builds indexes in the background and swallows a failure: there is no unhandled rejection,
 * the index just never appears. Several of ours are the last line of defence for money (one
 * successful deposit and one pending order per commitment, one forfeiture per day, one refund per
 * payment), and a unique index cannot be built over rows that already break it, so deploying onto
 * such data would silently run without the guard. In production that is treated as a failed deploy.
 */
export const ensureIndexes = async (
  strict: boolean = env.NODE_ENV === 'production'
): Promise<IndexFailure[]> => {
  const failures: IndexFailure[] = [];
  for (const name of mongoose.modelNames()) {
    try {
      await mongoose.model(name).init();
    } catch (error) {
      failures.push({
        model: name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (failures.length > 0) {
    logger.alert('index_build_failed', {
      failures,
      impact:
        'Unique indexes that protect payments, forfeitures and refunds are missing. Clean up the conflicting documents, then restart.',
    });
    if (strict)
      throw new Error(`Index build failed for: ${failures.map((f) => f.model).join(', ')}`);
  }
  return failures;
};
