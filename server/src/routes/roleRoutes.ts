import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { requireAuthentication, requireRole } from '../middleware/authMiddleware.js';
import { receiptUpload } from '../middleware/receiptUpload.js';
import {
  booking,
  bookings,
  capturePaypal,
  createGcash,
  createPaypal,
  notifications,
  reschedule,
  searchTrips,
  tripSeats,
} from '../controllers/passengerController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  acceptAssignment,
  arriveAtTerminal,
  overview as driverOverview,
  rejectAssignment,
  startTrip,
  updateLocation,
  updateGoOnTrip,
  updateOccupancy,
} from '../controllers/driverController.js';
import {
  dashboard as dispatcherDashboard,
  demoDispatchEngine,
  demoGeofenceEntry,
  demoState,
  fleet as dispatcherFleet,
  logs as dispatcherLogs,
  paymentDecision,
  payments as dispatcherPayments,
  queue as dispatcherQueue,
  queueAction,
  receipt as dispatcherReceipt,
} from '../controllers/dispatcherController.js';

export const passengerRouter = Router();
export const driverRouter = Router();
export const dispatcherRouter = Router();

passengerRouter.use(requireAuthentication, requireRole(UserRole.PASSENGER));
driverRouter.use(requireAuthentication, requireRole(UserRole.DRIVER));
dispatcherRouter.use(requireAuthentication, requireRole(UserRole.DISPATCHER));

passengerRouter.get('/session', (request, response) => {
  response.status(200).json({ role: 'passenger', userId: request.auth?.userId });
});
passengerRouter.get('/trips', asyncHandler(searchTrips));
passengerRouter.get('/trips/:tripId/seats', asyncHandler(tripSeats));
passengerRouter.post('/reservations/paypal', asyncHandler(createPaypal));
passengerRouter.post('/reservations/:reference/paypal/capture', asyncHandler(capturePaypal));
passengerRouter.post('/reservations/gcash', receiptUpload.single('receipt'), asyncHandler(createGcash));
passengerRouter.get('/bookings', asyncHandler(bookings));
passengerRouter.get('/bookings/:reference', asyncHandler(booking));
passengerRouter.post('/bookings/:reference/reschedule', asyncHandler(reschedule));
passengerRouter.get('/notifications', asyncHandler(notifications));

driverRouter.get('/session', (request, response) => {
  response.status(200).json({ role: 'driver', userId: request.auth?.userId });
});
driverRouter.get('/overview', asyncHandler(driverOverview));
driverRouter.patch('/setup/go-on-trip', asyncHandler(updateGoOnTrip));
driverRouter.post('/assignments/:assignmentId/accept', asyncHandler(acceptAssignment));
driverRouter.post('/assignments/:assignmentId/reject', asyncHandler(rejectAssignment));
driverRouter.post('/occupancy', asyncHandler(updateOccupancy));
driverRouter.post('/location', asyncHandler(updateLocation));
driverRouter.post('/trip/arrive', asyncHandler(arriveAtTerminal));
driverRouter.post('/trip/start', asyncHandler(startTrip));

dispatcherRouter.get('/session', (request, response) => {
  response.status(200).json({ role: 'dispatcher', userId: request.auth?.userId });
});
dispatcherRouter.get('/dashboard', asyncHandler(dispatcherDashboard));
dispatcherRouter.get('/fleet', asyncHandler(dispatcherFleet));
dispatcherRouter.get('/queue', asyncHandler(dispatcherQueue));
dispatcherRouter.post('/queue/:queueEntryId/actions', asyncHandler(queueAction));
dispatcherRouter.get('/payments', asyncHandler(dispatcherPayments));
dispatcherRouter.post('/payments/:paymentId/decision', asyncHandler(paymentDecision));
dispatcherRouter.get('/payments/:paymentId/receipt', asyncHandler(dispatcherReceipt));
dispatcherRouter.get('/logs', asyncHandler(dispatcherLogs));
dispatcherRouter.get('/demo', asyncHandler(demoState));
dispatcherRouter.post('/demo/geofence-entry', asyncHandler(demoGeofenceEntry));
dispatcherRouter.post('/demo/dispatch-engine', asyncHandler(demoDispatchEngine));
