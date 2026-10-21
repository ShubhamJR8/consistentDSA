import { UserService } from '../services/user.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

export class UserController {
  static connectLeetCode = asyncHandler(async (req, res) => {
    sendSuccess(res, await UserService.connectLeetCode(req.user!.userId, req.body.username));
  });
}
