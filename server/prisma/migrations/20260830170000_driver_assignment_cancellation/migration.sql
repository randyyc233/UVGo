-- Drivers can withdraw from an accepted scheduled assignment before departure.
ALTER TABLE `TripAssignment`
    MODIFY `status` ENUM(
      'PENDING',
      'ACCEPTED',
      'REJECTED',
      'EXPIRED',
      'CANCELLED'
    ) NOT NULL DEFAULT 'PENDING';

ALTER TABLE `DispatchLog`
    MODIFY `action` ENUM(
      'GEOFENCE_ENTERED',
      'GEOFENCE_EXITED',
      'ASSIGNMENT_CREATED',
      'ASSIGNMENT_ACCEPTED',
      'ASSIGNMENT_REJECTED',
      'ASSIGNMENT_CANCELLED',
      'QUEUE_OVERRIDDEN',
      'MOVED_TO_LAST',
      'VEHICLE_REPLACED',
      'DRIVER_NOTIFIED',
      'TRIP_STARTED',
      'TRIP_DEPARTED',
      'PAYMENT_APPROVED',
      'PAYMENT_REJECTED',
      'RESERVATION_REALLOCATED',
      'DRIVER_CREATED',
      'DRIVER_UPDATED',
      'DRIVER_DEACTIVATED',
      'VEHICLE_UPDATED',
      'SCHEDULE_CREATED',
      'SCHEDULE_UPDATED',
      'SCHEDULE_DELETED',
      'DEMO_SIMULATION'
    ) NOT NULL;
