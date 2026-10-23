import { NextFunction, Request, Response } from 'express';
import { allowedOrigins } from '../config/origins.js';
import { ApiError } from '../utils/apiError.js';

// The auth cookie is SameSite=None in production (client and API are on different sites), so the
// browser attaches it to cross-site requests too. CORS only stops a foreign page from *reading* a
// response — a body-less POST like /verify-today or /daily-progress/complete still executes. Browsers
// always send Origin on cross-site state-changing requests, so rejecting an unexpected one closes that
// hole without a token. A request with no Origin is not a cross-site browser request (curl, server to
// server, same-origin navigation) and is left to normal auth.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const originGuard = (req: Request, _res: Response, next: NextFunction): void => {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get('origin');
  if (origin === undefined) {
    // A browser that omits Origin but says the request is cross-site is still not one of ours.
    if (req.get('sec-fetch-site') === 'cross-site') {
      return next(ApiError.forbidden('ORIGIN_NOT_ALLOWED', 'Cross-site request rejected.'));
    }
    return next();
  }
  if (allowedOrigins.includes(origin)) return next();
  next(ApiError.forbidden('ORIGIN_NOT_ALLOWED', 'Cross-site request rejected.'));
};
