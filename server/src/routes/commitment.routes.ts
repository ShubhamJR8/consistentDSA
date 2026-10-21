import { Router } from 'express';
import { env } from '../config/env.js';
import { CommitmentController } from '../controllers/commitment.controller.js';
import { LeetCodeVerificationController } from '../controllers/leetcodeVerification.controller.js';
import { SubmissionController } from '../controllers/submission.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.js';
import { createCommitmentSchema, recordProblemSchema } from '../schemas/commitment.schema.js';
import { runSubmissionSchema } from '../schemas/submission.schema.js';

const router = Router();

router.use(requireAuth);

router.get('/options', CommitmentController.options);
router.post('/', validate(createCommitmentSchema), CommitmentController.create);
router.get('/', CommitmentController.list);
router.get('/:id', CommitmentController.getById);
router.get('/:id/today', CommitmentController.today);
router.get('/:id/progress', CommitmentController.progress);
router.get('/:id/ledger', CommitmentController.ledger);
router.post(
  '/:id/daily-progress',
  validate(recordProblemSchema),
  CommitmentController.recordProblem
);
router.post('/:id/daily-progress/complete', CommitmentController.completeDay);
router.post('/:id/verify-today', LeetCodeVerificationController.verifyToday);
router.post(
  '/:id/today/problems/:problemId/run',
  validate(runSubmissionSchema),
  SubmissionController.run
);
router.post(
  '/:id/today/problems/:problemId/submit',
  validate(runSubmissionSchema),
  SubmissionController.submit
);

if (env.NODE_ENV !== 'production') {
  router.post('/:id/dev-activate', CommitmentController.devActivate);
}

export default router;
