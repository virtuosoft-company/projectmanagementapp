-- The record of somebody being taken off a workspace.
--
-- Additive: one new table, nothing existing is touched. It exists because the
-- removal itself destroys the evidence — the membership and project rows are
-- gone afterwards — so the counts are snapshotted here at the moment it
-- happens. Both people are SetNull so the record survives either account being
-- deleted later; the snapshot name and email are what it falls back to.

-- CreateTable
CREATE TABLE `MemberRemoval` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `userName` VARCHAR(191) NOT NULL,
    `userEmail` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN', 'MANAGER', 'MEMBER', 'VIEWER', 'GUEST') NOT NULL,
    `reason` TEXT NOT NULL,
    `projectCount` INTEGER NOT NULL DEFAULT 0,
    `hoursLogged` DOUBLE NOT NULL DEFAULT 0,
    `removedById` VARCHAR(191) NULL,
    `removedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MemberRemoval_workspaceId_removedAt_idx`(`workspaceId`, `removedAt`),
    INDEX `MemberRemoval_userId_idx`(`userId`),
    INDEX `MemberRemoval_removedById_idx`(`removedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MemberRemoval` ADD CONSTRAINT `MemberRemoval_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MemberRemoval` ADD CONSTRAINT `MemberRemoval_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MemberRemoval` ADD CONSTRAINT `MemberRemoval_removedById_fkey` FOREIGN KEY (`removedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

