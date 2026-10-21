import type { Response } from 'express';
import ms from 'ms';
import { env } from '../config/env.js';

export const AUTH_COOKIE_NAME = 'commitdsa_token';

// In production the client and API may live on different origins (e.g. separate Vercel/Render
// deployments), so the cookie needs SameSite=None + Secure to survive a cross-site request. In
// dev there's no HTTPS, and Vite proxies /api same-origin anyway, so Lax without Secure works.
const cookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: (env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  path: '/',
});

export const setAuthCookie = (res: Response, token: string): void => {
  res.cookie(AUTH_COOKIE_NAME, token, {
    ...cookieOptions(),
    maxAge: ms(env.JWT_EXPIRES_IN as ms.StringValue),
  });
};

export const clearAuthCookie = (res: Response): void => {
  res.clearCookie(AUTH_COOKIE_NAME, cookieOptions());
};
