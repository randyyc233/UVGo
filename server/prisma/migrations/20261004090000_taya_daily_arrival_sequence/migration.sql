-- Distinguish a planned Taya occurrence from its confirmed terminal arrival.
ALTER TABLE `QueueEntry` ADD COLUMN `tayaArrivalAt` DATETIME(3) NULL;
