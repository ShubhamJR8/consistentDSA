import { LeetCodeAccountService } from '../services/leetcodeAccount.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

// The user is always the authenticated one (req.user) — never taken from the body.
export class LeetCodeIntegrationController {
  static createChallenge = asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await LeetCodeAccountService.createChallenge(req.user!.userId, req.body.username)
    );
  });

  static verify = asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await LeetCodeAccountService.verifyChallenge(req.user!.userId, req.body.username)
    );
  });

  static disconnect = asyncHandler(async (req, res) => {
    sendSuccess(res, await LeetCodeAccountService.disconnect(req.user!.userId));
  });
}
