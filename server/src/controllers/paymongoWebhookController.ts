import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError.js';
import { parsePaymongoWebhook } from '../services/paymongoService.js';
import { processPaymongoWebhookEvent } from '../services/passengerService.js';

export async function receivePaymongoWebhook(request: Request, response: Response) {
  if (!Buffer.isBuffer(request.body)) {
    throw new AppError(400, 'RAW_WEBHOOK_BODY_REQUIRED', 'The PayMongo webhook body must be raw JSON.');
  }
  const signature = request.get('Paymongo-Signature');
  const event = parsePaymongoWebhook(request.body, signature);
  await processPaymongoWebhookEvent(event);
  response.status(200).json({ received: true });
}
