-- AlterTable
ALTER TABLE `message` ADD COLUMN `readAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `Message_workspaceId_recipientId_readAt_idx` ON `Message`(`workspaceId`, `recipientId`, `readAt`);

