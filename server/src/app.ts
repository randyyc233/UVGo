import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorMiddleware.js';
import { authRouter } from './routes/authRoutes.js';
import { dispatcherRouter, driverRouter, passengerRouter } from './routes/roleRoutes.js';
import { publicRouter } from './routes/publicRoutes.js';

export const app = express();

const clientDistDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist');
const clientIndexFile = resolve(clientDistDirectory, 'index.html');
const allowedOrigins = new Set([env.CLIENT_ORIGIN]);
if (env.NODE_ENV === 'development') {
  allowedOrigins.add('http://localhost:5173');
  allowedOrigins.add('http://127.0.0.1:5173');
}

app.disable('x-powered-by');
app.use((_request, response, next) => {
  response.locals.cspNonce = randomBytes(24).toString('base64');
  next();
});
app.use(
  helmet({
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", 'https://accounts.google.com/gsi/', 'https://api.mapbox.com', 'https://events.mapbox.com', 'https://*.tiles.mapbox.com', 'https://www.paypal.com', 'https://www.sandbox.paypal.com'],
        fontSrc: ["'self'", 'data:'],
        frameSrc: ["'self'", 'https://accounts.google.com/gsi/', 'https://www.paypal.com', 'https://www.sandbox.paypal.com'],
        formAction: ["'self'", 'https://www.paypal.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://api.mapbox.com', 'https://*.tiles.mapbox.com', 'https://www.paypal.com', 'https://www.sandbox.paypal.com', 'https://www.paypalobjects.com'],
        scriptSrc: ["'self'", (_request, response) => `'nonce-${(response as express.Response).locals.cspNonce}'`, 'https://accounts.google.com/gsi/client', 'https://www.paypal.com', 'https://www.sandbox.paypal.com', 'https://www.paypalobjects.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        workerSrc: ["'self'", 'blob:'],
      },
    },
  }),
);
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
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', (_request, response) => {
  response.status(200).json({
    service: 'uvgo-api',
    status: 'ok',
    phase: 10,
    googleAuthConfigured: Boolean(env.GOOGLE_CLIENT_ID),
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', authRouter);
app.use('/api/public', publicRouter);
app.use('/api/passenger', passengerRouter);
app.use('/api/driver', driverRouter);
app.use('/api/dispatcher', dispatcherRouter);

if (env.NODE_ENV === 'production') {
  if (!existsSync(clientIndexFile)) {
    throw new Error(`Production client build was not found at ${clientIndexFile}. Run the client build before starting the server.`);
  }

  app.use(express.static(clientDistDirectory, { index: false }));
  const clientHtml = readFileSync(clientIndexFile, 'utf8');
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path === '/api' || request.path.startsWith('/api/')) {
      next();
      return;
    }

    response.setHeader('Cache-Control', 'no-store');
    response.type('html').send(clientHtml.replace('</head>', `<meta name="csp-nonce" content="${response.locals.cspNonce}" /></head>`));
  });
}

app.use(notFoundHandler);
app.use(errorHandler);
