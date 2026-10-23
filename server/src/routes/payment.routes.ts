import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { paymentRateLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { createOrderSchema, verifyPaymentSchema } from '../schemas/payment.schema.js';

const router = Router();

router.use(requireAuth, paymentRateLimiter);

router.post('/create', validate(createOrderSchema), PaymentController.createOrder);
router.post('/verify', validate(verifyPaymentSchema), PaymentController.verify);

export default router;
