ALTER TABLE `Reservation`
  ADD COLUMN `rescheduleCount` INTEGER NOT NULL DEFAULT 0;

-- Preserve reschedules that can be established from existing records.
-- Deleted historical notifications cannot be reconstructed; future counts persist
-- on the reservation independently of notification deletion or reallocation.
UPDATE `Reservation` AS r
SET r.`rescheduleCount` = GREATEST(
  IF(r.`status` = 'RESCHEDULED', 1, 0),
  (SELECT COUNT(*) FROM `Notification` AS n
   WHERE n.`userId` = r.`passengerId`
     AND n.`type` = 'BOOKING'
     AND n.`message` = CONCAT('Booking ', r.`reference`, ' was rescheduled.'))
);
