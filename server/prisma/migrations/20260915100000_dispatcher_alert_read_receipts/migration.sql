-- Persist per-dispatcher read state for live operational alerts.
CREATE TABLE `DispatcherAlertRead` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `alertKey` VARCHAR(191) NOT NULL,
    `readAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DispatcherAlertRead_userId_alertKey_key`(`userId`, `alertKey`),
    INDEX `DispatcherAlertRead_userId_readAt_idx`(`userId`, `readAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DispatcherAlertRead`
    ADD CONSTRAINT `DispatcherAlertRead_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
