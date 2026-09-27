ALTER TABLE `Payment`
  MODIFY `method` ENUM('PAYPAL', 'GCASH_RECEIPT', 'PAYMONGO_QRPH') NOT NULL,
  ADD COLUMN `paymongoPaymentIntentId` VARCHAR(191) NULL,
  ADD COLUMN `paymongoPaymentMethodId` VARCHAR(191) NULL,
  ADD COLUMN `paymongoPaymentId` VARCHAR(191) NULL,
  ADD COLUMN `paymongoClientKey` VARCHAR(255) NULL,
  ADD COLUMN `paymongoQrExpiresAt` DATETIME(3) NULL,
  ADD UNIQUE INDEX `Payment_paymongoPaymentIntentId_key` (`paymongoPaymentIntentId`),
  ADD UNIQUE INDEX `Payment_paymongoPaymentMethodId_key` (`paymongoPaymentMethodId`),
  ADD UNIQUE INDEX `Payment_paymongoPaymentId_key` (`paymongoPaymentId`);
