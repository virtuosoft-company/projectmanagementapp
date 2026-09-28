-- Who manages each member, within one workspace.
--
-- Nullable, and null is a meaningful value: it means nobody has been named yet,
-- which makes that member visible to admins only rather than to every manager.
-- Every existing row starts unassigned, so no manager gains anybody on deploy.
ALTER TABLE `workspacemember` ADD COLUMN `managerId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `WorkspaceMember_workspaceId_managerId_idx` ON `WorkspaceMember`(`workspaceId`, `managerId`);

-- AddForeignKey
-- SetNull, not Cascade: deleting a manager's account releases their reports
-- rather than deleting the people who reported to them.
ALTER TABLE `WorkspaceMember` ADD CONSTRAINT `WorkspaceMember_managerId_fkey` FOREIGN KEY (`managerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
