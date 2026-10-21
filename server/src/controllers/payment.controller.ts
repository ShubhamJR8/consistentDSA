import { PaymentService } from '../services/payment.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

// The user always comes from the verified token, never from the request body.
export class PaymentController {
  static createOrder = asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await PaymentService.createOrder(req.user!.userId, req.body.commitmentId),
      201
    );
  });

  static verify = asyncHandler(async (req, res) => {
    const { commitmentId, ...rest } = req.body;
    sendSuccess(res, await PaymentService.verifyPayment(req.user!.userId, commitmentId, rest));
  });
}
