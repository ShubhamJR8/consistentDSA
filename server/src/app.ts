import express, { Express, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import authRoutes from './routes/auth.routes.js';
import commitmentRoutes from './routes/commitment.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import leetCodeIntegrationRoutes from './routes/leetcodeIntegration.routes.js';
import { planRoutes, problemRoutes } from './routes/catalog.routes.js';
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
  app.use(helmet());
  app.use(
    cors({
      origin: [env.CLIENT_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type'],
    })
  );

  if (env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  // Auth reads its JWT from an httpOnly cookie (see utils/cookies.ts) — needs the raw cookie
  // header parsed into req.cookies.
  app.use(cookieParser());

  // Bumped from 10kb: code submissions (esp. Java/C++ boilerplate) can exceed that easily.
  // Submission.code itself is still capped at 20kb at the schema level.
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: true, limit: '64kb' }));

  // Health check
  app.get('/api/health', (req: Request, res: Response) => {
    sendSuccess(res, {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'commit-dsa-server',
    });
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
