-- Point every unlinked membership at its workspace's role row.
--
-- `ensureWorkspaceRoles` makes this link when a workspace is seeded, but the
-- five paths that create a membership or change its base role afterwards wrote
-- `role` alone. Those people resolved straight from the compile-time matrix, so
-- a role retuned on the Roles screen did nothing for them — Member could have
-- `projects.create` unticked and still see the New Project button.
--
-- The base role enum is uppercase (`MEMBER`) and the role row's key is
-- lowercase (`member`), which is what the join matches on.
--
-- Admin is deliberately not matched: it is the one fixed role and has no row,
-- so its memberships keep a NULL link and go on resolving from the matrix.
-- That is the guarantee a workspace always stays administrable.
UPDATE `workspacemember` AS wm
JOIN `customrole` AS cr
  ON cr.`workspaceId` = wm.`workspaceId`
 AND cr.`name` = LOWER(wm.`role`)
SET wm.`customRoleId` = cr.`id`
WHERE wm.`customRoleId` IS NULL;
