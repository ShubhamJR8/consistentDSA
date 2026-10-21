import { z } from 'zod';
import { isValidTimezone } from '../utils/localDate.js';

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Please enter a valid email address').toLowerCase().trim(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password cannot exceed 100 characters'),
  timezone: z
    .string()
    .refine(isValidTimezone, 'Please provide a valid IANA timezone')
    .optional()
    .default('Asia/Kolkata'),
});

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address').toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address').toLowerCase().trim(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password cannot exceed 100 characters'),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Verification token is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
