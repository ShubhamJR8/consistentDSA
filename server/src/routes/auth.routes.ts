import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { authRateLimiter } from '../middleware/rateLimit.js';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '../schemas/auth.schema.js';

const router = Router();

router.post('/register', authRateLimiter, validate(registerSchema), AuthController.register);
router.post('/login', authRateLimiter, validate(loginSchema), AuthController.login);
router.get('/me', requireAuth, AuthController.getMe);
router.post('/logout', AuthController.logout);
router.post('/forgot-password', authRateLimiter, validate(forgotPasswordSchema), AuthController.forgotPassword);
router.post('/reset-password', authRateLimiter, validate(resetPasswordSchema), AuthController.resetPassword);
router.post('/verify-email', authRateLimiter, validate(verifyEmailSchema), AuthController.verifyEmail);
router.post('/resend-verification', requireAuth, authRateLimiter, AuthController.resendVerification);

export default router;
