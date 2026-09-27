export const VAN_DRIVER_CAPACITY = 1;

/**
 * Seat capacity is per-vehicle and dispatcher-adjustable. These are the
 * defaults and the accepted range; `Vehicle.capacity` is the source of truth
 * for any trip, seat map or occupancy check that has a vehicle in scope.
 */
export const DEFAULT_VAN_PASSENGER_CAPACITY = 11;
export const MIN_VAN_PASSENGER_CAPACITY = 1;
export const MAX_VAN_PASSENGER_CAPACITY = 30;

/** Fallback used only where no vehicle record is available. */
export const VAN_PASSENGER_CAPACITY = DEFAULT_VAN_PASSENGER_CAPACITY;

export const VAN_TOTAL_OCCUPANT_CAPACITY = VAN_DRIVER_CAPACITY + VAN_PASSENGER_CAPACITY;

export function isValidPassengerCapacity(capacity: number) {
  return (
    Number.isInteger(capacity) &&
    capacity >= MIN_VAN_PASSENGER_CAPACITY &&
    capacity <= MAX_VAN_PASSENGER_CAPACITY
  );
}

/** Resolves the passenger capacity for a vehicle, falling back to the default. */
export function passengerCapacityOf(vehicle: { capacity: number } | null | undefined) {
  if (!vehicle || !isValidPassengerCapacity(vehicle.capacity)) return VAN_PASSENGER_CAPACITY;
  return vehicle.capacity;
}
