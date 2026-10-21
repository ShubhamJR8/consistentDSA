import { z } from 'zod';

export const connectLeetCodeSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, 'LeetCode username is required')
    .max(50, 'LeetCode username is too long')
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'LeetCode usernames only contain letters, numbers, hyphens and underscores'
    ),
});

export type ConnectLeetCodeInput = z.infer<typeof connectLeetCodeSchema>;
