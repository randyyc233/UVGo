import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { requireAuthentication, requireDispatcherRoute, requireRole } from '../middleware/authMiddleware.js';
import { receiptUpload } from '../middleware/receiptUpload.js';
import {
  booking,
  bookings,
  createGcash,
  createPaypalHosted,
  changePassword,
  deleteNotification,
  markAllNotificationsRead,
  markNotificationRead,
  notifications,
  reschedule,
  searchTrips,
  tripSeats,
  updateProfile,
} from '../controllers/passengerController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  arriveAtTerminal,
  cancelAssignment,
  changePassword as driverChangePassword,
  deleteNotification as deleteDriverNotification,
  markAllNotificationsRead as markAllDriverNotificationsRead,
  markNotificationRead as markDriverNotificationRead,
  notifications as driverNotifications,
  overview as driverOverview,
  startTrip,
  updateLocation,
  updateProfile as driverUpdateProfile,
  updateGoOnTrip,
  updateOccupancy,
} from '../controllers/driverController.js';
import {
  cancelActiveAssignment as dispatcherCancelActiveAssignment,
  createDriver as dispatcherCreateDriver,
  createDispatcherAccount as dispatcherCreateDispatcherAccount,
  createDriverAnnouncement as dispatcherCreateDriverAnnouncement,
  changePassword as dispatcherChangePassword,
  confirmDeparture as dispatcherConfirmDeparture,
  createSchedule as dispatcherCreateSchedule,
  createWeeklyScheduleTemplate as dispatcherCreateWeeklySchedule,
  dashboard as dispatcherDashboard,
  deleteAllAlerts as dispatcherDeleteAllAlerts,
  deleteAlert as dispatcherDeleteAlert,
  deleteDriver as dispatcherDeleteDriver,
  demoDispatchEngine,
  demoGeofenceEntry,
  demoState,
  fleet as dispatcherFleet,
  logs as dispatcherLogs,
  markAlertRead as dispatcherMarkAlertRead,
  drivers as dispatcherDrivers,
  dispatcherAccounts,
  paymentDecision,
  payments as dispatcherPayments,
  queue as dispatcherQueue,
  queueAction,
  receipt as dispatcherReceipt,
  removeLog as dispatcherRemoveLog,
  removeAllLogs as dispatcherRemoveAllLogs,
  removeSchedule as dispatcherRemoveSchedule,
  removeWeeklyScheduleTemplate as dispatcherRemoveWeeklySchedule,
  resetDriverPassword as dispatcherResetDriverPassword,
  schedules as dispatcherSchedules,
  tayaWeeklySchedule as dispatcherTayaWeeklySchedule,
  updateTayaWeeklySchedule as dispatcherUpdateTayaWeeklySchedule,
  updateDriver as dispatcherUpdateDriver,
  updateProfile as dispatcherUpdateProfile,
  updateSchedule as dispatcherUpdateSchedule,
  updateWeeklyScheduleTemplate as dispatcherUpdateWeeklySchedule,
} from '../controllers/dispatcherController.js';

export const passengerRouter = Router();
export const driverRouter = Router();
export const dispatcherRouter = Router();

passengerRouter.use(requireAuthentication, requireRole(UserRole.PASSENGER));
driverRouter.use(requireAuthentication, requireRole(UserRole.DRIVER));
dispatcherRouter.use(requireAuthentication, requireRole(UserRole.DISPATCHER), requireDispatcherRoute);

passengerRouter.get('/session', (request, response) => {
  response.status(200).json({ role: 'passenger', userId: request.auth?.userId });
});
passengerRouter.get('/trips', asyncHandler(searchTrips));
passengerRouter.get('/trips/:tripId/seats', asyncHandler(tripSeats));
passengerRouter.post('/reservations/paypal/hosted', receiptUpload.single('receipt'), asyncHandler(createPaypalHosted));
passengerRouter.post('/reservations/gcash', receiptUpload.single('receipt'), asyncHandler(createGcash));
passengerRouter.get('/bookings', asyncHandler(bookings));
passengerRouter.get('/bookings/:reference', asyncHandler(booking));
passengerRouter.post('/bookings/:reference/reschedule', asyncHandler(reschedule));
passengerRouter.get('/notifications', asyncHandler(notifications));
passengerRouter.patch('/notifications/read-all', asyncHandler(markAllNotificationsRead));
passengerRouter.patch('/notifications/:notificationId/read', asyncHandler(markNotificationRead));
passengerRouter.delete('/notifications/:notificationId', asyncHandler(deleteNotification));
passengerRouter.patch('/profile', asyncHandler(updateProfile));
passengerRouter.post('/profile/password', asyncHandler(changePassword));

driverRouter.get('/session', (request, response) => {
  response.status(200).json({ role: 'driver', userId: request.auth?.userId });
});
driverRouter.get('/overview', asyncHandler(driverOverview));
driverRouter.patch('/profile', asyncHandler(driverUpdateProfile));
driverRouter.post('/profile/password', asyncHandler(driverChangePassword));
driverRouter.patch('/setup/go-on-trip', asyncHandler(updateGoOnTrip));
driverRouter.get('/notifications', asyncHandler(driverNotifications));
driverRouter.patch('/notifications/read-all', asyncHandler(markAllDriverNotificationsRead));
driverRouter.patch('/notifications/:notificationId/read', asyncHandler(markDriverNotificationRead));
driverRouter.delete('/notifications/:notificationId', asyncHandler(deleteDriverNotification));
driverRouter.post('/assignments/:assignmentId/cancel', asyncHandler(cancelAssignment));
driverRouter.post('/occupancy', asyncHandler(updateOccupancy));
driverRouter.post('/location', asyncHandler(updateLocation));
driverRouter.post('/trip/arrive', asyncHandler(arriveAtTerminal));
driverRouter.post('/trip/start', asyncHandler(startTrip));

dispatcherRouter.get('/session', (request, response) => {
  response.status(200).json({ role: 'dispatcher', route: request.auth?.dispatcherRoute?.toLowerCase(), userId: request.auth?.userId });
});
dispatcherRouter.patch('/profile', asyncHandler(dispatcherUpdateProfile));
dispatcherRouter.post('/profile/password', asyncHandler(dispatcherChangePassword));
dispatcherRouter.get('/dashboard', asyncHandler(dispatcherDashboard));
dispatcherRouter.delete('/alerts', asyncHandler(dispatcherDeleteAllAlerts));
dispatcherRouter.patch('/alerts/:alertId/read', asyncHandler(dispatcherMarkAlertRead));
dispatcherRouter.delete('/alerts/:alertId', asyncHandler(dispatcherDeleteAlert));
dispatcherRouter.get('/fleet', asyncHandler(dispatcherFleet));
dispatcherRouter.get('/queue', asyncHandler(dispatcherQueue));
dispatcherRouter.post('/queue/:queueEntryId/actions', asyncHandler(queueAction));
dispatcherRouter.get('/payments', asyncHandler(dispatcherPayments));
dispatcherRouter.post('/payments/:paymentId/decision', asyncHandler(paymentDecision));
dispatcherRouter.get('/payments/:paymentId/receipt', asyncHandler(dispatcherReceipt));
dispatcherRouter.get('/logs', asyncHandler(dispatcherLogs));
dispatcherRouter.delete('/logs', asyncHandler(dispatcherRemoveAllLogs));
dispatcherRouter.delete('/logs/:logId', asyncHandler(dispatcherRemoveLog));
dispatcherRouter.get('/drivers', asyncHandler(dispatcherDrivers));
dispatcherRouter.post('/drivers', asyncHandler(dispatcherCreateDriver));
dispatcherRouter.patch('/drivers/:driverId', asyncHandler(dispatcherUpdateDriver));
dispatcherRouter.delete('/drivers/:driverId', asyncHandler(dispatcherDeleteDriver));
dispatcherRouter.post('/drivers/:driverId/reset-password', asyncHandler(dispatcherResetDriverPassword));
dispatcherRouter.get('/accounts', asyncHandler(dispatcherAccounts));
dispatcherRouter.post('/accounts', asyncHandler(dispatcherCreateDispatcherAccount));
dispatcherRouter.post('/announcements', asyncHandler(dispatcherCreateDriverAnnouncement));
dispatcherRouter.post('/departures/:tripId/confirm', asyncHandler(dispatcherConfirmDeparture));
dispatcherRouter.get('/schedules', asyncHandler(dispatcherSchedules));
dispatcherRouter.get('/taya-schedules', asyncHandler(dispatcherTayaWeeklySchedule));
dispatcherRouter.put('/taya-schedules', asyncHandler(dispatcherUpdateTayaWeeklySchedule));
dispatcherRouter.post('/assignments/:assignmentId/cancel', asyncHandler(dispatcherCancelActiveAssignment));
dispatcherRouter.post('/schedules', asyncHandler(dispatcherCreateSchedule));
dispatcherRouter.patch('/schedules/:tripId', asyncHandler(dispatcherUpdateSchedule));
dispatcherRouter.delete('/schedules/:tripId', asyncHandler(dispatcherRemoveSchedule));
dispatcherRouter.post('/weekly-schedules', asyncHandler(dispatcherCreateWeeklySchedule));
dispatcherRouter.patch('/weekly-schedules/:templateId', asyncHandler(dispatcherUpdateWeeklySchedule));
dispatcherRouter.delete('/weekly-schedules/:templateId', asyncHandler(dispatcherRemoveWeeklySchedule));
dispatcherRouter.get('/demo', asyncHandler(demoState));
dispatcherRouter.post('/demo/geofence-entry', asyncHandler(demoGeofenceEntry));
dispatcherRouter.post('/demo/dispatch-engine', asyncHandler(demoDispatchEngine));
