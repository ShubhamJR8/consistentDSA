import type { ZodError } from 'zod';
import type { ApiFieldIssue } from '../types/api';

export type FieldErrors = Record<string, string>;

export const fromZodError = (error: ZodError): FieldErrors => {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path.join('.');
    if (!errors[field]) errors[field] = issue.message;
  }
  return errors;
};

export const fromApiIssues = (issues: ApiFieldIssue[]): FieldErrors => {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    if (!errors[issue.field]) errors[issue.field] = issue.message;
  }
  return errors;
};
