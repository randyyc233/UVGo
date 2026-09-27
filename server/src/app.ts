import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorMiddleware.js';
import { authRouter } from './routes/authRoutes.js';
import { dispatcherRouter, driverRouter, passengerRouter } from './routes/roleRoutes.js';
import { publicRouter } from './routes/publicRoutes.js';
import { receivePaymongoWebhook } from './controllers/paymongoWebhookController.js';
import { asyncHandler } from './utils/asyncHandler.js';

export const app = express();

const allowedOrigins = new Set([env.CLIENT_ORIGIN]);
if (env.NODE_ENV === 'development') {
  allowedOrigins.add('http://localhost:5173');
  allowedOrigins.add('http://127.0.0.1:5173');
}

app.disable('x-powered-by');
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
  }),
);
// PayMongo signs the exact request bytes. This route must stay before the
// global JSON parser or legitimate signatures will no longer verify.
app.post('/api/webhooks/paymongo', express.raw({ type: 'application/json', limit: '256kb' }), asyncHandler(receivePaymongoWebhook));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', (_request, response) => {
  response.status(200).json({
    service: 'uvgo-api',
    status: 'ok',
    phase: 10,
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', authRouter);
app.use('/api/public', publicRouter);
app.use('/api/passenger', passengerRouter);
app.use('/api/driver', driverRouter);
app.use('/api/dispatcher', dispatcherRouter);

app.use(notFoundHandler);
app.use(errorHandler);
