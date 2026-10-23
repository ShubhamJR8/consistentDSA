import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LeetCodeProviderError,
  clearLeetCodeCache,
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
});
