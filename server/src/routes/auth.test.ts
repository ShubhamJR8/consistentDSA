import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import mongooseDb from 'mongoose';
import { createApp } from '../app.js';
import { User } from '../models/user.model.js';
import { env } from '../config/env.js';
import { AUTH_COOKIE_NAME } from '../utils/cookies.js';
import { extractAuthCookie } from '../test-utils/authCookie.js';

describe('Auth API Integration Tests', () => {
  const app = createApp();

  beforeAll(async () => {
    // Connect to test MongoDB database
    const testDbUri = env.MONGODB_URI.replace('/commit_dsa', '/commit_dsa_test');
    if (mongooseDb.connection.readyState === 0) {
      await mongooseDb.connect(testDbUri);
    }
    await User.deleteMany({});
  });

  afterAll(async () => {
    await User.deleteMany({});
    await mongooseDb.connection.close();
  });

  it('GET /api/health should return 200 and healthy status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('healthy');
  });

  it('POST /api/auth/register should create a new user and set an auth cookie', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Alex Dev',
      email: 'alex@example.com',
      password: 'password123',
      timezone: 'Asia/Kolkata',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeUndefined();
    expect(extractAuthCookie(res)).toContain(`${AUTH_COOKIE_NAME}=`);
    expect(res.body.data.user.email).toBe('alex@example.com');
    expect(res.body.data.user.name).toBe('Alex Dev');
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('POST /api/auth/register should fail on duplicate email', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Alex Duplicate',
      email: 'alex@example.com',
      password: 'password123',
    });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('POST /api/auth/login should authenticate valid user', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'alex@example.com',
      password: 'password123',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeUndefined();
    expect(extractAuthCookie(res)).toContain(`${AUTH_COOKIE_NAME}=`);
    expect(res.body.data.user.email).toBe('alex@example.com');
  });

  it('POST /api/auth/login should reject invalid password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'alex@example.com',
      password: 'wrongpassword',
    });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('GET /api/auth/me should return current user profile with a valid auth cookie', async () => {
    // Login first to get the cookie
    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'alex@example.com',
      password: 'password123',
    });

    const cookie = extractAuthCookie(loginRes);

    const meRes = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect(meRes.status).toBe(200);
    expect(meRes.body.success).toBe(true);
    expect(meRes.body.data.email).toBe('alex@example.com');
    expect(meRes.body.data.name).toBe('Alex Dev');
  });

  it('GET /api/auth/me should reject unauthenticated request', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('MISSING_TOKEN');
  });

  it('POST /api/auth/logout clears the auth cookie', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'alex@example.com',
      password: 'password123',
    });
    const cookie = extractAuthCookie(loginRes);

    const logoutRes = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(logoutRes.status).toBe(200);

    const setCookie = logoutRes.headers['set-cookie'] as unknown as string[];
    const cleared = setCookie.find((c) => c.startsWith(`${AUTH_COOKIE_NAME}=`));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

    const meRes = await request(app).get('/api/auth/me').set('Cookie', cleared!.split(';')[0]);
    expect(meRes.status).toBe(401);
  });

  describe('Password reset flow', () => {
    // EMAIL_HOST is unset in the test env, so the reset link is logged to the console (the
    // documented dev/test fallback) rather than actually emailed — capture it from there.
    const captureResetUrl = async (email: string): Promise<string> => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const res = await request(app).post('/api/auth/forgot-password').send({ email });
      expect(res.status).toBe(200);

      const logged = logSpy.mock.calls.map((call) => call.join(' ')).find((line) => line.includes('reset-password?token='));
      logSpy.mockRestore();
      if (!logged) {
        throw new Error('Reset URL was not logged — email fallback did not fire as expected');
      }
      const match = logged.match(/token=([a-f0-9]+)/);
      if (!match) {
        throw new Error('Could not extract reset token from logged URL');
      }
      return match[1];
    };

    it('POST /api/auth/forgot-password returns generic success for an unknown email (no enumeration)', async () => {
      const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('resets the password, invalidates prior sessions, and allows login with the new password', async () => {
      const oldLoginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'alex@example.com', password: 'password123' });
      const oldCookie = extractAuthCookie(oldLoginRes);

      const token = await captureResetUrl('alex@example.com');

      const resetRes = await request(app)
        .post('/api/auth/reset-password')
        .send({ token, password: 'newpassword456' });
      expect(resetRes.status).toBe(200);
      expect(resetRes.body.success).toBe(true);
      expect(resetRes.body.data.token).toBeUndefined();
      expect(resetRes.body.data.user.email).toBe('alex@example.com');
      const newCookie = extractAuthCookie(resetRes);

      const staleMeRes = await request(app).get('/api/auth/me').set('Cookie', oldCookie);
      expect(staleMeRes.status).toBe(401);
      expect(staleMeRes.body.error.code).toBe('INVALID_TOKEN');

      const freshMeRes = await request(app).get('/api/auth/me').set('Cookie', newCookie);
      expect(freshMeRes.status).toBe(200);

      const oldPasswordLoginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'alex@example.com', password: 'password123' });
      expect(oldPasswordLoginRes.status).toBe(401);

      const newPasswordLoginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'alex@example.com', password: 'newpassword456' });
      expect(newPasswordLoginRes.status).toBe(200);
      expect(extractAuthCookie(newPasswordLoginRes)).toContain(`${AUTH_COOKIE_NAME}=`);
    });

    it('rejects reuse of an already-consumed reset token', async () => {
      const token = await captureResetUrl('alex@example.com');

      const firstUse = await request(app).post('/api/auth/reset-password').send({ token, password: 'anotherpass789' });
      expect(firstUse.status).toBe(200);

      const secondUse = await request(app).post('/api/auth/reset-password').send({ token, password: 'yetanother000' });
      expect(secondUse.status).toBe(400);
      expect(secondUse.body.error.code).toBe('INVALID_RESET_TOKEN');
    });

    it('rejects an invalid/unknown reset token', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'not-a-real-token', password: 'somepassword1' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_RESET_TOKEN');
    });
  });

  describe('Email verification flow', () => {
    let registerCookie: string;

    // Same console-log fallback as the password-reset flow (EMAIL_HOST is unset in tests).
    const captureLoggedUrl = async (
      triggerRequest: () => Promise<request.Test>,
      urlFragment: string
    ): Promise<string> => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const res = await triggerRequest();

      const logged = logSpy.mock.calls
        .map((call) => call.join(' '))
        .find((line) => line.includes(`${urlFragment}?token=`));
      logSpy.mockRestore();
      expect(res.status).toBeLessThan(300);
      if (!logged) {
        throw new Error(`URL containing "${urlFragment}?token=" was not logged`);
      }
      const match = logged.match(/token=([a-f0-9]+)/);
      if (!match) {
        throw new Error('Could not extract token from logged URL');
      }
      return match[1];
    };

    it('registering a new account starts out unverified and logs a verification link', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const res = await request(app).post('/api/auth/register').send({
        name: 'Verify Me',
        email: 'verifyme@example.com',
        password: 'password123',
      });
      const logged = logSpy.mock.calls.map((call) => call.join(' ')).find((line) => line.includes('verify-email?token='));
      logSpy.mockRestore();

      expect(res.status).toBe(201);
      expect(res.body.data.user.emailVerified).toBe(false);
      expect(logged).toBeDefined();
      registerCookie = extractAuthCookie(res);
    });

    it('POST /api/auth/verify-email marks the account verified with a valid token', async () => {
      const token = await captureLoggedUrl(
        () => request(app).post('/api/auth/resend-verification').set('Cookie', registerCookie),
        'verify-email'
      );

      const verifyRes = await request(app).post('/api/auth/verify-email').send({ token });
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.emailVerified).toBe(true);

      const meRes = await request(app).get('/api/auth/me').set('Cookie', registerCookie);
      expect(meRes.body.data.emailVerified).toBe(true);
    });

    it('POST /api/auth/verify-email rejects an invalid/unknown token', async () => {
      const res = await request(app).post('/api/auth/verify-email').send({ token: 'not-a-real-token' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_VERIFICATION_TOKEN');
    });

    it('POST /api/auth/resend-verification requires authentication', async () => {
      const res = await request(app).post('/api/auth/resend-verification');
      expect(res.status).toBe(401);
    });

    it('POST /api/auth/resend-verification rejects an already-verified account', async () => {
      const res = await request(app).post('/api/auth/resend-verification').set('Cookie', registerCookie);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_ALREADY_VERIFIED');
    });
  });
});
