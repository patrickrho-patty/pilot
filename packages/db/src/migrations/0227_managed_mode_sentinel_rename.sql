-- Companion to the brand rename: the `managed_mode` sentinel on
-- company_secrets and user_secret_definitions moved from
-- "paperclip_managed" to "pilot_managed" in code (Task 6d Step 1). Existing
-- rows keep their legacy value and are still honored by the dual-read
-- isManagedModeValue() helper during the alias window. This migration
-- only flips the column DEFAULT so new inserts pick up the new spelling.

ALTER TABLE "company_secrets"
  ALTER COLUMN "managed_mode" SET DEFAULT 'pilot_managed';

ALTER TABLE "user_secret_definitions"
  ALTER COLUMN "managed_mode" SET DEFAULT 'pilot_managed';
