import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  forgotPassword,
  googleLogin,
  login,
  logout,
  me,
  resendEmailVerification,
  resetPassword,
  signupPassenger,
  verifyEmail,
} from '../controllers/authController.js';
import { requireAuthentication } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    error: {
      code: 'TOO_MANY_LOGIN_ATTEMPTS',
      message: 'Too many login attempts. Please try again in 15 minutes.',
    },
  },
});

const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    error: {
      code: 'TOO_MANY_SIGNUP_ATTEMPTS',
      message: 'Too many signup attempts. Please try again in 15 minutes.',
    },
  },
});

function emailCodeLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: {
        code: 'TOO_MANY_EMAIL_CODE_ATTEMPTS',
        message: 'Too many email-code attempts. Please try again in 15 minutes.',
      },
    },
  });
}

authRouter.post('/login', loginLimiter, asyncHandler(login));
authRouter.post('/google', loginLimiter, asyncHandler(googleLogin));
authRouter.post('/register', signupLimiter, asyncHandler(signupPassenger));
authRouter.post('/verification/resend', emailCodeLimiter(), asyncHandler(resendEmailVerification));
authRouter.post('/verification/confirm', emailCodeLimiter(), asyncHandler(verifyEmail));
authRouter.post('/password/forgot', emailCodeLimiter(), asyncHandler(forgotPassword));
authRouter.post('/password/reset', emailCodeLimiter(), asyncHandler(resetPassword));
authRouter.post('/logout', asyncHandler(logout));
authRouter.get('/me', requireAuthentication, asyncHandler(me));

