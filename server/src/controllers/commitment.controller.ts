import { CommitmentService } from '../services/commitment.service.js';
import { DailyProgressService } from '../services/dailyProgress.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

// The user always comes from the verified token, never from the request body.
export class CommitmentController {
  static options = asyncHandler(async (_req, res) => {
    sendSuccess(res, CommitmentService.getOptions());
  });

  static create = asyncHandler(async (req, res) => {
    sendSuccess(res, await CommitmentService.create(req.user!.userId, req.body), 201);
  });

  static list = asyncHandler(async (req, res) => {
    sendSuccess(res, await CommitmentService.list(req.user!.userId));
  });

  static getById = asyncHandler(async (req, res) => {
    sendSuccess(res, await CommitmentService.getById(req.user!.userId, req.params.id));
  });

  static devActivate = asyncHandler(async (req, res) => {
    sendSuccess(res, await CommitmentService.activateForDev(req.user!.userId, req.params.id));
  });

  static today = asyncHandler(async (req, res) => {
    sendSuccess(res, await DailyProgressService.getToday(req.user!.userId, req.params.id));
  });

  static recordProblem = asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await DailyProgressService.setProblemCompletion(req.user!.userId, req.params.id, req.body)
    );
  });

  static cancel = asyncHandler(async (req, res) => {
    sendSuccess(res, await CommitmentService.cancelUnpaid(req.user!.userId, req.params.id));
  });

  static completeDay = asyncHandler(async (req, res) => {
    sendSuccess(res, await DailyProgressService.completeDay(req.user!.userId, req.params.id));
  });

  static progress = asyncHandler(async (req, res) => {
    sendSuccess(res, await DailyProgressService.getProgress(req.user!.userId, req.params.id));
  });

  static ledger = asyncHandler(async (req, res) => {
    sendSuccess(res, await CommitmentService.getLedger(req.user!.userId, req.params.id));
  });
}
