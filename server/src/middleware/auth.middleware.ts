import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';
import { ApiError } from '../utils/apiError.js';
import { AUTH_COOKIE_NAME } from '../utils/cookies.js';
import { User } from '../models/user.model.js';

export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = req.cookies?.[AUTH_COOKIE_NAME];

  if (!token) {
    return next(ApiError.unauthorized('MISSING_TOKEN', 'Authentication is required'));
  }

  try {
    const payload = verifyToken(token);
    // Checked against the DB (not just the JWT signature) so a password reset — which bumps
    // tokenVersion — immediately invalidates every session issued before it.
    const user = await User.findById(payload.userId).select('tokenVersion');
    if (!user || user.tokenVersion !== payload.tokenVersion) {
      return next(ApiError.unauthorized('INVALID_TOKEN', 'Session has expired or token is invalid'));
    }
    req.user = payload;
    next();
  } catch {
    next(ApiError.unauthorized('INVALID_TOKEN', 'Session has expired or token is invalid'));
  }
};
