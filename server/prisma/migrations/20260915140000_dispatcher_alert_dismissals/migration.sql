-- Store per-dispatcher notification dismissal without deleting the underlying operational alert.
ALTER TABLE `DispatcherAlertRead`
    ADD COLUMN `dismissedAt` DATETIME(3) NULL;
