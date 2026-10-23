import { createApp } from './app.js';
import { connectDB } from './config/db.js';
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

  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);
};

startServer().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
