import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { User, IUser } from '../models/user.model.js';
import { RegisterInput, LoginInput } from '../schemas/auth.schema.js';
import { ApiError } from '../utils/apiError.js';
import { signToken } from '../utils/jwt.js';
import { sendPasswordResetEmail, sendVerificationEmail } from './email.service.js';
import { env } from '../config/env.js';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

const issueVerificationToken = async (user: IUser): Promise<void> => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  user.emailVerificationTokenHash = hashToken(rawToken);
  user.emailVerificationExpiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);
  await user.save();

  const verifyUrl = `${env.CLIENT_URL}/verify-email?token=${rawToken}`;
  await sendVerificationEmail(user.email, verifyUrl);
};

export interface AuthResponseUser {
  id: string;
  name: string;
  email: string;
  leetcodeUsername: string | null;
  timezone: string;
  role: 'USER' | 'ADMIN';
  emailVerified: boolean;
  createdAt: Date;
}

export interface AuthResult {
  user: AuthResponseUser;
  token: string;
}

export const formatUserResponse = (user: IUser): AuthResponseUser => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  timezone: user.timezone,
  role: user.role,
  leetcodeUsername: user.leetcodeUsername ?? null,
  emailVerified: user.emailVerified,
  createdAt: user.createdAt,
});

export class AuthService {
  static async register(input: RegisterInput): Promise<AuthResult> {
    const existing = await User.findOne({ email: input.email });
    if (existing) {
      throw ApiError.conflict('EMAIL_ALREADY_EXISTS', 'An account with this email already exists');
    }

    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(input.password, saltRounds);

    const user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash,
      timezone: input.timezone || 'Asia/Kolkata',
      role: 'USER',
    });

    const token = signToken({
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });

    // Best-effort: a slow/broken SMTP provider shouldn't block account creation, since users
    // can always request another link via resendVerificationEmail.
    await issueVerificationToken(user).catch((error) => {
      console.error('Failed to send verification email:', error);
    });

    return {
      user: formatUserResponse(user),
      token,
    };
  }

  static async login(input: LoginInput): Promise<AuthResult> {
    const user = await User.findOne({ email: input.email }).select('+passwordHash');
    if (!user) {
      throw ApiError.unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const isMatch = await bcrypt.compare(input.password, user.passwordHash);
    if (!isMatch) {
      throw ApiError.unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');
    }

    const token = signToken({
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });

    return {
      user: formatUserResponse(user),
      token,
    };
  }

  static async getMe(userId: string): Promise<AuthResponseUser> {
    const user = await User.findById(userId);
    if (!user) {
      throw ApiError.notFound('USER_NOT_FOUND', 'User profile not found');
    }

    return formatUserResponse(user);
  }

  // Always succeeds from the caller's perspective (even for unknown emails) so the endpoint can't
  // be used to enumerate registered accounts.
  static async requestPasswordReset(email: string): Promise<void> {
    const user = await User.findOne({ email });
    if (!user) {
      return;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    user.passwordResetTokenHash = hashToken(rawToken);
    user.passwordResetExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await user.save();

    const resetUrl = `${env.CLIENT_URL}/reset-password?token=${rawToken}`;
    await sendPasswordResetEmail(user.email, resetUrl);
  }

  static async resetPassword(token: string, newPassword: string): Promise<AuthResult> {
    const tokenHash = hashToken(token);
    const user = await User.findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: new Date() },
    }).select('+passwordResetTokenHash +passwordResetExpiresAt');

    if (!user) {
      throw ApiError.badRequest('INVALID_RESET_TOKEN', 'This reset link is invalid or has expired');
    }

    const saltRounds = 12;
    user.passwordHash = await bcrypt.hash(newPassword, saltRounds);
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpiresAt = undefined;
    // Invalidates every session issued before this point, e.g. on a stolen device.
    user.tokenVersion += 1;
    await user.save();

    // Log the user straight back in with a fresh token — it already reflects the bumped
    // tokenVersion, so it isn't invalidated by the line above.
    const newToken = signToken({
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });

    return {
      user: formatUserResponse(user),
      token: newToken,
    };
  }

  static async verifyEmail(token: string): Promise<AuthResponseUser> {
    const tokenHash = hashToken(token);
    const user = await User.findOne({
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: { $gt: new Date() },
    }).select('+emailVerificationTokenHash +emailVerificationExpiresAt');

    if (!user) {
      throw ApiError.badRequest(
        'INVALID_VERIFICATION_TOKEN',
        'This verification link is invalid or has expired'
      );
    }

    user.emailVerified = true;
    user.emailVerificationTokenHash = undefined;
    user.emailVerificationExpiresAt = undefined;
    await user.save();

    return formatUserResponse(user);
  }

  static async resendVerificationEmail(userId: string): Promise<void> {
    const user = await User.findById(userId);
    if (!user) {
      throw ApiError.notFound('USER_NOT_FOUND', 'User profile not found');
    }

    if (user.emailVerified) {
      throw ApiError.conflict('EMAIL_ALREADY_VERIFIED', 'This email is already verified');
    }

    await issueVerificationToken(user);
  }
}
