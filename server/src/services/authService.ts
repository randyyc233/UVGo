import { AuthChallengePurpose, Prisma, UserRole, type RouteCode, type User } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';
import { sendAuthenticationCode } from './emailService.js';

export type ClientRole = 'dispatcher' | 'driver' | 'passenger';

export interface AuthenticatedUser {
  id: string;
  role: ClientRole;
  name: string;
  contact: string | null;
  email: string;
  emailVerified: boolean;
  dispatcherRoute: 'goa' | 'legazpi' | null;
  redirectTo: string;
}

interface SessionTokenPayload {
  sub: string;
  role: UserRole;
  version: number;
}

const roleNames: Record<UserRole, ClientRole> = {
  DISPATCHER: 'dispatcher',
  DRIVER: 'driver',
  PASSENGER: 'passenger',
};

const redirects: Record<ClientRole, string> = {
  dispatcher: '/dispatcher/dashboard',
  driver: '/driver/dashboard',
  passenger: '/passenger/home',
};

export function toAuthenticatedUser(user: Pick<User, 'id' | 'role' | 'name' | 'contact' | 'email' | 'emailVerifiedAt' | 'dispatcherRoute'>): AuthenticatedUser {
  const role = roleNames[user.role];
  return {
    id: user.id,
    role,
    name: user.name,
    contact: user.contact,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    dispatcherRoute: user.dispatcherRoute?.toLowerCase() as Lowercase<RouteCode> | null,
    redirectTo: redirects[role],
  };
}

const AUTH_CODE_ATTEMPT_LIMIT = 5;
const AUTH_CODE_RESEND_COOLDOWN_MS = 60_000;
const googleOAuthClient = new OAuth2Client();

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function authCodeHash(userId: string, purpose: AuthChallengePurpose, code: string) {
  return createHmac('sha256', env.JWT_SECRET).update(`${userId}:${purpose}:${code}`).digest('hex');
}

function codeMatches(actualHash: string, expectedHash: string) {
  const actual = Buffer.from(actualHash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function hasRecentChallenge(userId: string, purpose: AuthChallengePurpose) {
  return Boolean(await prisma.authChallenge.findFirst({
    where: {
      userId,
      purpose,
      createdAt: { gt: new Date(Date.now() - AUTH_CODE_RESEND_COOLDOWN_MS) },
      consumedAt: null,
    },
    select: { id: true },
  }));
}

async function issueChallenge(user: Pick<User, 'id' | 'name' | 'email'>, purpose: AuthChallengePurpose) {
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.EMAIL_CODE_TTL_MINUTES * 60_000);
  const challenge = await prisma.$transaction(async (transaction) => {
    await transaction.authChallenge.updateMany({
      where: { userId: user.id, purpose, consumedAt: null },
      data: { consumedAt: now },
    });
    return transaction.authChallenge.create({
      data: {
        userId: user.id,
        purpose,
        codeHash: authCodeHash(user.id, purpose, code),
        expiresAt,
      },
    });
  });

  try {
    return await sendAuthenticationCode({
      to: user.email,
      name: user.name,
      code,
      purpose: purpose === AuthChallengePurpose.EMAIL_VERIFICATION ? 'verification' : 'password-reset',
    });
  } catch (error) {
    await prisma.authChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
    throw error;
  }
}

async function consumeChallenge(
  transaction: Prisma.TransactionClient,
  userId: string,
  purpose: AuthChallengePurpose,
  code: string,
) {
  const now = new Date();
  const challenge = await transaction.authChallenge.findFirst({
    where: {
      userId,
      purpose,
      consumedAt: null,
      expiresAt: { gt: now },
      attempts: { lt: AUTH_CODE_ATTEMPT_LIMIT },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!challenge) return false;

  if (!codeMatches(challenge.codeHash, authCodeHash(userId, purpose, code))) {
    const nextAttempts = challenge.attempts + 1;
    await transaction.authChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: {
        attempts: { increment: 1 },
        ...(nextAttempts >= AUTH_CODE_ATTEMPT_LIMIT ? { consumedAt: now } : {}),
      },
    });
    return false;
  }

  const consumed = await transaction.authChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null },
    data: { consumedAt: now },
  });
  return consumed.count === 1;
}

function createSession(user: Pick<User, 'id' | 'role' | 'name' | 'contact' | 'email' | 'emailVerifiedAt' | 'dispatcherRoute' | 'tokenVersion'>) {
  const payload: SessionTokenPayload = {
    sub: user.id,
    role: user.role,
    version: user.tokenVersion,
  };
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    issuer: 'uvgo-api',
    audience: 'uvgo-client',
  };
  const token = jwt.sign(payload, env.JWT_SECRET, options);

  return { token, user: toAuthenticatedUser(user) };
}

export async function authenticateUser(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });

  if (!user || !user.isActive || !(await compare(password, user.passwordHash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
  }

  return createSession(user);
}

function assertGooglePassenger(user: User) {
  if (!user.isActive) {
    throw new AppError(403, 'ACCOUNT_DISABLED', 'This UVGo account is disabled. Contact the terminal for assistance.');
  }
  if (user.role !== UserRole.PASSENGER) {
    throw new AppError(403, 'GOOGLE_PASSENGER_ONLY', 'Continue with Google is available for passenger accounts only. Staff must sign in with their UVGo password.');
  }
  return user;
}

export async function authenticateGooglePassenger(credential: string) {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new AppError(503, 'GOOGLE_AUTH_NOT_CONFIGURED', 'Continue with Google is not configured yet. Use your email and password to sign in.');
  }

  let payload;
  try {
    const ticket = await googleOAuthClient.verifyIdToken({
      idToken: credential,
      audience: env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    throw new AppError(401, 'INVALID_GOOGLE_CREDENTIAL', 'Google could not verify this sign-in. Please try again.');
  }

  const subject = payload?.sub;
  const email = payload?.email?.trim().toLowerCase();
  if (!subject || !email || payload?.email_verified !== true || subject.length > 191 || email.length > 191) {
    throw new AppError(401, 'INVALID_GOOGLE_CREDENTIAL', 'Google did not provide a verified account identity.');
  }

  return authenticateVerifiedGooglePassenger({ subject, email, name: payload.name, hostedDomain: payload.hd });
}

interface VerifiedGoogleIdentity {
  subject: string;
  email: string;
  name?: string;
  hostedDomain?: string;
}

function googleIsAuthoritativeForEmail(identity: VerifiedGoogleIdentity) {
  if (identity.email.endsWith('@gmail.com')) return true;
  const hostedDomain = identity.hostedDomain?.trim().toLowerCase();
  return Boolean(hostedDomain && identity.email.endsWith(`@${hostedDomain}`));
}

export async function authenticateVerifiedGooglePassenger(identity: VerifiedGoogleIdentity) {
  const { subject, email } = identity;
  const subjectUser = await prisma.user.findUnique({ where: { googleSubject: subject } });
  if (subjectUser) return createSession(assertGooglePassenger(subjectUser));

  const emailUser = await prisma.user.findUnique({ where: { email } });
  if (emailUser) {
    assertGooglePassenger(emailUser);
    if (emailUser.googleSubject && emailUser.googleSubject !== subject) {
      throw new AppError(409, 'GOOGLE_ACCOUNT_CONFLICT', 'This passenger email is already linked to another Google account.');
    }
    if (!googleIsAuthoritativeForEmail(identity)) {
      throw new AppError(
        409,
        'GOOGLE_ACCOUNT_LINK_REQUIRED',
        'Sign in with your UVGo password first before linking this third-party email to Google.',
      );
    }

    const linkedUser = await prisma.user.update({
      where: { id: emailUser.id },
      data: {
        googleSubject: subject,
        emailVerifiedAt: emailUser.emailVerifiedAt ?? new Date(),
      },
    });
    return createSession(linkedUser);
  }

  const fallbackName = email.split('@')[0] || 'UVGo Passenger';
  const name = (identity.name?.trim() || fallbackName).slice(0, 120);
  // Password login remains unavailable until this passenger explicitly uses
  // UVGo's password-reset flow. A random hash prevents a usable shared default.
  const passwordHash = await hash(randomBytes(32).toString('base64url'), 12);

  try {
    const user = await prisma.user.create({
      data: {
        role: UserRole.PASSENGER,
        name,
        email,
        googleSubject: subject,
        passwordHash,
        emailVerifiedAt: new Date(),
        isActive: true,
      },
    });
    return createSession(user);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'GOOGLE_ACCOUNT_CONFLICT', 'This Google account or email is already linked to another UVGo account. Please try again.');
    }
    throw error;
  }
}

export async function registerPassenger(input: { name: string; email: string; contact: string; password: string }) {
  let createdUserId: string | null = null;
  try {
    const passwordHash = await hash(input.password, 12);
    const user = await prisma.user.create({
      data: {
        role: UserRole.PASSENGER,
        name: input.name,
        email: input.email,
        contact: input.contact,
        passwordHash,
        isActive: true,
      },
    });
    createdUserId = user.id;
    const delivery = await issueChallenge(user, AuthChallengePurpose.EMAIL_VERIFICATION);

    return {
      email: user.email,
      requiresEmailVerification: true as const,
      ...delivery,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'EMAIL_ALREADY_IN_USE', 'An account already uses this email address.');
    }
    if (createdUserId) await prisma.user.delete({ where: { id: createdUserId } }).catch(() => undefined);
    throw error;
  }
}

export async function requestEmailVerification(email: string) {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user || !user.isActive || user.role !== UserRole.PASSENGER || user.emailVerifiedAt) return {};
  if (await hasRecentChallenge(user.id, AuthChallengePurpose.EMAIL_VERIFICATION)) return {};
  return issueChallenge(user, AuthChallengePurpose.EMAIL_VERIFICATION);
}

export async function verifyPassengerEmail(email: string, code: string) {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user || !user.isActive || user.role !== UserRole.PASSENGER) {
    throw new AppError(422, 'INVALID_OR_EXPIRED_CODE', 'The verification code is invalid or has expired.');
  }
  // Verification is an authentication ceremony only while the account is
  // unverified. Never mint a session for an already-verified email from this
  // public endpoint, because that would bypass the account password.
  if (user.emailVerifiedAt) {
    throw new AppError(422, 'INVALID_OR_EXPIRED_CODE', 'The verification code is invalid or has expired.');
  }

  const verifiedUser = await prisma.$transaction(async (transaction) => {
    const valid = await consumeChallenge(transaction, user.id, AuthChallengePurpose.EMAIL_VERIFICATION, code);
    if (!valid) return null;
    await transaction.authChallenge.updateMany({
      where: { userId: user.id, purpose: AuthChallengePurpose.EMAIL_VERIFICATION, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return transaction.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });
  });
  if (!verifiedUser) {
    throw new AppError(422, 'INVALID_OR_EXPIRED_CODE', 'The verification code is invalid or has expired.');
  }
  return createSession(verifiedUser);
}

export async function requestPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user || !user.isActive) return {};
  if (await hasRecentChallenge(user.id, AuthChallengePurpose.PASSWORD_RESET)) return {};
  try {
    return await issueChallenge(user, AuthChallengePurpose.PASSWORD_RESET);
  } catch {
    // The public response must be identical for known and unknown addresses,
    // including while the mail provider is unavailable. Delivery failures are
    // already logged by the mail service for operators.
    return {};
  }
}

export async function resetPasswordWithCode(email: string, code: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user || !user.isActive) {
    throw new AppError(422, 'INVALID_OR_EXPIRED_CODE', 'The reset code is invalid or has expired.');
  }
  const passwordHash = await hash(newPassword, 12);
  const reset = await prisma.$transaction(async (transaction) => {
    const valid = await consumeChallenge(transaction, user.id, AuthChallengePurpose.PASSWORD_RESET, code);
    if (!valid) return false;
    await transaction.authChallenge.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await transaction.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      },
    });
    return true;
  });
  if (!reset) throw new AppError(422, 'INVALID_OR_EXPIRED_CODE', 'The reset code is invalid or has expired.');
}

export async function resolveSession(token: string) {
  let payload: jwt.JwtPayload;

  try {
    const verified = jwt.verify(token, env.JWT_SECRET, {
      issuer: 'uvgo-api',
      audience: 'uvgo-client',
    });

    if (typeof verified === 'string') throw new Error('Unexpected token payload.');
    payload = verified;
  } catch {
    throw new AppError(401, 'INVALID_SESSION', 'Your session is invalid or has expired.');
  }

  if (typeof payload.sub !== 'string' || typeof payload.version !== 'number') {
    throw new AppError(401, 'INVALID_SESSION', 'Your session is invalid or has expired.');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });

  if (!user || !user.isActive || user.tokenVersion !== payload.version) {
    throw new AppError(401, 'INVALID_SESSION', 'Your session is invalid or has expired.');
  }

  return user;
}

