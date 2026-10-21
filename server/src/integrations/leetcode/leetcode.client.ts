import { env } from '../../config/env.js';

// All LeetCode-specific wire format lives in this file. Nothing outside it should know the shape
// of LeetCode's GraphQL responses — if LeetCode changes its endpoint, only this file changes.

export interface LeetCodeSubmission {
  id?: string;
  title: string;
  titleSlug: string;
  statusDisplay: string;
  /** Milliseconds since epoch. */
  timestamp: number;
  language?: string;
}

export interface LeetCodeClient {
  /**
   * Recent Accepted submissions for a public username, newest first. Resolves to `null` if the
   * username doesn't exist on LeetCode at all (as opposed to existing with zero submissions,
   * which is `[]`) — callers use that distinction to give a clear "check the username" message.
   */
  getRecentSubmissions(username: string): Promise<LeetCodeSubmission[] | null>;
}

const GRAPHQL_URL = 'https://leetcode.com/graphql';

// recentAcSubmissionList only ever contains Accepted runs (that's what "Ac" means here), so we
// don't need the general recentSubmissionList endpoint — which also normally requires an
// authenticated session to read for private profiles. Bundling matchedUser in the same request
// lets us tell "no submissions yet" apart from "this username doesn't exist" in one round trip.
const QUERY = `
  query commitDsaRecentSubmissions($username: String!, $limit: Int!) {
    matchedUser(username: $username) {
      username
    }
    recentAcSubmissionList(username: $username, limit: $limit) {
      id
      title
      titleSlug
      timestamp
    }
  }
`;

interface GraphQLResponse {
  data?: {
    matchedUser: { username: string } | null;
    recentAcSubmissionList: { id: string; title: string; titleSlug: string; timestamp: string }[] | null;
  };
  errors?: unknown[];
}

interface CacheEntry {
  value: LeetCodeSubmission[] | null;
  expiresAt: number;
}

// A small in-memory cache is enough to keep the manual "Check Submission" button and the
// background sweep from hammering LeetCode when both hit the same user in quick succession.
const cache = new Map<string, CacheEntry>();

const fetchRecentSubmissions = async (username: string): Promise<LeetCodeSubmission[] | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  let res: Response;
  try {
    res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: 'https://leetcode.com' },
      body: JSON.stringify({ query: QUERY, variables: { username, limit: 20 } }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error('LeetCode is unreachable', { cause: error });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) throw new Error(`LeetCode responded with ${res.status}`);

  const payload = (await res.json()) as GraphQLResponse;
  if ((payload.errors && payload.errors.length > 0) || !payload.data) {
    throw new Error('LeetCode GraphQL request failed');
  }
  if (!payload.data.matchedUser) return null;

  return (payload.data.recentAcSubmissionList ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    titleSlug: item.titleSlug,
    statusDisplay: 'Accepted',
    timestamp: Number(item.timestamp) * 1000,
  }));
};

export const leetCodeClient: LeetCodeClient = {
  async getRecentSubmissions(username) {
    const key = username.toLowerCase();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const value = await fetchRecentSubmissions(username);
    cache.set(key, { value, expiresAt: Date.now() + env.LEETCODE_CACHE_TTL_SECONDS * 1000 });
    return value;
  },
};
