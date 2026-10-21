import { z } from 'zod';
import { SUPPORTED_LANGUAGES } from '../config/languages.js';

const languageIds = SUPPORTED_LANGUAGES.map((l) => l.id) as [string, ...string[]];

// Shared by both "Run" (samples only, nothing persisted) and "Submit" (all tests, persisted).
export const runSubmissionSchema = z.object({
  language: z.enum(languageIds, { errorMap: () => ({ message: 'Unsupported language' }) }),
  code: z.string().min(1, 'Code is required').max(20_000, 'Code is too long'),
});

export type RunSubmissionInput = z.infer<typeof runSubmissionSchema>;
