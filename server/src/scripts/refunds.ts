/**
 * Manual refund review/execution CLI — real money only ever moves through this script, run by
 * hand, never automatically. reconcile() (via the lazy read/write path or the settlement sweep
 * job) only ever queues a PENDING REFUND row; nothing else touches Razorpay's refund API.
 *
 * Usage:
 *   tsx src/scripts/refunds.ts list
 *   tsx src/scripts/refunds.ts execute <transactionId>
 */
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { isRazorpayConfigured, razorpayClient } from '../integrations/razorpay/razorpay.client.js';
import { Commitment } from '../models/commitment.model.js';
import { executeRefund } from '../services/refundExecution.service.js';
import { CommitmentTransaction } from '../models/commitmentTransaction.model.js';
import { User } from '../models/user.model.js';

const list = async (): Promise<void> => {
  const pending = await CommitmentTransaction.find({
    type: 'REFUND',
    status: { $in: ['PENDING', 'PROCESSING'] },
  }).sort({
    createdAt: 1,
  });

  if (pending.length === 0) {
    console.log('No refunds pending.');
    return;
  }

  for (const tx of pending) {
    const [commitment, user] = await Promise.all([
      Commitment.findById(tx.commitmentId),
      User.findById(tx.userId),
    ]);
    console.log('----------------------------------------');
    console.log(`transactionId:      ${tx._id.toString()}`);
    console.log(`reason:             ${tx.refundReason ?? 'SETTLEMENT'}`);
    console.log(
      `state:              ${tx.status}${tx.status === 'PROCESSING' ? ' (outcome unknown - check Razorpay, then re-run execute)' : ''}`
    );
    console.log(`user:               ${user?.email ?? '(deleted)'} (${tx.userId.toString()})`);
    console.log(
      `commitment:         ${tx.commitmentId.toString()} — ${commitment?.planName ?? '(deleted)'}`
    );
    console.log(`commitment status:  ${commitment?.status ?? 'unknown'}`);
    console.log(`deposit:            ₹${commitment?.depositAmount ?? '?'}`);
    console.log(
      `missed days:        ${commitment?.missedDays ?? '?'} / ${commitment?.durationDays ?? '?'}`
    );
    console.log(
      `refund amount:      ₹${tx.amount} (matches commitment.currentProtectedAmount: ${commitment?.currentProtectedAmount === tx.amount})`
    );
    console.log(`forfeited:          ₹${commitment?.currentForfeitedAmount ?? '?'}`);
    console.log(`original payment:   ${tx.razorpayPaymentId}`);
    console.log(`queued at:          ${tx.createdAt.toISOString()}`);
  }
  console.log('----------------------------------------');
  console.log(`${pending.length} refund(s) pending. Verify in the Razorpay dashboard, then run:`);
  console.log('  tsx src/scripts/refunds.ts execute <transactionId>');
};

const execute = async (transactionId: string): Promise<void> => {
  if (!isRazorpayConfigured()) {
    console.error('Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET unset).');
    process.exitCode = 1;
    return;
  }

  const result = await executeRefund(transactionId, razorpayClient);
  if (result.ok) {
    console.log(
      result.code === 'ADOPTED_EXISTING'
        ? `Refund already existed on Razorpay; ledger updated. ${result.message}`
        : `Success. ${result.message}`
    );
  } else {
    console.error(`${result.code}: ${result.message}`);
    process.exitCode = 1;
  }
};

const main = async (): Promise<void> => {
  const [command, arg] = process.argv.slice(2);
  await connectDB();

  if (command === 'list') {
    await list();
  } else if (command === 'execute' && arg) {
    await execute(arg);
  } else {
    console.error(
      'Usage: refunds list | execute <transactionId>  (npm run refunds:list|refunds:execute, or node dist/scripts/refunds.js ...)'
    );
    process.exitCode = 1;
  }

  await mongoose.disconnect();
};

main().catch((error) => {
  console.error('[Refunds] Failed:', error);
  process.exit(1);
});
