import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface TokenPayload {
  userId: string;
  email: string;
  role: 'USER' | 'ADMIN';
  /** Must match the user's current tokenVersion — a password reset bumps it, invalidating every
   *  token issued before that point. See middleware/auth.middleware.ts. */
  tokenVersion: number;
}

export const signToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
};

export const verifyToken = (token: string): TokenPayload => {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
};
