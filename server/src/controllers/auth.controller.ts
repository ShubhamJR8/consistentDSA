import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { setAuthCookie, clearAuthCookie } from '../utils/cookies.js';

export class AuthController {
  static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user, token } = await AuthService.register(req.body);
      setAuthCookie(res, token);
      sendSuccess(res, { user }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user, token } = await AuthService.login(req.body);
      setAuthCookie(res, token);
      sendSuccess(res, { user }, 200);
    } catch (error) {
      next(error);
    }
  }

  static logout(_req: Request, res: Response): void {
    clearAuthCookie(res);
    sendSuccess(res, { message: 'Logged out.' }, 200);
  }

  static async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await AuthService.getMe(req.user!.userId);
      sendSuccess(res, user, 200);
    } catch (error) {
      next(error);
    }
  }

  static async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await AuthService.requestPasswordReset(req.body.email);
      sendSuccess(res, { message: 'If an account exists for that email, a reset link has been sent.' }, 200);
    } catch (error) {
      next(error);
    }
  }

  static async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user, token } = await AuthService.resetPassword(req.body.token, req.body.password);
      setAuthCookie(res, token);
      sendSuccess(res, { user }, 200);
    } catch (error) {
      next(error);
    }
  }

  static async verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await AuthService.verifyEmail(req.body.token);
      sendSuccess(res, user, 200);
    } catch (error) {
      next(error);
    }
  }

  static async resendVerification(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await AuthService.resendVerificationEmail(req.user!.userId);
      sendSuccess(res, { message: 'Verification email sent.' }, 200);
    } catch (error) {
      next(error);
    }
  }
}
