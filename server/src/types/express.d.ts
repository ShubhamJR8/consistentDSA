import { TokenPayload } from '../utils/jwt.js';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
      /** Correlation id for this request (see middleware/requestId.ts). */
      id?: string;
    }
  }
}
