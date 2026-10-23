import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

// Lets a user-reported failure be matched to the exact log lines. An inbound id (from a proxy or load
// balancer) is kept only if it is a plain token, since it is echoed into logs and response headers.
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

export const requestId = (req: Request, res: Response, next: NextFunction): void => {
  const inbound = req.get('x-request-id');
  req.id = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
