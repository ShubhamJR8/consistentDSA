export interface User {
  id: string;
  name: string;
  email: string;
  timezone: string;
  role: 'USER' | 'ADMIN';
  createdAt: string;
  /** Only set once the user has proven they own the account. */
  leetcodeUsername: string | null;
  leetcodeVerifiedAt: string | null;
  emailVerified: boolean;
}

export interface AuthResult {
  user: User;
}

export interface ApiFieldIssue {
  field: string;
  message: string;
}

export type ApiEnvelope<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; details?: unknown } };
