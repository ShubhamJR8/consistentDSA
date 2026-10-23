import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';
import { RateLimitCounter } from '../models/rateLimitCounter.model.js';
import { describeError, logger } from '../utils/logger.js';
import { isDuplicateKeyError } from '../utils/mongo.js';

/**
 * express-rate-limit store backed by MongoDB, so limits hold across server instances.
 *
 * Each hit is ONE atomic upsert with an aggregation-pipeline update: if the window is still open it
 * adds one, otherwise it starts a new window at 1. There is no read-then-write, so concurrent hits —
 * from one instance or many — are counted exactly.
 */
export class MongoRateLimitStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  private windowMs = 15 * 60 * 1000;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private id(key: string): string {
    return `${this.prefix}:${key}`;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const now = new Date();
    const nextReset = new Date(now.getTime() + this.windowMs);
    const update = [
      {
        $set: {
          hits: {
            $cond: [{ $gt: ['$resetAt', now] }, { $add: [{ $ifNull: ['$hits', 0] }, 1] }, 1],
          },
          resetAt: { $cond: [{ $gt: ['$resetAt', now] }, '$resetAt', nextReset] },
        },
      },
    ];
    try {
      let doc;
      try {
        doc = await RateLimitCounter.findOneAndUpdate({ _id: this.id(key) }, update, {
          upsert: true,
          new: true,
        });
      } catch (error) {
        // Two first-ever hits for a key can race to insert it; the loser just retries as an update.
        if (!isDuplicateKeyError(error)) throw error;
        doc = await RateLimitCounter.findOneAndUpdate({ _id: this.id(key) }, update, { new: true });
      }
      return { totalHits: doc?.hits ?? 1, resetTime: doc?.resetAt ?? nextReset };
    } catch (error) {
      // The limiter is configured to let requests through if its store fails (availability over
      // strictness); make sure someone can see that it happened.
      logger.error('rate_limit_store_failed', { prefix: this.prefix, ...describeError(error) });
      throw error;
    }
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const doc = await RateLimitCounter.findOne({ _id: this.id(key), resetAt: { $gt: new Date() } });
    return doc ? { totalHits: doc.hits, resetTime: doc.resetAt } : undefined;
  }

  async decrement(key: string): Promise<void> {
    await RateLimitCounter.updateOne(
      { _id: this.id(key), hits: { $gt: 0 }, resetAt: { $gt: new Date() } },
      { $inc: { hits: -1 } }
    );
  }

  async resetKey(key: string): Promise<void> {
    await RateLimitCounter.deleteOne({ _id: this.id(key) });
  }
}
