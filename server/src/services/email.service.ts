import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env.js';

const isEmailConfigured = (): boolean => Boolean(env.EMAIL_HOST && env.EMAIL_USER && env.EMAIL_PASS);

let transporter: Transporter | null = null;
const getTransporter = (): Transporter => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.EMAIL_HOST,
      port: env.EMAIL_PORT,
      secure: env.EMAIL_PORT === 465,
      auth: { user: env.EMAIL_USER, pass: env.EMAIL_PASS },
    });
  }
  return transporter;
};

/**
 * Sends the password-reset link, or — with no SMTP credentials configured — logs it to the
 * console instead. Matches Judge0/Razorpay/LeetCode's pattern of degrading gracefully rather than
 * refusing to boot, so the reset flow stays fully testable without an email account.
 */
export const sendPasswordResetEmail = async (to: string, resetUrl: string): Promise<void> => {
  if (!isEmailConfigured()) {
    console.log(`[Email] EMAIL_HOST not configured — password reset link for ${to}:`);
    console.log(`[Email] ${resetUrl}`);
    return;
  }

  await getTransporter().sendMail({
    from: env.EMAIL_FROM,
    to,
    subject: 'Reset your CommitDSA password',
    text: `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
    html: `<p>Reset your password by clicking the link below:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>`,
  });
};

/** Same dev/no-SMTP fallback as sendPasswordResetEmail — logs the link instead of emailing it. */
export const sendVerificationEmail = async (to: string, verifyUrl: string): Promise<void> => {
  if (!isEmailConfigured()) {
    console.log(`[Email] EMAIL_HOST not configured — verification link for ${to}:`);
    console.log(`[Email] ${verifyUrl}`);
    return;
  }

  await getTransporter().sendMail({
    from: env.EMAIL_FROM,
    to,
    subject: 'Verify your CommitDSA email',
    text: `Verify your email: ${verifyUrl}\n\nThis link expires in 24 hours.`,
    html: `<p>Verify your email by clicking the link below:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours.</p>`,
  });
};
