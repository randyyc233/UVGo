import type { Request, Response } from 'express';
import {
  getDriverOverview,
  markArrivedAtTerminal,
  respondToAssignment,
  setGoOnTrip,
  startDriverTrip,
  submitOccupancy,
} from '../services/driverService.js';
import { recordDriverLocation } from '../services/automationService.js';
import { AppError } from '../utils/AppError.js';
import { goOnTripSchema, locationSampleSchema, occupancySchema } from '../validators/driverValidators.js';

function routeParameter(value: unknown) {
  if (typeof value !== 'string') throw new AppError(400, 'INVALID_ROUTE_PARAMETER', 'The requested assignment identifier is invalid.');
  return value;
}

export async function overview(request: Request, response: Response) {
  response.status(200).json({ overview: await getDriverOverview(request.auth!.userId) });
}

export async function updateGoOnTrip(request: Request, response: Response) {
  const { enabled } = goOnTripSchema.parse(request.body);
  response.status(200).json({ overview: await setGoOnTrip(request.auth!.userId, enabled) });
}

export async function acceptAssignment(request: Request, response: Response) {
  response.status(200).json({ overview: await respondToAssignment(request.auth!.userId, routeParameter(request.params.assignmentId), true) });
}

export async function rejectAssignment(request: Request, response: Response) {
  response.status(200).json(await respondToAssignment(request.auth!.userId, routeParameter(request.params.assignmentId), false));
}

export async function updateOccupancy(request: Request, response: Response) {
  const { count } = occupancySchema.parse(request.body);
  response.status(200).json({ overview: await submitOccupancy(request.auth!.userId, count) });
}

export async function updateLocation(request: Request, response: Response) {
  const input = locationSampleSchema.parse(request.body);
  const observedAt = input.observedAt ? new Date(input.observedAt) : new Date();
  if (observedAt.getTime() > Date.now() + 5 * 60_000) throw new AppError(422, 'INVALID_LOCATION_TIME', 'Location time cannot be more than five minutes in the future.');
  response.status(200).json({ geofence: await recordDriverLocation(request.auth!.userId, input.latitude, input.longitude, observedAt) });
}

export async function arriveAtTerminal(request: Request, response: Response) {
  response.status(200).json({ overview: await markArrivedAtTerminal(request.auth!.userId) });
}

export async function startTrip(request: Request, response: Response) {
  response.status(200).json({ overview: await startDriverTrip(request.auth!.userId) });
}
