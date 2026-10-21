import type { User } from '../types/api';
import { apiRequest } from './api';

export const userService = {
  connectLeetCode: (username: string) =>
    apiRequest<User>('/users/me/leetcode', { method: 'PUT', body: { username } }),
};
