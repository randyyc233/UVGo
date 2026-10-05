ALTER TABLE `QueueEntry` MODIFY `position` INTEGER NULL;

-- Retain assignments and trips; withdraw only unconfirmed/absent Taya positions.
UPDATE `QueueEntry` q
JOIN `Vehicle` v ON v.id = q.vehicleId
JOIN `TayaDailySchedule` d ON d.queueEntryId = q.id
SET q.position = NULL
WHERE q.route = 'LEGAZPI'
  AND q.status IN ('WAITING', 'ASSIGNED', 'ACCEPTED', 'READY_FOR_DISPATCH', 'DELAYED')
  AND d.serviceDate = DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR)
  AND (q.tayaArrivalAt IS NULL OR v.insideTerminalZone = false);
