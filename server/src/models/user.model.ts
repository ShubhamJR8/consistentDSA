import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  timezone: string;
  role: 'USER' | 'ADMIN';
  // Public username only — never a password, session cookie or auth token. Used to look up
  // recent Accepted submissions for LeetCode-based completion verification.
  leetcodeUsername?: string;
  /** Bumped on every password reset; embedded in issued JWTs so resetting a password
   *  invalidates every session issued before it, not just future login attempts. */
  tokenVersion: number;
  /** SHA-256 hash of the active password-reset token, never the token itself. */
  passwordResetTokenHash?: string;
  passwordResetExpiresAt?: Date;
  emailVerified: boolean;
  /** SHA-256 hash of the active email-verification token, never the token itself. */
  emailVerificationTokenHash?: string;
  emailVerificationExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/\S+@\S+\.\S+/, 'Please provide a valid email address'],
      index: true,
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
      select: false,
    },
    timezone: {
      type: String,
      required: [true, 'Timezone is required'],
      default: 'Asia/Kolkata',
      trim: true,
    },
    role: {
      type: String,
      enum: ['USER', 'ADMIN'],
      default: 'USER',
    },
    leetcodeUsername: {
      type: String,
      trim: true,
      maxlength: [50, 'LeetCode username cannot exceed 50 characters'],
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
    passwordResetTokenHash: {
      type: String,
      select: false,
    },
    passwordResetExpiresAt: {
      type: Date,
      select: false,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationTokenHash: {
      type: String,
      select: false,
    },
    emailVerificationExpiresAt: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

UserSchema.index({ passwordResetTokenHash: 1 }, { sparse: true });
UserSchema.index({ emailVerificationTokenHash: 1 }, { sparse: true });

export const User = mongoose.model<IUser>('User', UserSchema);
