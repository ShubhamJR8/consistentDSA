import { Router } from 'express';
import { UserController } from '../controllers/user.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.js';
import { connectLeetCodeSchema } from '../schemas/user.schema.js';

const router = Router();

router.use(requireAuth);
router.put('/me/leetcode', validate(connectLeetCodeSchema), UserController.connectLeetCode);

export default router;
