import { Prisma, VehicleStatus } from '@prisma/client';
import { manilaServiceDay } from './driverSchedulePolicy.js';

/** Admission is independent of the driver's predefined daily assignment. */
export function tayaQueueAdmissionWhere(now = new Date()) {
  const day = manilaServiceDay(now);
  return {
    position: { gt: 0 },
    tayaArrivalAt: { gte: day.start, lt: day.end },
    vehicle: {
      insideTerminalZone: true,
      status: { notIn: [VehicleStatus.ON_TRIP, VehicleStatus.UNAVAILABLE] },
    },
    tayaDailySchedule: { is: { serviceDate: new Date(`${day.date}T00:00:00.000Z`) } },
  } satisfies Prisma.QueueEntryWhereInput;
}
