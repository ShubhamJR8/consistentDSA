import { SubmissionService } from '../services/submission.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

export class SubmissionController {
  static run = asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await SubmissionService.run(req.user!.userId, req.params.id, req.params.problemId, req.body)
    );
  });

  static submit = asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await SubmissionService.submit(
        req.user!.userId,
        req.params.id,
        req.params.problemId,
        req.body
      )
    );
  });
}
