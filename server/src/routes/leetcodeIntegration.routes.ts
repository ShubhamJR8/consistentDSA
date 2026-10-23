import { Router } from 'express';
import { LeetCodeIntegrationController } from '../controllers/leetcodeIntegration.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  leetCodeChallengeRateLimiter,
  leetCodeVerifyRateLimiter,
} from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { leetCodeUsernameSchema } from '../schemas/leetcode.schema.js';

const router = Router();

router.use(requireAuth);

router.post(
  '/challenge',
  leetCodeChallengeRateLimiter,
  validate(leetCodeUsernameSchema),
  LeetCodeIntegrationController.createChallenge
);
router.post(
  '/verify',
  leetCodeVerifyRateLimiter,
  validate(leetCodeUsernameSchema),
  LeetCodeIntegrationController.verify
);
router.delete('/', LeetCodeIntegrationController.disconnect);

export default router;
