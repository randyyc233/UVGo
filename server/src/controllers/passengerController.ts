import { unlink } from 'node:fs/promises';
import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError.js';
import {
  gcashReservationSchema,
  passengerPasswordSchema,
  passengerProfileSchema,
  paypalHostedReservationSchema,
  paypalReservationSchema,
  rescheduleSchema,
  tripSearchSchema,
} from '../validators/passengerValidators.js';
import {
  capturePaypalReservation,
  changePassengerPassword,
  createGcashReservation,
  createPaypalHostedReservation,
  createPaypalReservation,
  deletePassengerNotification,
  getPassengerBooking,
  getPassengerBookings,
  getPassengerNotifications,
  getPaymongoQrphCheckout,
  getTripSeats,
  releasePaypalReservation,
  markAllPassengerNotificationsRead,
  markPassengerNotificationRead,
  reschedulePassengerBooking,
  searchGoaTrips,
  updatePassengerProfile,
} from '../services/passengerService.js';
import { SESSION_COOKIE } from '../middleware/authMiddleware.js';

function routeParameter(value: unknown) {
  if (typeof value !== 'string') throw new AppError(400, 'INVALID_ROUTE_PARAMETER', 'The requested resource identifier is invalid.');
  return value;
}

export async function searchTrips(request: Request, response: Response) {
  const query = tripSearchSchema.parse(request.query);
  response.status(200).json({ trips: await searchGoaTrips(query.date, query.passengers) });
}

export async function tripSeats(request: Request, response: Response) {
  response.status(200).json(await getTripSeats(routeParameter(request.params.tripId)));
}

export async function createPaypal(request: Request, response: Response) {
  const input = paypalReservationSchema.parse(request.body);
  const order = await createPaypalReservation({ ...input, passengerId: request.auth!.userId });
  response.status(201).json(order);
}

export async function capturePaypal(request: Request, response: Response) {
  const booking = await capturePaypalReservation(request.auth!.userId, routeParameter(request.params.reference));
  response.status(200).json({ booking });
}

export async function releasePaypal(request: Request, response: Response) {
  const result = await releasePaypalReservation(request.auth!.userId, routeParameter(request.params.reference));
  response.status(200).json(result);
}

/**
 * Backs the dashboard-configured hosted button. No order is created here
 * because PayPal owns that checkout entirely — the passenger reports the
 * payment and a dispatcher verifies it, exactly like a GCash receipt.
 */
export async function createPaypalHosted(request: Request, response: Response) {
  const input = paypalHostedReservationSchema.parse(request.body);
  const booking = await createPaypalHostedReservation({ ...input, passengerId: request.auth!.userId });
  response.status(201).json({ booking });
}

export async function createGcash(request: Request, response: Response) {
  if (!request.file) throw new AppError(422, 'RECEIPT_REQUIRED', 'Upload your GCash receipt before continuing.');

  try {
    let parsedSeats: unknown;
    try {
      parsedSeats = JSON.parse(String(request.body.seats));
    } catch {
      throw new AppError(422, 'INVALID_SEATS', 'Selected seats could not be read.');
    }
    const input = gcashReservationSchema.parse({ ...request.body, seats: parsedSeats });
    const booking = await createGcashReservation({
      ...input,
      passengerId: request.auth!.userId,
      receiptImageKey: request.file.filename,
      receiptMimeType: request.file.mimetype,
    });
    response.status(201).json({ booking });
  } catch (error) {
    await unlink(request.file.path).catch(() => undefined);
    throw error;
  }
}

export async function paymongoQrphCheckout(request: Request, response: Response) {
  const result = await getPaymongoQrphCheckout(request.auth!.userId, routeParameter(request.params.reference));
  response.status(200).json(result);
}

export async function bookings(request: Request, response: Response) {
  response.status(200).json({ bookings: await getPassengerBookings(request.auth!.userId) });
}

export async function booking(request: Request, response: Response) {
  response.status(200).json({ booking: await getPassengerBooking(request.auth!.userId, routeParameter(request.params.reference)) });
}

export async function reschedule(request: Request, response: Response) {
  const input = rescheduleSchema.parse(request.body);
  const updated = await reschedulePassengerBooking(request.auth!.userId, routeParameter(request.params.reference), input.tripId, input.seats);
  response.status(200).json({ booking: updated });
}

export async function notifications(request: Request, response: Response) {
  response.status(200).json({ notifications: await getPassengerNotifications(request.auth!.userId) });
}

export async function markNotificationRead(request: Request, response: Response) {
  await markPassengerNotificationRead(request.auth!.userId, routeParameter(request.params.notificationId));
  response.status(200).json({ message: 'Notification marked as read.' });
}

export async function markAllNotificationsRead(request: Request, response: Response) {
  const updated = await markAllPassengerNotificationsRead(request.auth!.userId);
  response.status(200).json({ message: 'All notifications marked as read.', updated });
}

export async function deleteNotification(request: Request, response: Response) {
  await deletePassengerNotification(request.auth!.userId, routeParameter(request.params.notificationId));
  response.status(204).send();
}

export async function updateProfile(request: Request, response: Response) {
  const input = passengerProfileSchema.parse(request.body);
  const user = await updatePassengerProfile(request.auth!.userId, input);
  response.status(200).json({ user });
}

export async function changePassword(request: Request, response: Response) {
  const input = passengerPasswordSchema.parse(request.body);
  await changePassengerPassword(request.auth!.userId, input.currentPassword, input.newPassword);
  response.clearCookie(SESSION_COOKIE, { path: '/' });
  response.status(200).json({ message: 'Password changed successfully. Sign in again with your new password.' });
}
