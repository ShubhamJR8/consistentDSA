import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import {
  LeetCodeProviderError,
  clearLeetCodeCache,
  getLeetCodeProviderStatus,
  leetCodeClient,
  parseAcceptedSubmissions,
  parseProfile,
} from './leetcode.client.js';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Alfa response parsing', () => {
  it('reads a profile with an empty or populated About field', () => {
    expect(parseProfile({ username: 'LeetCode', about: '' })).toEqual({
      username: 'LeetCode',
      about: '',
    });
    expect(parseProfile({ username: 'lee', about: 'hi\nthere' })?.about).toBe('hi\nthere');
  });

  it('treats the HTTP-200 "user does not exist" error body as not found', () => {
    expect(
      parseProfile({
        errors: [{ message: 'That user does not exist.' }],
        data: { matchedUser: null, recentSubmissionList: [] },
      })
    ).toBeNull();
  });

  it('rejects an unexpected profile shape instead of guessing', () => {
    expect(() => parseProfile({ nope: true })).toThrow(LeetCodeProviderError);
    expect(() => parseProfile({ username: 'x' })).toThrow(LeetCodeProviderError); // no `about`
  });

  it('converts second-resolution string timestamps to milliseconds and keeps Accepted only', () => {
    const parsed = parseAcceptedSubmissions(
      {
        count: 2,
        submission: [
          {
            title: 'Two Sum',
            titleSlug: 'two-sum',
            timestamp: '1791086655',
            statusDisplay: 'Accepted',
            lang: 'java',
          },
          {
            title: 'Two Sum',
            titleSlug: 'two-sum',
            timestamp: '1791086600',
            statusDisplay: 'Wrong Answer',
          },
        ],
      },
      20
    );
    expect(parsed.submissions).toEqual([
      { title: 'Two Sum', titleSlug: 'two-sum', timestamp: 1791086655000, language: 'java' },
    ]);
  });

  it('fails the whole list on a malformed timestamp or schema', () => {
    expect(() =>
      parseAcceptedSubmissions(
        {
          submission: [
            { title: 'a', titleSlug: 'a', timestamp: 'soon', statusDisplay: 'Accepted' },
          ],
        },
        20
      )
    ).toThrow(LeetCodeProviderError);
    expect(() => parseAcceptedSubmissions({ submission: 'x' }, 20)).toThrow(LeetCodeProviderError);
  });
});

describe('leetCodeClient HTTP behaviour', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    clearLeetCodeCache();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('only ever requests the configured base URL, with the username encoded', async () => {
    fetchMock.mockResolvedValue(json({ username: 'abc_1', about: '' }));
    await leetCodeClient.getProfile('abc_1');
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://alfa-leetcode-api.onrender.com/abc_1');
  });

  it('refuses usernames that could alter the URL, without making a request', async () => {
    for (const bad of ['../etc', 'a/b', 'a?x=1', 'http://evil.test', 'a b', '']) {
      await expect(leetCodeClient.getProfile(bad)).rejects.toBeInstanceOf(LeetCodeProviderError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries a transient 5xx and then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({ username: 'abc', about: 'ok' }));
    await expect(leetCodeClient.getProfile('abc')).resolves.toMatchObject({ about: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-transient 4xx, and never leaks upstream detail in the error type', async () => {
    fetchMock.mockResolvedValue(json({ secret: 'stack trace' }, 404));
    await expect(leetCodeClient.getProfile('abc')).rejects.toBeInstanceOf(LeetCodeProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after the bounded number of attempts on network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(leetCodeClient.getProfile('abc')).rejects.toBeInstanceOf(LeetCodeProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('on 429 stops retrying, honours Retry-After, and fails fast without calling Alfa again', async () => {
    fetchMock.mockResolvedValue(
      new Response('Too many request', { status: 429, headers: { 'retry-after': '120' } })
    );

    const first = await leetCodeClient.getProfile('abc').catch((e) => e);
    expect(first).toBeInstanceOf(LeetCodeProviderError);
    expect(first.retryAfterSeconds).toBeGreaterThan(100);
    expect(fetchMock).toHaveBeenCalledTimes(1); // not retried

    const second = await leetCodeClient.getAcceptedSubmissions('abc').catch((e) => e);
    expect(second).toBeInstanceOf(LeetCodeProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // cooldown: no network call at all
  });

  it('caches successful submission lookups briefly', async () => {
    fetchMock.mockResolvedValue(json({ count: 0, submission: [] }));
    await leetCodeClient.getAcceptedSubmissions('abc');
    await leetCodeClient.getAcceptedSubmissions('ABC');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe('request budget', () => {
    const original = env.LEETCODE_API_HOURLY_BUDGET;
    afterEach(() => {
      env.LEETCODE_API_HOURLY_BUDGET = original;
    });

    it('stops calling Alfa once the hourly budget is spent, and says when to retry', async () => {
      env.LEETCODE_API_HOURLY_BUDGET = 3;
      fetchMock.mockImplementation(async () => json({ count: 0, submission: [] }));

      for (const name of ['aa', 'bb', 'cc']) await leetCodeClient.getAcceptedSubmissions(name);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(getLeetCodeProviderStatus().budget).toMatchObject({ limit: 3, used: 3, remaining: 0 });

      const blocked = await leetCodeClient.getAcceptedSubmissions('dd').catch((e: unknown) => e);
      expect(blocked).toBeInstanceOf(LeetCodeProviderError);
      expect((blocked as LeetCodeProviderError).retryAfterSeconds).toBeGreaterThan(0);
      expect(fetchMock).toHaveBeenCalledTimes(3); // no fourth request was made
    });

    it('cached lookups do not spend budget', async () => {
      env.LEETCODE_API_HOURLY_BUDGET = 2;
      fetchMock.mockImplementation(async () => json({ count: 0, submission: [] }));

      for (let i = 0; i < 5; i += 1) await leetCodeClient.getAcceptedSubmissions('same');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getLeetCodeProviderStatus().budget.used).toBe(1);
    });

    it('retries count against the budget, since each one is a real request', async () => {
      env.LEETCODE_API_HOURLY_BUDGET = 100;
      fetchMock.mockImplementation(async () => json({}, 503));

      await leetCodeClient.getAcceptedSubmissions('retry').catch(() => undefined);

      expect(getLeetCodeProviderStatus().budget.used).toBe(env.LEETCODE_API_MAX_ATTEMPTS);
    });

    it('a budget of 0 means unlimited', async () => {
      env.LEETCODE_API_HOURLY_BUDGET = 0;
      fetchMock.mockImplementation(async () => json({ count: 0, submission: [] }));

      for (let i = 0; i < 30; i += 1) await leetCodeClient.getAcceptedSubmissions(`user${i}`);

      expect(fetchMock).toHaveBeenCalledTimes(30);
      expect(getLeetCodeProviderStatus().budget.remaining).toBe(Number.POSITIVE_INFINITY);
    });
  });

  describe('provider health', () => {
    it('is unknown until a call is made, ok after a success, down after a failure', async () => {
      expect(getLeetCodeProviderStatus().state).toBe('unknown');

      fetchMock.mockResolvedValueOnce(json({ count: 0, submission: [] }));
      await leetCodeClient.getAcceptedSubmissions('health1');
      expect(getLeetCodeProviderStatus()).toMatchObject({ state: 'ok', consecutiveFailures: 0 });

      fetchMock.mockImplementation(async () => json({}, 500));
      await leetCodeClient.getAcceptedSubmissions('health2').catch(() => undefined);
      const down = getLeetCodeProviderStatus();
      expect(down.state).toBe('down');
      expect(down.failingSince).toBeInstanceOf(Date);
      expect(down.consecutiveFailures).toBeGreaterThan(0);
      expect(down.lastSuccessAt).toBeInstanceOf(Date);
    });

    it('recovers to ok as soon as one request succeeds', async () => {
      fetchMock.mockImplementation(async () => json({}, 500));
      await leetCodeClient.getAcceptedSubmissions('rec1').catch(() => undefined);
      expect(getLeetCodeProviderStatus().state).toBe('down');

      fetchMock.mockReset().mockResolvedValue(json({ count: 0, submission: [] }));
      await leetCodeClient.getAcceptedSubmissions('rec2');
      expect(getLeetCodeProviderStatus()).toMatchObject({
        state: 'ok',
        failingSince: null,
        consecutiveFailures: 0,
      });
    });

    it('a 429 counts as the provider being down for users, even though it is reachable', async () => {
      fetchMock.mockResolvedValue(
        new Response('slow down', { status: 429, headers: { 'retry-after': '60' } })
      );
      await leetCodeClient.getAcceptedSubmissions('limited').catch(() => undefined);
      expect(getLeetCodeProviderStatus().state).toBe('down');
    });

    it('does not count a request the local budget refused as a provider failure', async () => {
      const original = env.LEETCODE_API_HOURLY_BUDGET;
      env.LEETCODE_API_HOURLY_BUDGET = 1;
      try {
        fetchMock.mockResolvedValue(json({ count: 0, submission: [] }));
        await leetCodeClient.getAcceptedSubmissions('ok1');
        await leetCodeClient.getAcceptedSubmissions('refused').catch(() => undefined);
        expect(getLeetCodeProviderStatus().state).toBe('ok');
      } finally {
        env.LEETCODE_API_HOURLY_BUDGET = original;
      }
    });
  });
});
