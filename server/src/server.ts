import { createApp } from './app.js';
import { connectDB, ensureIndexes } from './config/db.js';
import { describeError, logger } from './utils/logger.js';
import { env } from './config/env.js';
import {
  startLeetCodeVerificationJob,
  stopLeetCodeVerificationJob,
} from './jobs/leetcodeVerification.job.js';
import {
  startPaymentReconciliationJob,
  stopPaymentReconciliationJob,
} from './jobs/paymentReconciliation.job.js';
import {
  startCommitmentSettlementJob,
  stopCommitmentSettlementJob,
} from './jobs/commitmentSettlement.job.js';

const startServer = async () => {
  await connectDB();
  await ensureIndexes();

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    console.log(
      `[Server] CommitDSA backend running on http://localhost:${env.PORT} (${env.NODE_ENV})`
    );
  });

  if (env.LEETCODE_VERIFICATION_ENABLED) {
    startLeetCodeVerificationJob(env.LEETCODE_VERIFICATION_INTERVAL_MINUTES);
    console.log(
      `[Server] LeetCode verification sweep enabled, every ${env.LEETCODE_VERIFICATION_INTERVAL_MINUTES}m`
    );
  }

  startCommitmentSettlementJob(env.COMMITMENT_SETTLEMENT_INTERVAL_MINUTES);
  console.log(
    `[Server] Commitment settlement sweep enabled, every ${env.COMMITMENT_SETTLEMENT_INTERVAL_MINUTES}m`
  );

  startPaymentReconciliationJob(env.PAYMENT_RECONCILIATION_INTERVAL_MINUTES);

  const handleShutdown = () => {
    console.log('\n[Server] Graceful shutdown initiated...');
    stopLeetCodeVerificationJob();
    stopCommitmentSettlementJob();
    stopPaymentReconciliationJob();
    server.close(() => {
      console.log('[Server] HTTP server closed.');
      process.exit(0);
    });
  };

  // State after an uncaught exception or unhandled rejection is unknown, so don't limp on: say so
  // loudly, finish in-flight requests briefly, and exit non-zero so the platform restarts the process.
  const crash = (event: string) => (error: unknown) => {
    logger.alert(event, describeError(error));
    stopLeetCodeVerificationJob();
    stopCommitmentSettlementJob();
    stopPaymentReconciliationJob();
    server.close(() => process.exit(1));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('uncaughtException', crash('uncaught_exception'));
  process.on('unhandledRejection', crash('unhandled_rejection'));

  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);
};

startServer().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
