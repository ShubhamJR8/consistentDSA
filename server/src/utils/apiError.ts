export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(statusCode: number, code: string, message: string, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(code: string, message: string): ApiError {
    return new ApiError(400, code, message);
  }

  static unauthorized(
    code: string = 'UNAUTHORIZED',
    message: string = 'Authentication required'
  ): ApiError {
    return new ApiError(401, code, message);
  }

  static forbidden(code: string = 'FORBIDDEN', message: string = 'Permission denied'): ApiError {
    return new ApiError(403, code, message);
  }

  static notFound(code: string = 'NOT_FOUND', message: string = 'Resource not found'): ApiError {
    return new ApiError(404, code, message);
  }

  static conflict(
    code: string = 'CONFLICT',
    message: string = 'Resource already exists'
  ): ApiError {
    return new ApiError(409, code, message);
  }

  static tooManyRequests(
    code: string = 'TOO_MANY_REQUESTS',
    message: string = 'Too many requests, please try again later'
  ): ApiError {
    return new ApiError(429, code, message);
  }

  static serviceUnavailable(
    code: string = 'SERVICE_UNAVAILABLE',
    message: string = 'Service temporarily unavailable'
  ): ApiError {
    return new ApiError(503, code, message);
  }

  static internal(
    code: string = 'INTERNAL_ERROR',
    message: string = 'Internal server error'
  ): ApiError {
    return new ApiError(500, code, message, false);
  }
}
