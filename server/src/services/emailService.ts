import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

export type AuthEmailPurpose = 'verification' | 'password-reset';

let gmailTransporter: Transporter | null = null;

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getTransporter() {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) return null;
  gmailTransporter ??= nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: env.GMAIL_USER,
      pass: env.GMAIL_APP_PASSWORD,
    },
  });
  return gmailTransporter;
}

export async function sendAuthenticationCode(input: {
  to: string;
  name: string;
  code: string;
  purpose: AuthEmailPurpose;
}) {
  // Seeded demo addresses deliberately use a non-routable domain. Keep their
  // authentication flows testable locally even when Gmail SMTP is configured,
  // without ever exposing a code in production.
  if (env.NODE_ENV !== 'production' && input.to.toLowerCase().endsWith('@uvgo.demo')) {
    console.info(`[UVGo development email] ${input.to}: ${input.code} (${input.purpose})`);
    return { developmentCode: input.code };
  }

  const transporter = getTransporter();
  const action = input.purpose === 'verification' ? 'verify your UVGo passenger account' : 'reset your UVGo password';
  const subject = input.purpose === 'verification' ? 'Verify your UVGo email' : 'Reset your UVGo password';

  if (!transporter) {
    if (env.NODE_ENV === 'production') {
      throw new AppError(503, 'EMAIL_DELIVERY_NOT_CONFIGURED', 'Email delivery is temporarily unavailable. Please contact UVGo support.');
    }
    console.info(`[UVGo development email] ${input.to}: ${input.code} (${input.purpose})`);
    return { developmentCode: input.code };
  }

  try {
    await transporter.sendMail({
      from: `"${env.EMAIL_FROM_NAME.replaceAll('"', '')}" <${env.GMAIL_USER}>`,
      to: input.to,
      subject,
      text: `Hello ${input.name},\n\nUse code ${input.code} to ${action}. It expires in ${env.EMAIL_CODE_TTL_MINUTES} minutes.\n\nIf you did not request this, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#173526"><h1 style="font-size:22px">${escapeHtml(subject)}</h1><p>Hello ${escapeHtml(input.name)},</p><p>Use this code to ${escapeHtml(action)}:</p><p style="font-size:32px;font-weight:800;letter-spacing:8px;margin:24px 0">${input.code}</p><p>This code expires in ${env.EMAIL_CODE_TTL_MINUTES} minutes.</p><p style="color:#5d6f65">If you did not request this, you can ignore this email.</p></div>`,
    });
    return {};
  } catch (error) {
    console.error('UVGo authentication email delivery failed:', error instanceof Error ? error.message : error);
    throw new AppError(503, 'EMAIL_DELIVERY_FAILED', 'The verification email could not be sent. Please try again shortly.');
  }
}
