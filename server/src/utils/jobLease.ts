import { randomUUID } from 'crypto';
import { JobLease } from '../models/jobLease.model.js';
import { isDuplicateKeyError } from './mongo.js';
import { describeError, logger } from './logger.js';

// Every sweep is idempotent, so running one on several instances is *safe* — but wasteful, and for
// the LeetCode sweep it multiplies traffic against a rate-limited provider by the instance count.
// A lease makes one instance at a time run each sweep without any extra infrastructure.
//
// It expires on its own (TTL), so an instance that dies mid-sweep delays the next run by at most the
// TTL. If a sweep ever outlasts its TTL a second instance may start alongside it; that is the same
// safe-but-wasteful case as having no lease, never a correctness problem.

/** Identifies this process. A fresh id per start means a restarted instance does not inherit a lease
 *  it can no longer be running. */
export const INSTANCE_ID = randomUUID();

/** True if `holder` now owns the lease: it was free, expired, or already ours (a renewal). */
export const acquireLease = async (
  name: string,
  ttlMs: number,
  holder: string = INSTANCE_ID,
  now: Date = new Date()
): Promise<boolean> => {
  try {
    const lease = await JobLease.findOneAndUpdate(
      { _id: name, $or: [{ expiresAt: { $lte: now } }, { holder }] },
      { $set: { holder, expiresAt: new Date(now.getTime() + ttlMs) } },
      { upsert: true, new: true }
    );
    return lease?.holder === holder;
  } catch (error) {
    // Someone else holds a live lease: the filter missed, so the upsert tried to insert the same _id.
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
};

export const releaseLease = async (name: string, holder: string = INSTANCE_ID): Promise<void> => {
  await JobLease.updateOne({ _id: name, holder }, { $set: { expiresAt: new Date(0) } });
};

/** Runs `fn` only if this instance wins the lease, releasing it afterwards so the next tick — on any
 *  instance — can pick it up. Never throws: a lease that cannot be taken just means "skip this tick". */
export const withLease = async (
  name: string,
  ttlMs: number,
  fn: () => Promise<unknown>
): Promise<boolean> => {
  try {
    if (!(await acquireLease(name, ttlMs))) return false;
  } catch (error) {
    logger.error('job_lease_failed', { job: name, ...describeError(error) });
    return false;
  }
  try {
    await fn();
  } catch (error) {
    logger.error('job_failed', { job: name, ...describeError(error) });
  } finally {
    await releaseLease(name).catch(() => undefined);
  }
  return true;
};
