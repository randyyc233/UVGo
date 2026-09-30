-- Store Google's stable account identifier separately from the changeable email address.
ALTER TABLE `User` ADD COLUMN `googleSubject` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `User_googleSubject_key` ON `User`(`googleSubject`);
