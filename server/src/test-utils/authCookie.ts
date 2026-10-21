import type request from 'supertest';
import { AUTH_COOKIE_NAME } from '../utils/cookies.js';

// Auth is carried in an httpOnly cookie, not the JSON body — pull the cookie's name=value pair
// out of Set-Cookie so it can be replayed on the next request via `.set('Cookie', ...)`.
export const extractAuthCookie = (res: request.Response): string => {
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = setCookie?.find((c) => c.startsWith(`${AUTH_COOKIE_NAME}=`));
  if (!cookie) {
    throw new Error('Response did not set an auth cookie');
  }
  return cookie.split(';')[0];
};
