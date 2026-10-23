import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Schema } from 'mongoose';
import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';

import { ensureIndexes } from '../config/db.js';
import { env } from '../config/env.js';
import { MongoRateLimitStore } from '../middleware/mongoRateLimitStore.js';
import { JobLease } from '../models/jobLease.model.js';
import { RateLimitCounter } from '../models/rateLimitCounter.model.js';
import { acquireLease, releaseLease, withLease } from '../utils/jobLease.js';

const TEST_DB = 'commit_dsa_test_multi_instance';

// "Two server instances" here are two independent holders / two independent store objects talking to
// the same database, which is exactly what separates them in production.
describe('state shared across server instances', () => {
  beforeAll(async () => {
    const match = env.MONGODB_URI.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/[^/?]*(\?.*)?$/);
    await mongoose.connect(
      match ? `${match[1]}/${TEST_DB}${match[2] ?? ''}` : `${env.MONGODB_URI}/${TEST_DB}`
    );
    expect(mongoose.connection.name).toBe(TEST_DB);
    await mongoose.connection.dropDatabase();
    await Promise.all([JobLease.init(), RateLimitCounter.init()]);
  });
  afterAll(async () => {
    if (mongoose.connection.name === TEST_DB) await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });
  beforeEach(async () => {
    await Promise.all([JobLease.deleteMany({}), RateLimitCounter.deleteMany({})]);
  });

  describe('job lease', () => {
    const MIN = 60_000;

    it('lets exactly one of several simultaneous instances take it', async () => {
      const results = await Promise.all(
        ['a', 'b', 'c', 'd', 'e', 'f'].map((holder) => acquireLease('sweep', 5 * MIN, holder))
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await JobLease.countDocuments({ _id: 'sweep' })).toBe(1);
    });

    it('is refused while another instance holds a live lease, and allowed once it expires', async () => {
      const t0 = new Date('2031-01-01T00:00:00Z');
      expect(await acquireLease('sweep', 5 * MIN, 'a', t0)).toBe(true);

      expect(await acquireLease('sweep', 5 * MIN, 'b', new Date(t0.getTime() + 4 * MIN))).toBe(
        false
      );
      expect(await acquireLease('sweep', 5 * MIN, 'b', new Date(t0.getTime() + 6 * MIN))).toBe(
        true
      );
      expect((await JobLease.findById('sweep'))?.holder).toBe('b');
    });

    it('lets the holder renew its own lease', async () => {
      const t0 = new Date('2031-01-01T00:00:00Z');
      await acquireLease('sweep', 5 * MIN, 'a', t0);
      expect(await acquireLease('sweep', 5 * MIN, 'a', new Date(t0.getTime() + 2 * MIN))).toBe(
        true
      );
      expect(await acquireLease('sweep', 5 * MIN, 'b', new Date(t0.getTime() + 6 * MIN))).toBe(
        false
      );
    });

    it('can be released, but only by its holder', async () => {
      await acquireLease('sweep', 5 * MIN, 'a');
      await releaseLease('sweep', 'b'); // not the holder: no effect
      expect(await acquireLease('sweep', 5 * MIN, 'b')).toBe(false);
      await releaseLease('sweep', 'a');
      expect(await acquireLease('sweep', 5 * MIN, 'b')).toBe(true);
    });

    it('keeps separate sweeps independent', async () => {
      expect(await acquireLease('one', 5 * MIN, 'a')).toBe(true);
      expect(await acquireLease('two', 5 * MIN, 'b')).toBe(true);
    });

    it('withLease runs the job once across instances and skips when the lease is taken', async () => {
      const job = vi.fn().mockResolvedValue(undefined);
      await acquireLease('sweep', 5 * MIN, 'another-instance');

      expect(await withLease('sweep', 5 * MIN, job)).toBe(false);
      expect(job).not.toHaveBeenCalled();

      await releaseLease('sweep', 'another-instance');
      expect(await withLease('sweep', 5 * MIN, job)).toBe(true);
      expect(job).toHaveBeenCalledTimes(1);
      // Released afterwards, so the next tick (on any instance) can run.
      expect(await acquireLease('sweep', 5 * MIN, 'next-instance')).toBe(true);
    });

    it('withLease releases the lease and never throws when the job fails', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await expect(
        withLease('sweep', 5 * MIN, async () => {
          throw new Error('boom');
        })
      ).resolves.toBe(true);
      spy.mockRestore();
      expect(await acquireLease('sweep', 5 * MIN, 'next-instance')).toBe(true);
    });
  });

  describe('rate-limit store', () => {
    const store = (prefix = 'test', windowMs = 60_000) => {
      const s = new MongoRateLimitStore(prefix);
      s.init({ windowMs } as never);
      return s;
    };

    it('counts every concurrent hit exactly, with no lost updates', async () => {
      const s = store();
      await Promise.all(Array.from({ length: 60 }, () => s.increment('user-1')));
      expect((await s.get('user-1'))?.totalHits).toBe(60);
    });

    it('two instances share one count', async () => {
      const instanceA = store();
      const instanceB = store();
      await Promise.all([
        ...Array.from({ length: 7 }, () => instanceA.increment('user-1')),
        ...Array.from({ length: 5 }, () => instanceB.increment('user-1')),
      ]);
      expect((await instanceA.get('user-1'))?.totalHits).toBe(12);
      expect((await instanceB.get('user-1'))?.totalHits).toBe(12);
    });

    it('keeps clients and limiters separate', async () => {
      await store('auth').increment('same');
      await store('auth').increment('same');
      await store('payment').increment('same');
      await store('auth').increment('other');
      expect((await store('auth').get('same'))?.totalHits).toBe(2);
      expect((await store('payment').get('same'))?.totalHits).toBe(1);
      expect((await store('auth').get('other'))?.totalHits).toBe(1);
    });

    it('starts a fresh window once the old one has expired, even before Mongo purges it', async () => {
      const s = store('win', 60_000);
      await s.increment('k');
      await s.increment('k');
      await RateLimitCounter.updateOne(
        { _id: 'win:k' },
        { $set: { resetAt: new Date(Date.now() - 1) } }
      );

      const fresh = await s.increment('k');

      expect(fresh.totalHits).toBe(1);
      expect(fresh.resetTime!.getTime()).toBeGreaterThan(Date.now());
      expect(await s.get('k')).toMatchObject({ totalHits: 1 });
    });

    it('does not extend the window as hits accumulate', async () => {
      const s = store();
      const first = await s.increment('k');
      await new Promise((resolve) => setTimeout(resolve, 15));
      const second = await s.increment('k');
      expect(second.resetTime!.getTime()).toBe(first.resetTime!.getTime());
    });

    it('decrement and resetKey work, and never go below zero', async () => {
      const s = store();
      await s.increment('k');
      await s.increment('k');
      await s.decrement('k');
      expect((await s.get('k'))?.totalHits).toBe(1);
      await s.decrement('k');
      await s.decrement('k');
      expect((await s.get('k'))?.totalHits).toBe(0);
      await s.increment('k');
      await s.resetKey('k');
      expect(await s.get('k')).toBeUndefined();
    });

    it('enforces a limit across two separate app instances', async () => {
      const build = () => {
        const app = express();
        app.use(
          rateLimit({
            windowMs: 60_000,
            limit: 5,
            store: new MongoRateLimitStore('shared'),
            passOnStoreError: true,
            keyGenerator: () => 'one-client',
          })
        );
        app.get('/ping', (_req, res) => void res.json({ ok: true }));
        return app;
      };
      const [a, b] = [build(), build()];

      const statuses: number[] = [];
      for (let i = 0; i < 8; i += 1) {
        statuses.push((await request(i % 2 === 0 ? a : b).get('/ping')).status);
      }

      // 5 allowed in total across both instances, then blocked on both.
      expect(statuses.filter((s) => s === 200)).toHaveLength(5);
      expect(statuses.slice(5)).toEqual([429, 429, 429]);
    });

    it('fails open, and says so, when the store is unreachable', async () => {
      const app = express();
      const broken = new MongoRateLimitStore('broken');
      vi.spyOn(RateLimitCounter, 'findOneAndUpdate').mockRejectedValue(new Error('db down'));
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      app.use(
        rateLimit({
          windowMs: 60_000,
          limit: 1,
          store: broken,
          passOnStoreError: true,
          validate: false,
        })
      );
      app.get('/ping', (_req, res) => void res.json({ ok: true }));

      const res = await request(app).get('/ping');
      const second = await request(app).get('/ping');
      // Read the recorded calls before restoring: restoring a spy also clears them.
      const sawLog = logged.mock.calls.some((c) =>
        JSON.stringify(c).includes('rate_limit_store_failed')
      );
      vi.restoreAllMocks();

      expect(res.status).toBe(200);
      expect(second.status).toBe(200);
      expect(sawLog).toBe(true);
    });
  });

  describe('startup index verification', () => {
    // A unique index cannot be built over rows that already break it, and mongoose swallows that
    // failure. Plant exactly that situation: duplicate rows, then a model declaring the index.
    const plantConflict = async () => {
      await mongoose.connection.collection('probethings').insertMany([
        { k: 'a', t: 'X' },
        { k: 'a', t: 'X' },
      ]);
      const schema = new Schema({ k: String, t: String });
      schema.index(
        { k: 1 },
        { unique: true, name: 'one_per_k', partialFilterExpression: { t: 'X' } }
      );
      mongoose.deleteModel(/^ProbeThing$/);
      mongoose.model('ProbeThing', schema, 'probethings');
    };
    const cleanup = async () => {
      mongoose.deleteModel(/^ProbeThing$/);
      await mongoose.connection
        .collection('probethings')
        .drop()
        .catch(() => undefined);
    };

    it('reports nothing when every index builds', async () => {
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(await ensureIndexes(false)).toEqual([]);
      expect(quiet).not.toHaveBeenCalled();
      quiet.mockRestore();
    });

    it('names the model whose unique index could not be built, and raises an alert', async () => {
      await plantConflict();
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const failures = await ensureIndexes(false);
      const alerted = quiet.mock.calls.some((c) =>
        JSON.stringify(c).includes('index_build_failed')
      );
      quiet.mockRestore();
      await cleanup();

      expect(failures.map((f) => f.model)).toEqual(['ProbeThing']);
      expect(failures[0].reason).toMatch(/index build failed|duplicate/i);
      expect(alerted).toBe(true);
    });

    it('refuses to start in production when a guard index is missing', async () => {
      await plantConflict();
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(ensureIndexes(true)).rejects.toThrow(/Index build failed for: ProbeThing/);

      quiet.mockRestore();
      await cleanup();
    });
  });
});
