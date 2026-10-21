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
import { CommitmentTransaction } from '../models/commitmentTransaction.model.js';
import { User } from '../models/user.model.js';

const list = async (): Promise<void> => {
  const pending = await CommitmentTransaction.find({ type: 'REFUND', status: 'PENDING' }).sort({
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
    console.log(`user:               ${user?.email ?? '(deleted)'} (${tx.userId.toString()})`);
    console.log(`commitment:         ${tx.commitmentId.toString()} — ${commitment?.planName ?? '(deleted)'}`);
    console.log(`commitment status:  ${commitment?.status ?? 'unknown'}`);
    console.log(`deposit:            ₹${commitment?.depositAmount ?? '?'}`);
    console.log(`missed days:        ${commitment?.missedDays ?? '?'} / ${commitment?.durationDays ?? '?'}`);
    console.log(`refund amount:      ₹${tx.amount} (matches commitment.currentProtectedAmount: ${commitment?.currentProtectedAmount === tx.amount})`);
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

  const tx = await CommitmentTransaction.findById(transactionId);
  if (!tx) {
    console.error(`No transaction found with id ${transactionId}.`);
    process.exitCode = 1;
    return;
  }
  if (tx.type !== 'REFUND' || tx.status !== 'PENDING') {
    console.error(`Transaction ${transactionId} is not a pending refund (type=${tx.type}, status=${tx.status}).`);
    process.exitCode = 1;
    return;
  }
  if (!tx.razorpayPaymentId) {
    console.error(`Transaction ${transactionId} has no original payment id to refund against.`);
    process.exitCode = 1;
    return;
  }

  // Re-check against the commitment's current numbers right before calling Razorpay — catches the
  // rare case where something changed between `list` and `execute`.
  const commitment = await Commitment.findById(tx.commitmentId);
  if (!commitment || !['COMPLETED', 'FAILED'].includes(commitment.status)) {
    console.error(`Commitment ${tx.commitmentId.toString()} is not in a finalized state.`);
    process.exitCode = 1;
    return;
  }
  if (commitment.currentProtectedAmount !== tx.amount) {
    console.error(
      `Amount mismatch: transaction says ₹${tx.amount}, commitment.currentProtectedAmount is ₹${commitment.currentProtectedAmount}. Refusing to proceed.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Refunding ₹${tx.amount} against payment ${tx.razorpayPaymentId}...`);
  try {
    const refund = await razorpayClient.refund(tx.razorpayPaymentId, tx.amount * 100);
    tx.status = 'SUCCESS';
    tx.razorpayRefundId = refund.id;
    tx.reference = 'Refund executed via manual script';
    await tx.save();
    console.log(`Success. Razorpay refund id: ${refund.id}`);
  } catch (error) {
    tx.status = 'FAILED';
    tx.reference = `Refund attempt failed: ${error instanceof Error ? error.message : String(error)}`;
    await tx.save();
    console.error('Refund failed:', error);
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
    console.error('Usage: tsx src/scripts/refunds.ts list | execute <transactionId>');
    process.exitCode = 1;
  }

  await mongoose.disconnect();
};

main().catch((error) => {
  console.error('[Refunds] Failed:', error);
  process.exit(1);
});
