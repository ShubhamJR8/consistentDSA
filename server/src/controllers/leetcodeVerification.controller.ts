import { LeetCodeVerificationService } from '../services/leetcodeVerification.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

export class LeetCodeVerificationController {
  static verifyToday = asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await LeetCodeVerificationService.verifyToday(req.user!.userId, req.params.id)
    );
  });
}
