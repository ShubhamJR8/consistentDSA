import type { LeetCodeChallenge } from '../types/leetcode';
import type { User } from '../types/api';
import { apiRequest } from './api';

export const leetcodeService = {
  createChallenge: (username: string) =>
    apiRequest<LeetCodeChallenge>('/integrations/leetcode/challenge', {
      method: 'POST',
      body: { username },
    }),
  verify: (username: string) =>
    apiRequest<User>('/integrations/leetcode/verify', { method: 'POST', body: { username } }),
  disconnect: () => apiRequest<User>('/integrations/leetcode', { method: 'DELETE' }),
};
