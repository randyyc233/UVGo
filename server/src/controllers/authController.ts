import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env.js';
import { SESSION_COOKIE } from '../middleware/authMiddleware.js';
import {
  authenticateUser,
  authenticateGooglePassenger,
  registerPassenger,
  requestEmailVerification,
  requestPasswordReset,
  resetPasswordWithCode,
  toAuthenticatedUser,
  verifyPassengerEmail,
} from '../services/authService.js';
import { AppError } from '../utils/AppError.js';
import {
  forgotPasswordSchema,
  googleLoginSchema,
  loginSchema,
  passengerSignupSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '../validators/authValidators.js';
import { prisma } from '../lib/prisma.js';

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 8 * 60 * 60 * 1000,
};

export async function login(request: Request, response: Response) {
  const input = loginSchema.parse(request.body);
  const result = await authenticateUser(input.email, input.password);

  response.cookie(SESSION_COOKIE, result.token, cookieOptions);
  response.status(200).json({ user: result.user });
}

export async function googleLogin(request: Request, response: Response) {
  const input = googleLoginSchema.parse(request.body);
  const result = await authenticateGooglePassenger(input.credential);

  response.cookie(SESSION_COOKIE, result.token, cookieOptions);
  response.status(200).json({ user: result.user });
}

export async function signupPassenger(request: Request, response: Response) {
  const input = passengerSignupSchema.parse(request.body);
  const result = await registerPassenger(input);
  response.status(201).json(result);
}

export async function resendEmailVerification(request: Request, response: Response) {
  const input = resendVerificationSchema.parse(request.body);
  const delivery = await requestEmailVerification(input.email);
  response.status(200).json({
    message: 'If this email has an unverified passenger account, a new verification code has been sent.',
    ...delivery,
  });
}

export async function verifyEmail(request: Request, response: Response) {
  const input = verifyEmailSchema.parse(request.body);
  const result = await verifyPassengerEmail(input.email, input.code);
  response.cookie(SESSION_COOKIE, result.token, cookieOptions);
  response.status(200).json({ user: result.user });
}

export async function forgotPassword(request: Request, response: Response) {
  const input = forgotPasswordSchema.parse(request.body);
  const delivery = await requestPasswordReset(input.email);
  response.status(200).json({
    message: 'If an active UVGo account uses this email, a password reset code has been sent.',
    ...delivery,
  });
}

export async function resetPassword(request: Request, response: Response) {
  const input = resetPasswordSchema.parse(request.body);
  await resetPasswordWithCode(input.email, input.code, input.newPassword);
  response.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined });
  response.status(200).json({ message: 'Password reset successfully. Sign in with your new password.' });
}

export async function logout(_request: Request, response: Response) {
  response.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined });
  response.status(200).json({ message: 'Signed out successfully.' });
}

export async function me(request: Request, response: Response) {
  if (!request.auth) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in to continue.');

  const user = await prisma.user.findUnique({ where: { id: request.auth.userId } });
  if (!user) throw new AppError(401, 'INVALID_SESSION', 'Your session is invalid or has expired.');

  response.status(200).json({ user: toAuthenticatedUser(user) });
}

