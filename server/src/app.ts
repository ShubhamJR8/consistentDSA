import express, { Express, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import authRoutes from './routes/auth.routes.js';
import commitmentRoutes from './routes/commitment.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import leetCodeIntegrationRoutes from './routes/leetcodeIntegration.routes.js';
import { PaymentWebhookController } from './controllers/paymentWebhook.controller.js';
import { planRoutes, problemRoutes } from './routes/catalog.routes.js';
import { allowedOrigins } from './config/origins.js';
import { originGuard } from './middleware/originGuard.js';
import { requestId } from './middleware/requestId.js';
import { getLeetCodeProviderStatus } from './integrations/leetcode/leetcode.client.js';
import { errorHandler } from './middleware/error.middleware.js';
import { ApiError } from './utils/apiError.js';
import { sendSuccess } from './utils/apiResponse.js';

export const createApp = (): Express => {
  const app = express();

  // Behind a reverse proxy (Render, Railway, nginx, etc.) in production, so req.ip reflects the
  // real client via X-Forwarded-For — needed for the auth rate limiter to key by IP correctly.
  if (env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  // Security & Utility Middleware
  app.use(requestId);
  app.use(helmet());
  app.use(
    cors({
      origin: [...allowedOrigins],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type'],
    })
  );

  if (env.NODE_ENV !== 'test') {
    morgan.token('rid', (req) => (req as express.Request).id ?? '-');
    app.use(
      morgan(
        env.NODE_ENV === 'production'
          ? ':remote-addr ":method :url HTTP/:http-version" :status :res[content-length] ":user-agent" rid=:rid :response-time ms'
          : 'dev'
      )
    );
  }

  // Razorpay webhook: server-to-server, so no cookie auth. It must see the raw bytes (the signature
  // covers them) and therefore has to be registered before express.json() below.
  app.post(
    '/api/payments/webhook',
    express.raw({ type: 'application/json', limit: '64kb' }),
    PaymentWebhookController.handle
  );

  // Auth reads its JWT from an httpOnly cookie (see utils/cookies.ts) — needs the raw cookie
  // header parsed into req.cookies.
  app.use(cookieParser());

  // Bumped from 10kb: code submissions (esp. Java/C++ boilerplate) can exceed that easily.
  // Submission.code itself is still capped at 20kb at the schema level.
  app.use(express.json({ limit: '64kb' }));

  // Rejects state-changing requests from foreign origins (CSRF). The webhook above is exempt: it is
  // server-to-server and authenticated by signature, not by cookie.
  app.use('/api', originGuard);

  // Health check. Reports the database too, so a load balancer stops routing to an instance that has
  // lost it instead of serving errors from a "healthy" process.
  app.get('/api/health', async (req: Request, res: Response) => {
    let database: 'up' | 'down' = 'down';
    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.db?.admin().ping();
        database = 'up';
      }
    } catch {
      database = 'down';
    }
    sendSuccess(
      res,
      {
        status: database === 'up' ? 'healthy' : 'unhealthy',
        database,
        // Informational only: a provider outage must not pull the server out of rotation, because
        // days are held open (not penalised) while it is down.
        leetcode: (({ state, lastSuccessAt, failingSince }) => ({
          state,
          lastSuccessAt,
          failingSince,
        }))(getLeetCodeProviderStatus()),
        timestamp: new Date().toISOString(),
        service: 'commit-dsa-server',
      },
      database === 'up' ? 200 : 503
    );
  });

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/integrations/leetcode', leetCodeIntegrationRoutes);
  app.use('/api/problems', problemRoutes);
  app.use('/api/plans', planRoutes);
  app.use('/api/commitments', commitmentRoutes);
  app.use('/api/payments', paymentRoutes);

  // Catch 404
  app.use((req: Request, res: Response, next: NextFunction) => {
    next(ApiError.notFound('ROUTE_NOT_FOUND', `Cannot ${req.method} ${req.originalUrl}`));
  });

  // Centralized Error Handling
  app.use(errorHandler);

  return app;
};
