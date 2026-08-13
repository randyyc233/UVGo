import type { Request, Response } from 'express';
import {
  applyQueueAction,
  decideGcashPayment,
  getDispatchLogs,
  getDispatcherDashboard,
  getDispatcherPayments,
  getDispatcherQueue,
  getFleetSnapshot,
  getPaymentReceiptPath,
} from '../services/dispatcherService.js';
import { AppError } from '../utils/AppError.js';
import { paymentDecisionSchema, queueActionSchema } from '../validators/dispatcherValidators.js';
import { getDemoState, simulateDispatchEngine, simulateGeofenceEntry } from '../services/demoService.js';

function routeParameter(value: unknown) {
  if (typeof value !== 'string') throw new AppError(400, 'INVALID_ROUTE_PARAMETER', 'The requested resource identifier is invalid.');
  return value;
}

export async function dashboard(_request: Request, response: Response) {
  response.status(200).json({ dashboard: await getDispatcherDashboard() });
}

export async function fleet(_request: Request, response: Response) {
  response.status(200).json({ fleet: await getFleetSnapshot() });
}

export async function queue(request: Request, response: Response) {
  const route = typeof request.query.route === 'string' ? request.query.route : undefined;
  response.status(200).json({ queue: await getDispatcherQueue(route) });
}

export async function queueAction(request: Request, response: Response) {
  const input = queueActionSchema.parse(request.body);
  response.status(200).json({ queue: await applyQueueAction(request.auth!.userId, routeParameter(request.params.queueEntryId), input) });
}

export async function payments(_request: Request, response: Response) {
  response.status(200).json({ payments: await getDispatcherPayments() });
}

export async function paymentDecision(request: Request, response: Response) {
  const input = paymentDecisionSchema.parse(request.body);
  response.status(200).json({ payments: await decideGcashPayment(request.auth!.userId, routeParameter(request.params.paymentId), input.decision, input.reason) });
}

export async function receipt(request: Request, response: Response) {
  response.sendFile(await getPaymentReceiptPath(routeParameter(request.params.paymentId)));
}

export async function logs(_request: Request, response: Response) {
  response.status(200).json(await getDispatchLogs());
}

export async function demoState(_request: Request, response: Response) {
  response.status(200).json({ demo: await getDemoState() });
}

export async function demoGeofenceEntry(request: Request, response: Response) {
  response.status(200).json({ simulation: await simulateGeofenceEntry(request.auth!.userId) });
}

export async function demoDispatchEngine(request: Request, response: Response) {
  response.status(200).json({ simulation: await simulateDispatchEngine(request.auth!.userId) });
}
