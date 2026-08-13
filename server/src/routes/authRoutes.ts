import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { login, logout, me } from '../controllers/authController.js';
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

authRouter.post('/login', loginLimiter, asyncHandler(login));
authRouter.post('/logout', asyncHandler(logout));
authRouter.get('/me', requireAuthentication, asyncHandler(me));

