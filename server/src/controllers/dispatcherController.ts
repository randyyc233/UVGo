import type { Request, Response } from 'express';
import type { RouteCode } from '@prisma/client';
import {
  applyQueueAction,
  changeDispatcherPassword,
  confirmDispatcherDeparture,
  decideGcashPayment,
  deleteAllDispatchLogs,
  deleteDispatchLog,
  dismissAllDispatcherAlerts,
  dismissDispatcherAlert,
  getDispatchLogs,
  getDispatcherDashboard,
  getDispatcherPayments,
  getDispatcherQueue,
  getFleetSnapshot,
  getPaymentReceiptPath,
  markDispatcherAlertRead,
  sendDriverAnnouncement,
  updateDispatcherProfile,
} from '../services/dispatcherService.js';
import { AppError } from '../utils/AppError.js';
import { createBackupDispatcherSchema, departureConfirmationSchema, dispatcherPasswordSchema, dispatcherProfileSchema, driverAnnouncementSchema, paymentDecisionSchema, queueActionSchema, tayaWeeklyScheduleSchema, weeklyScheduleSchema } from '../validators/dispatcherValidators.js';
import {
  createManagedDriverSchema,
  managedScheduleSchema,
  resetManagedDriverPasswordSchema,
  updateManagedDriverSchema,
} from '../validators/dispatcherValidators.js';
import { getDemoState, simulateDispatchEngine, simulateGeofenceEntry } from '../services/demoService.js';
import {
  createManagedDriver,
  createManagedSchedule,
  deleteManagedDriver,
  deleteManagedSchedule,
  getManagedDrivers,
  getManagedSchedules,
  resetManagedDriverPassword,
  updateManagedDriver,
  updateManagedSchedule,
} from '../services/dispatcherManagementService.js';
import { createWeeklySchedule, deleteWeeklySchedule, updateWeeklySchedule } from '../services/weeklyScheduleService.js';
import { cancelAssignmentByDispatcher } from '../services/driverService.js';
import { SESSION_COOKIE } from '../middleware/authMiddleware.js';
import { createBackupDispatcher, getRouteDispatchers } from '../services/dispatcherAccountService.js';
import { getTayaWeeklySchedule, saveTayaWeeklySchedule } from '../services/tayaQueueService.js';

function routeParameter(value: unknown) {
  if (typeof value !== 'string') throw new AppError(400, 'INVALID_ROUTE_PARAMETER', 'The requested resource identifier is invalid.');
  return value;
}

function dispatcherRoute(request: Request): RouteCode {
  if (!request.auth?.dispatcherRoute) throw new AppError(403, 'DISPATCHER_ROUTE_REQUIRED', 'This dispatcher account is not assigned to an operational route.');
  return request.auth.dispatcherRoute;
}

export async function dashboard(request: Request, response: Response) {
  response.status(200).json({ dashboard: await getDispatcherDashboard(dispatcherRoute(request), request.auth!.userId) });
}

export async function updateProfile(request: Request, response: Response) {
  const input = dispatcherProfileSchema.parse(request.body);
  const user = await updateDispatcherProfile(request.auth!.userId, input);
  response.status(200).json({ user });
}

export async function changePassword(request: Request, response: Response) {
  const input = dispatcherPasswordSchema.parse(request.body);
  await changeDispatcherPassword(request.auth!.userId, input.currentPassword, input.newPassword);
  response.clearCookie(SESSION_COOKIE, { path: '/' });
  response.status(200).json({ message: 'Password changed successfully. Sign in again with your new password.' });
}

export async function markAlertRead(request: Request, response: Response) {
  const updated = await markDispatcherAlertRead(
    request.auth!.userId,
    dispatcherRoute(request),
    routeParameter(request.params.alertId),
  );
  response.status(200).json({ dashboard: updated });
}

export async function deleteAlert(request: Request, response: Response) {
  const updated = await dismissDispatcherAlert(
    request.auth!.userId,
    dispatcherRoute(request),
    routeParameter(request.params.alertId),
  );
  response.status(200).json({ dashboard: updated });
}

export async function deleteAllAlerts(request: Request, response: Response) {
  const updated = await dismissAllDispatcherAlerts(
    request.auth!.userId,
    dispatcherRoute(request),
  );
  response.status(200).json({ dashboard: updated });
}

export async function fleet(request: Request, response: Response) {
  response.status(200).json({ fleet: await getFleetSnapshot(dispatcherRoute(request)) });
}

export async function queue(request: Request, response: Response) {
  const ownedRoute = dispatcherRoute(request);
  const requestedRoute = typeof request.query.route === 'string' ? request.query.route.toUpperCase() : undefined;
  if (requestedRoute && requestedRoute !== ownedRoute) throw new AppError(403, 'ROUTE_ACCESS_DENIED', 'You cannot access another dispatcher route.');
  response.status(200).json({ queue: await getDispatcherQueue(ownedRoute) });
}

export async function queueAction(request: Request, response: Response) {
  const input = queueActionSchema.parse(request.body);
  response.status(200).json({ queue: await applyQueueAction(request.auth!.userId, dispatcherRoute(request), routeParameter(request.params.queueEntryId), input) });
}

export async function payments(request: Request, response: Response) {
  response.status(200).json({ payments: await getDispatcherPayments(dispatcherRoute(request)) });
}

export async function paymentDecision(request: Request, response: Response) {
  const input = paymentDecisionSchema.parse(request.body);
  response.status(200).json({ payments: await decideGcashPayment(request.auth!.userId, dispatcherRoute(request), routeParameter(request.params.paymentId), input.decision, input.reason) });
}

export async function receipt(request: Request, response: Response) {
  response.sendFile(await getPaymentReceiptPath(routeParameter(request.params.paymentId), dispatcherRoute(request)));
}

export async function logs(request: Request, response: Response) {
  response.status(200).json(await getDispatchLogs(dispatcherRoute(request)));
}

export async function removeLog(request: Request, response: Response) {
  response.status(200).json(await deleteDispatchLog(dispatcherRoute(request), routeParameter(request.params.logId)));
}

export async function removeAllLogs(request: Request, response: Response) {
  response.status(200).json(await deleteAllDispatchLogs(dispatcherRoute(request)));
}

export async function drivers(request: Request, response: Response) {
  response.status(200).json({ management: await getManagedDrivers(request.auth!.userId, dispatcherRoute(request)) });
}

export async function dispatcherAccounts(request: Request, response: Response) {
  response.status(200).json({ management: await getRouteDispatchers(request.auth!.userId, dispatcherRoute(request)) });
}

export async function createDispatcherAccount(request: Request, response: Response) {
  const input = createBackupDispatcherSchema.parse(request.body);
  response.status(201).json({ management: await createBackupDispatcher(request.auth!.userId, dispatcherRoute(request), input) });
}

export async function createDriver(request: Request, response: Response) {
  const input = createManagedDriverSchema.parse(request.body);
  response.status(201).json({ management: await createManagedDriver(request.auth!.userId, dispatcherRoute(request), input) });
}

export async function updateDriver(request: Request, response: Response) {
  const input = updateManagedDriverSchema.parse(request.body);
  response.status(200).json({ management: await updateManagedDriver(request.auth!.userId, dispatcherRoute(request), routeParameter(request.params.driverId), input) });
}

export async function deleteDriver(request: Request, response: Response) {
  response.status(200).json({ management: await deleteManagedDriver(request.auth!.userId, dispatcherRoute(request), routeParameter(request.params.driverId)) });
}

export async function resetDriverPassword(request: Request, response: Response) {
  const input = resetManagedDriverPasswordSchema.parse(request.body);
  response.status(200).json(await resetManagedDriverPassword(request.auth!.userId, dispatcherRoute(request), routeParameter(request.params.driverId), input.password));
}

export async function createDriverAnnouncement(request: Request, response: Response) {
  const input = driverAnnouncementSchema.parse(request.body);
  response.status(201).json({ announcement: await sendDriverAnnouncement(request.auth!.userId, dispatcherRoute(request), input) });
}

export async function confirmDeparture(request: Request, response: Response) {
  const ownedRoute = dispatcherRoute(request);
  const input = departureConfirmationSchema.parse(request.body);
  await confirmDispatcherDeparture(request.auth!.userId, ownedRoute, routeParameter(request.params.tripId), input.reason);
  response.status(200).json({ dashboard: await getDispatcherDashboard(ownedRoute, request.auth!.userId) });
}

export async function schedules(request: Request, response: Response) {
  response.status(200).json({ scheduleManagement: await getManagedSchedules(request.auth!.userId, dispatcherRoute(request)) });
}

export async function tayaWeeklySchedule(request: Request, response: Response) {
  response.status(200).json({ tayaSchedule: await getTayaWeeklySchedule(request.auth!.userId, dispatcherRoute(request)) });
}

export async function updateTayaWeeklySchedule(request: Request, response: Response) {
  const input = tayaWeeklyScheduleSchema.parse(request.body);
  response.status(200).json({ tayaSchedule: await saveTayaWeeklySchedule(request.auth!.userId, dispatcherRoute(request), input) });
}

export async function cancelActiveAssignment(request: Request, response: Response) {
  const route = dispatcherRoute(request);
  await cancelAssignmentByDispatcher(request.auth!.userId, route, routeParameter(request.params.assignmentId));
  response.status(200).json({ scheduleManagement: await getManagedSchedules(request.auth!.userId, route) });
}

export async function createSchedule(request: Request, response: Response) {
  const input = managedScheduleSchema.parse(request.body);
  response.status(201).json({ scheduleManagement: await createManagedSchedule(request.auth!.userId, dispatcherRoute(request), input) });
}

export async function updateSchedule(request: Request, response: Response) {
  const input = managedScheduleSchema.parse(request.body);
  response.status(200).json({ scheduleManagement: await updateManagedSchedule(request.auth!.userId, dispatcherRoute(request), routeParameter(request.params.tripId), input) });
}

export async function removeSchedule(request: Request, response: Response) {
  response.status(200).json({ scheduleManagement: await deleteManagedSchedule(request.auth!.userId, dispatcherRoute(request), routeParameter(request.params.tripId)) });
}

export async function createWeeklyScheduleTemplate(request: Request, response: Response) {
  const input = weeklyScheduleSchema.parse(request.body);
  await createWeeklySchedule(request.auth!.userId, dispatcherRoute(request), input);
  response.status(201).json({ scheduleManagement: await getManagedSchedules(request.auth!.userId, dispatcherRoute(request)) });
}

export async function updateWeeklyScheduleTemplate(request: Request, response: Response) {
  const input = weeklyScheduleSchema.parse(request.body);
  await updateWeeklySchedule(request.auth!.userId, dispatcherRoute(request), routeParameter(request.params.templateId), input);
  response.status(200).json({ scheduleManagement: await getManagedSchedules(request.auth!.userId, dispatcherRoute(request)) });
}

export async function removeWeeklyScheduleTemplate(request: Request, response: Response) {
  await deleteWeeklySchedule(request.auth!.userId, dispatcherRoute(request), routeParameter(request.params.templateId));
  response.status(200).json({ scheduleManagement: await getManagedSchedules(request.auth!.userId, dispatcherRoute(request)) });
}

export async function demoState(request: Request, response: Response) {
  response.status(200).json({ demo: await getDemoState(dispatcherRoute(request)) });
}

export async function demoGeofenceEntry(request: Request, response: Response) {
  response.status(200).json({ simulation: await simulateGeofenceEntry(request.auth!.userId, dispatcherRoute(request)) });
}

export async function demoDispatchEngine(request: Request, response: Response) {
  response.status(200).json({ simulation: await simulateDispatchEngine(request.auth!.userId, dispatcherRoute(request)) });
}
