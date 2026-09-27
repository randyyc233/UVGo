import { boardingStartFor } from '../config/dispatch.js';

interface QueueTripCandidate {
  id: string;
  boardingStartTime: Date | null;
  scheduledOrTriggeredTime: Date;
}

interface QueueTripAssignment {
  tripId: string;
}

/**
 * Select the active trip represented by one queue row.
 *
 * Assignments must be supplied newest first. A matching loading slot is the
 * strongest identity for vans with several schedules on the same day. The
 * assignment link is the fallback when a dispatcher has manually adjusted
 * that queue row's loading time.
 */
export function selectTripForQueueRow<T extends QueueTripCandidate>(
  scheduledLoadingTime: Date | null,
  assignments: readonly QueueTripAssignment[],
  trips: readonly T[],
) {
  const loadingTime = scheduledLoadingTime?.getTime() ?? null;
  const linkedTripIds = new Set(assignments.map((assignment) => assignment.tripId));
  const exactLinkedTrip = loadingTime === null ? null : trips.find((candidate) => (
    linkedTripIds.has(candidate.id)
    && boardingStartFor(candidate.scheduledOrTriggeredTime, candidate.boardingStartTime).getTime() === loadingTime
  )) ?? null;
  const linkedAssignment = exactLinkedTrip
    ? assignments.find((candidate) => candidate.tripId === exactLinkedTrip.id) ?? null
    : assignments.find((candidate) => trips.some((trip) => trip.id === candidate.tripId)) ?? null;
  const linkedTrip = linkedAssignment
    ? trips.find((candidate) => candidate.id === linkedAssignment.tripId) ?? null
    : null;
  const exactVehicleTrip = loadingTime === null ? null : trips.find((candidate) => (
    boardingStartFor(candidate.scheduledOrTriggeredTime, candidate.boardingStartTime).getTime() === loadingTime
  )) ?? null;

  return exactLinkedTrip ?? linkedTrip ?? exactVehicleTrip ?? trips[0] ?? null;
}
