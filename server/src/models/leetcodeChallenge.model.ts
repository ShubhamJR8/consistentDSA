import mongoose, { Schema, Document, Types } from 'mongoose';

/** The single outstanding "put this in your LeetCode About field" challenge for a user. Only a
 *  SHA-256 of the token is stored — the raw token is shown once, when it is generated. */
export interface ILeetCodeChallenge extends Document<Types.ObjectId> {
  userId: Types.ObjectId;
  /** Normalized (lower-cased) LeetCode username the challenge is bound to. */
  username: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

const LeetCodeChallengeSchema = new Schema<ILeetCodeChallenge>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One outstanding challenge per user: generating a new one replaces (invalidates) the old one.
LeetCodeChallengeSchema.index({ userId: 1 }, { unique: true });
// Housekeeping only — expiry is always enforced in queries, not left to the TTL monitor.
LeetCodeChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export const LeetCodeChallenge = mongoose.model<ILeetCodeChallenge>(
  'LeetCodeChallenge',
  LeetCodeChallengeSchema
);
