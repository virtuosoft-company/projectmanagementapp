-- Make every project's `features` explicit, and retire the report page.
--
-- Two problems, one pass.
--
-- 1. A NULL `features` fell back to DEFAULT_PROJECT_FEATURES at read time, so
--    "never configured" and "deliberately chose these" looked identical in the
--    sidebar and could only be told apart by reading the column. Every project
--    now stores its own answer.
--
-- 2. `report` is no longer offered in the picker — the project overview shows
--    the same figures. It has to come out of the stored arrays as well as the
--    picker: the features dialog seeds itself from what is stored and submits
--    that back, and `projectFeaturesSchema` validates against the offered keys.
--    A project left holding `report` would therefore fail validation the next
--    time anybody saved its features, with "Could not save those features."

-- Previously-unset projects get the old default minus the retired page.
UPDATE `project`
SET `features` = JSON_ARRAY('tasks', 'campaigns')
WHERE `features` IS NULL;

-- And drop `report` wherever it was explicitly chosen.
UPDATE `project`
SET `features` = JSON_REMOVE(`features`, JSON_UNQUOTE(JSON_SEARCH(`features`, 'one', 'report')))
WHERE `features` IS NOT NULL
  AND JSON_SEARCH(`features`, 'one', 'report') IS NOT NULL;
