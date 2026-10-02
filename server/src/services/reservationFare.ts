import { Prisma } from '@prisma/client';
import { AppError } from '../utils/AppError.js';

export interface PassengerDiscountInput {
  studentPassengers?: number;
  seniorPassengers?: number;
  discountIdAcknowledged?: boolean;
}

/** One discount per eligible seat. The server alone computes discounted prices. */
export function calculateReservationFare(fare: Prisma.Decimal, seatCount: number, input: PassengerDiscountInput) {
  const studentPassengers = input.studentPassengers ?? 0;
  const seniorPassengers = input.seniorPassengers ?? 0;
  if (!Number.isInteger(seatCount) || seatCount < 1 || seatCount > 11
    || ![studentPassengers, seniorPassengers].every((count) => Number.isInteger(count) && count >= 0)
    || studentPassengers + seniorPassengers > seatCount) {
    throw new AppError(422, 'INVALID_DISCOUNT_PASSENGERS', 'Student and senior passengers cannot exceed the selected seats.');
  }
  if (studentPassengers + seniorPassengers > 0 && input.discountIdAcknowledged !== true) {
    throw new AppError(422, 'DISCOUNT_ID_REQUIRED', 'Confirm that every discounted passenger will present a valid student or senior citizen ID at the terminal.');
  }
  const subtotal = fare.mul(seatCount).toDecimalPlaces(2);
  const discountPerSeat = fare.mul('0.20').toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const discountAmount = discountPerSeat.mul(studentPassengers + seniorPassengers);
  return {
    subtotal: Number(subtotal), discountAmount: Number(discountAmount), totalAmount: Number(subtotal.sub(discountAmount)),
    studentPassengers, seniorPassengers, regularPassengers: seatCount - studentPassengers - seniorPassengers,
  };
}
