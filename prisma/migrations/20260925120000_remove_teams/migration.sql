-- DropForeignKey
ALTER TABLE `project` DROP FOREIGN KEY `Project_teamId_fkey`;

-- DropForeignKey
ALTER TABLE `team` DROP FOREIGN KEY `Team_leadId_fkey`;

-- DropForeignKey
ALTER TABLE `team` DROP FOREIGN KEY `Team_workspaceId_fkey`;

-- DropForeignKey
ALTER TABLE `user` DROP FOREIGN KEY `User_teamId_fkey`;

-- DropIndex
DROP INDEX `Project_teamId_idx` ON `project`;

-- DropIndex
DROP INDEX `User_teamId_idx` ON `user`;

-- AlterTable
ALTER TABLE `project` DROP COLUMN `teamId`;

-- AlterTable
ALTER TABLE `user` DROP COLUMN `teamId`;

-- DropTable
DROP TABLE `team`;
