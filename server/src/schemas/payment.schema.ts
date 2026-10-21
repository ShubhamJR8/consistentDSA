import { z } from 'zod';
import { OBJECT_ID_PATTERN } from '../utils/mongo.js';

const objectId = (label: string) => z.string().regex(OBJECT_ID_PATTERN, `Invalid ${label}`);

export const createOrderSchema = z.object({
  commitmentId: objectId('commitment id'),
});

export const verifyPaymentSchema = z.object({
  commitmentId: objectId('commitment id'),
  razorpayOrderId: z.string().min(1, 'razorpayOrderId is required'),
  razorpayPaymentId: z.string().min(1, 'razorpayPaymentId is required'),
  razorpaySignature: z.string().min(1, 'razorpaySignature is required'),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;
