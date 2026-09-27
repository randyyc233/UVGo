-- Dispatcher accounts own exactly one operational route. The column remains
-- nullable for drivers and passengers.
ALTER TABLE `User`
    ADD COLUMN `dispatcherRoute` ENUM('GOA', 'LEGAZPI') NULL AFTER `role`,
    DROP INDEX `User_role_isActive_idx`,
    ADD INDEX `User_role_dispatcherRoute_isActive_idx`(`role`, `dispatcherRoute`, `isActive`);

UPDATE `User`
SET `dispatcherRoute` = 'GOA'
WHERE `role` = 'DISPATCHER' AND `dispatcherRoute` IS NULL;

-- Audit rows carry their route so dispatcher log reads cannot leak activity
-- from another route.
ALTER TABLE `DispatchLog`
    ADD COLUMN `route` ENUM('GOA', 'LEGAZPI') NULL AFTER `targetId`,
    ADD INDEX `DispatchLog_route_timestamp_idx`(`route`, `timestamp`);

UPDATE `DispatchLog` AS log
JOIN `Trip` AS trip ON trip.`id` = log.`targetId`
SET log.`route` = trip.`route`
WHERE log.`route` IS NULL;

UPDATE `DispatchLog` AS log
JOIN `Vehicle` AS vehicle ON vehicle.`id` = log.`targetId`
SET log.`route` = vehicle.`route`
WHERE log.`route` IS NULL;

UPDATE `DispatchLog` AS log
JOIN `QueueEntry` AS queueEntry ON queueEntry.`id` = log.`targetId`
SET log.`route` = queueEntry.`route`
WHERE log.`route` IS NULL;

UPDATE `DispatchLog` AS log
JOIN `Payment` AS payment ON payment.`id` = log.`targetId`
JOIN `Reservation` AS reservation ON reservation.`id` = payment.`reservationId`
JOIN `Trip` AS trip ON trip.`id` = reservation.`tripId`
SET log.`route` = trip.`route`
WHERE log.`route` IS NULL;

UPDATE `DispatchLog` AS log
JOIN `User` AS actor ON actor.`id` = log.`actorUserId`
SET log.`route` = actor.`dispatcherRoute`
WHERE log.`route` IS NULL AND actor.`role` = 'DISPATCHER';
