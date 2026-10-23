import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createHmac } from 'crypto';

vi.hoisted(() => {
  process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook_test_secret_value';
});

import { createApp } from '../app.js';
import { env, envSchema } from '../config/env.js';
import { User } from '../models/user.model.js';
import { extractAuthCookie } from '../test-utils/authCookie.js';

const TEST_DB = 'commit_dsa_test_hardening';
const EVIL = 'https://evil.example';

describe('CSRF origin guard', () => {
  const app = createApp();
  let cookie: string;

  beforeAll(async () => {
    const match = env.MONGODB_URI.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/[^/?]*(\?.*)?$/);
    await mongoose.connect(
      match ? `${match[1]}/${TEST_DB}${match[2] ?? ''}` : `${env.MONGODB_URI}/${TEST_DB}`
    );
    expect(mongoose.connection.name).toBe(TEST_DB);
    await mongoose.connection.dropDatabase();
    await User.init();
    const reg = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Csrf',
        email: `csrf-${Date.now()}@example.com`,
        password: 'password123',
        timezone: 'Asia/Kolkata',
      });
    expect(reg.status).toBe(201);
    cookie = extractAuthCookie(reg);
  });

  afterAll(async () => {
    if (mongoose.connection.name === TEST_DB) await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  it('rejects a state-changing request from a foreign origin even with a valid session', async () => {
    const res = await request(app)
      .post('/api/commitments/000000000000000000000000/cancel')
      .set({ Cookie: cookie, Origin: EVIL });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('also rejects the opaque "null" origin and look-alike hosts', async () => {
    for (const origin of ['null', `${env.CLIENT_URL}.evil.example`, 'http://localhost:5174']) {
      const res = await request(app)
        .post('/api/auth/logout')
        .set({ Cookie: cookie, Origin: origin });
      expect(res.status, origin).toBe(403);
    }
  });

  it('rejects a browser request that declares itself cross-site and sends no Origin', async () => {
    const res = await request(app)
      .post('/api/commitments/000000000000000000000000/cancel')
      .set({ Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' });
    expect(res.status).toBe(403);
  });

  it('lets the real client origin through to normal handling', async () => {
    const res = await request(app)
      .post('/api/commitments/000000000000000000000000/cancel')
      .set({ Cookie: cookie, Origin: new URL(env.CLIENT_URL).origin });
    expect(res.status).toBe(404); // reached the handler: commitment doesn't exist
  });

  it('leaves non-browser callers (no Origin) and reads from other origins to normal auth', async () => {
    const noOrigin = await request(app)
      .post('/api/commitments/000000000000000000000000/cancel')
      .set({ Cookie: cookie });
    expect(noOrigin.status).toBe(404);

    const read = await request(app).get('/api/commitments').set({ Cookie: cookie, Origin: EVIL });
    expect(read.status).toBe(200); // CORS stops the foreign page reading it; nothing was changed
    expect(read.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not apply to the signed webhook, which is server to server', async () => {
    const body = JSON.stringify({ event: 'payment.failed', payload: {} });
    const res = await request(app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('Origin', EVIL)
      .set(
        'X-Razorpay-Signature',
        createHmac('sha256', 'webhook_test_secret_value').update(body).digest('hex')
      )
      .send(body);
    expect(res.status).toBe(200);
  });

  it('no longer accepts form-encoded bodies, the classic cross-site form vector', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .type('form')
      .send({ email: 'a@example.com', password: 'password123' });
    expect(res.status).toBe(400); // body was not parsed, so validation fails
  });
});

describe('health check', () => {
  const app = createApp();

  it('reports unhealthy with a 503 when the database is down', async () => {
    const spy = vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(0);
    const res = await request(app).get('/api/health');
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.body.data).toMatchObject({ status: 'unhealthy', database: 'down' });
  });
});

describe('production configuration', () => {
  const full = {
    NODE_ENV: 'production',
    JWT_SECRET: 'x'.repeat(40),
    CLIENT_URL: 'https://app.example.com',
    RAZORPAY_KEY_ID: 'rzp_live_x',
    RAZORPAY_KEY_SECRET: 'secret',
    RAZORPAY_WEBHOOK_SECRET: 'webhook_secret',
    EMAIL_HOST: 'smtp.example.com',
    EMAIL_USER: 'user',
    EMAIL_PASS: 'pass',
  };
  const issues = (input: Record<string, string | undefined>) => {
    const result = envSchema.safeParse(input);
    return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
  };

  it('accepts a complete production configuration', () => {
    expect(issues(full)).toEqual([]);
  });

  it.each([
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'EMAIL_HOST',
    'EMAIL_USER',
    'EMAIL_PASS',
    'JWT_SECRET',
  ])('refuses to boot in production without %s', (key) => {
    expect(issues({ ...full, [key]: undefined })).toContain(key);
  });

  it('refuses a non-https CLIENT_URL in production', () => {
    expect(issues({ ...full, CLIENT_URL: 'http://app.example.com' })).toContain('CLIENT_URL');
  });

  it('keeps development frictionless: none of that is required outside production', () => {
    expect(issues({ NODE_ENV: 'development' })).toEqual([]);
  });
});
