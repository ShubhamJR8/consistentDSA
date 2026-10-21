import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/apiError.js';
import { sendError } from '../utils/apiResponse.js';
import { env } from '../config/env.js';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction): void => {
  if (err instanceof ApiError) {
    sendError(res, err.statusCode, err.code, err.message);
    return;
  }

  // Handle Mongoose duplicate key error (code 11000)
  if (err.name === 'MongoServerError' && err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    sendError(res, 409, 'DUPLICATE_KEY', `An entry with this ${field} already exists`);
    return;
  }

  // Handle Mongoose validation errors
  if (err.name === 'ValidationError') {
    const details = Object.values(err.errors || {}).map((e: any) => ({
      field: e.path,
      message: e.message,
    }));
    sendError(res, 400, 'VALIDATION_ERROR', 'Validation failed', details);
    return;
  }

  console.error('[Unhandled Error]', err);

  const message = env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  sendError(res, 500, 'INTERNAL_SERVER_ERROR', message);
};
