import type { Request, Response } from 'express';
import {
  changeDriverPassword,
  deleteDriverNotification,
  getDriverNotifications,
  getDriverOverview,
  markAllDriverNotificationsRead,
  markDriverNotificationRead,
  markArrivedAtTerminal,
  setGoOnTrip,
  startDriverTrip,
  submitOccupancy,
  updateDriverProfile,
} from '../services/driverService.js';
import { cancelDriverScheduledAssignment, recordDriverLocation } from '../services/automationService.js';
import { AppError } from '../utils/AppError.js';
import { cancelAssignmentSchema, driverPasswordSchema, driverProfileSchema, goOnTripSchema, locationSampleSchema, occupancySchema } from '../validators/driverValidators.js';
import { SESSION_COOKIE } from '../middleware/authMiddleware.js';

function routeParameter(value: unknown) {
  if (typeof value !== 'string') throw new AppError(400, 'INVALID_ROUTE_PARAMETER', 'The requested assignment identifier is invalid.');
  return value;
}

export async function overview(request: Request, response: Response) {
  // Assignment and queue state changes outside the driver page (for example,
  // dispatcher acceptance) must never be served from a browser/proxy cache.
  response.set('Cache-Control', 'no-store');
  response.status(200).json({ overview: await getDriverOverview(request.auth!.userId) });
}

export async function updateProfile(request: Request, response: Response) {
  const input = driverProfileSchema.parse(request.body);
  const user = await updateDriverProfile(request.auth!.userId, input);
  response.status(200).json({ user });
}

export async function changePassword(request: Request, response: Response) {
  const input = driverPasswordSchema.parse(request.body);
  await changeDriverPassword(request.auth!.userId, input.currentPassword, input.newPassword);
  response.clearCookie(SESSION_COOKIE, { path: '/' });
  response.status(200).json({ message: 'Password changed successfully. Sign in again with your new password.' });
}

export async function updateGoOnTrip(request: Request, response: Response) {
  const { enabled } = goOnTripSchema.parse(request.body);
  response.status(200).json({ overview: await setGoOnTrip(request.auth!.userId, enabled) });
}

export async function deleteNotification(request: Request, response: Response) {
  response.status(200).json({ overview: await deleteDriverNotification(request.auth!.userId, routeParameter(request.params.notificationId)) });
}

export async function notifications(request: Request, response: Response) {
  response.status(200).json({ notifications: await getDriverNotifications(request.auth!.userId) });
}

export async function markNotificationRead(request: Request, response: Response) {
  await markDriverNotificationRead(request.auth!.userId, routeParameter(request.params.notificationId));
  response.status(200).json({ message: 'Notification marked as read.' });
}

export async function markAllNotificationsRead(request: Request, response: Response) {
  const updated = await markAllDriverNotificationsRead(request.auth!.userId);
  response.status(200).json({ message: 'All notifications marked as read.', updated });
}

export async function cancelAssignment(request: Request, response: Response) {
  const { reason } = cancelAssignmentSchema.parse(request.body);
  const cancellation = await cancelDriverScheduledAssignment(request.auth!.userId, routeParameter(request.params.assignmentId), reason);
  response.status(200).json({ overview: await getDriverOverview(request.auth!.userId), cancellation });
}

export async function updateOccupancy(request: Request, response: Response) {
  const { count } = occupancySchema.parse(request.body);
  response.status(200).json({ overview: await submitOccupancy(request.auth!.userId, count) });
}

export async function updateLocation(request: Request, response: Response) {
  const input = locationSampleSchema.parse(request.body);
  // Freshness is based on when the authenticated API receives the report.
  // Browser Sensors can reuse the same device timestamp for stationary test
  // coordinates, causing valid heartbeats to be rejected as out of order.
  const observedAt = new Date();
  response.status(200).json({
    geofence: await recordDriverLocation(
      request.auth!.userId,
      input.latitude,
      input.longitude,
      observedAt,
      input.accuracyMeters,
      input.speedMps ?? null,
      input.headingDegrees ?? null,
    ),
  });
}

export async function arriveAtTerminal(request: Request, response: Response) {
  response.status(200).json({ overview: await markArrivedAtTerminal(request.auth!.userId) });
}

export async function startTrip(request: Request, response: Response) {
  response.status(200).json({ overview: await startDriverTrip(request.auth!.userId) });
}
