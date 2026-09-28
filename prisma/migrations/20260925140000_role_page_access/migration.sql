-- Pages assigned to a role, as a JSON array of `APP_PAGES` keys.
--
-- Nullable on purpose rather than defaulting to an empty array: an empty array
-- is a real assignment meaning "no pages at all", and stamping that onto every
-- existing row would lock every non-admin member out of the whole app on
-- deploy. NULL means "never assigned", and `resolveCustomRole` falls back to
-- the permission-derived list for those rows — exactly the pages they reach
-- today — until an admin saves the role and makes the assignment explicit.
ALTER TABLE `customrole` ADD COLUMN `pages` JSON NULL;

-- Backfill the four roles every workspace is seeded with, so each keeps the
-- sidebar it had before pages became assignable.
--
-- Not simply the permission-derived list: `navigation.ts` marked Team Members,
-- Workspaces, Timesheet and Display & Appearance admin-only, while `APP_PAGES`
-- left them open to everyone. The two disagreed, and the nav was the stricter
-- of the two — so those four are subtracted here rather than handed to every
-- role the moment the assignment starts being enforced.
--
-- Scoped to rows still carrying the seeded `name` and never assigned
-- (`pages IS NULL`). A renamed role, or one made by hand, is left alone: it
-- keeps the permission-derived fallback until an admin ticks its pages on the
-- Roles screen.
UPDATE `customrole`
SET `pages` = JSON_ARRAY(
  'dashboard', 'projects', 'tasks', 'calendar', 'messages', 'analytics', 'time-tracking', 'profile'
)
WHERE `pages` IS NULL AND `name` IN ('manager', 'member');

UPDATE `customrole`
SET `pages` = JSON_ARRAY(
  'dashboard', 'projects', 'tasks', 'calendar', 'messages', 'analytics', 'profile'
)
WHERE `pages` IS NULL AND `name` = 'viewer';

UPDATE `customrole`
SET `pages` = JSON_ARRAY(
  'dashboard', 'projects', 'tasks', 'calendar', 'messages', 'profile'
)
WHERE `pages` IS NULL AND `name` = 'guest';
