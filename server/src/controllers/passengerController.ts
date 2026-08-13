import { unlink } from 'node:fs/promises';
import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError.js';
import {
  gcashReservationSchema,
  paypalReservationSchema,
  rescheduleSchema,
  tripSearchSchema,
} from '../validators/passengerValidators.js';
import {
  capturePaypalReservation,
  createGcashReservation,
  createPaypalReservation,
  getPassengerBooking,
  getPassengerBookings,
  getPassengerNotifications,
  getTripSeats,
  reschedulePassengerBooking,
  searchGoaTrips,
} from '../services/passengerService.js';

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
