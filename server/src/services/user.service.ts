import { User } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.js';
import { leetCodeClient } from '../integrations/leetcode/leetcode.client.js';
import { AuthResponseUser, formatUserResponse } from './auth.service.js';

export class UserService {
  /** Connects (or replaces) the user's public LeetCode username. Verifies the username actually
   *  exists on LeetCode before saving it — we never store credentials, only this public handle. */
  static async connectLeetCode(userId: string, username: string): Promise<AuthResponseUser> {
    let submissions: Awaited<ReturnType<typeof leetCodeClient.getRecentSubmissions>>;
    try {
      submissions = await leetCodeClient.getRecentSubmissions(username);
    } catch {
      throw ApiError.internal(
        'LEETCODE_UNAVAILABLE',
        "Couldn't reach LeetCode to verify that username. Try again in a moment."
      );
    }

    if (submissions === null) {
      throw ApiError.badRequest(
        'LEETCODE_USERNAME_NOT_FOUND',
        "We couldn't verify this LeetCode username. Please check the username and try again."
      );
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { leetcodeUsername: username } },
      { new: true }
    );
    if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'User profile not found');
    return formatUserResponse(user);
  }
}
