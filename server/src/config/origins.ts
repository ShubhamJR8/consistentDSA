import { env } from './env.js';

/** The browser origins allowed to call this API with credentials. Used for both CORS and the CSRF
 *  origin check, so the two can never disagree. localhost is only trusted outside production. */
const toOrigin = (value: string): string => new URL(value).origin;

export const allowedOrigins: readonly string[] = [
  ...new Set([
    toOrigin(env.CLIENT_URL),
    ...(env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']),
  ]),
];
