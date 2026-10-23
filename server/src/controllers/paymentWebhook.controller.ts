import { PaymentWebhookService } from '../services/paymentWebhook.service.js';
import { ApiError } from '../utils/apiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

export class PaymentWebhookController {
  // Mounted with express.raw() (see app.ts) — the signature covers the exact bytes received.
  static handle = asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
      throw ApiError.badRequest('WEBHOOK_PAYLOAD_INVALID', 'Expected a JSON body.');
    }
    const signature = req.header('x-razorpay-signature');
    const outcome = await PaymentWebhookService.handle(req.body, signature);
    // 2xx tells Razorpay to stop retrying; every outcome that reaches here is final.
    sendSuccess(res, { outcome });
  });
}
