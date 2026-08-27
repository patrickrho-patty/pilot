-- Companion to the brand rename: the LLM Wiki plugin's distillation tables
-- moved from `paperclip_distillation_*` to `pilot_distillation_*`, and the
-- `source_kind` default moved from 'paperclip_issue_history' to
-- 'pilot_issue_history'. The historical 002 migration file is frozen per
-- rename-invariant #1 (never edit historical migrations); this new migration
-- performs the rename and data rewrite idempotently.

--> statement-breakpoint

-- Step 1: rename tables. Use a DO block so the migration is idempotent if
-- applied more than once (the renamed names exist on the second run; do
-- nothing).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = current_schema() AND tablename = 'paperclip_distillation_cursors') THEN
    ALTER TABLE paperclip_distillation_cursors RENAME TO pilot_distillation_cursors;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = current_schema() AND tablename = 'paperclip_distillation_work_items') THEN
    ALTER TABLE paperclip_distillation_work_items RENAME TO pilot_distillation_work_items;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = current_schema() AND tablename = 'paperclip_distillation_runs') THEN
    ALTER TABLE paperclip_distillation_runs RENAME TO pilot_distillation_runs;
  END IF;
END $$;
--> statement-breakpoint

-- Step 2: flip source_kind default on existing (now-renamed) table.
ALTER TABLE pilot_distillation_cursors ALTER COLUMN source_kind SET DEFAULT 'pilot_issue_history';
--> statement-breakpoint

-- Step 3: rewrite any existing rows with the legacy source_kind value to the
-- new spelling. Both spellings are accepted by application code during the
-- alias window, but new rows should land under the new key.
UPDATE pilot_distillation_cursors
   SET source_kind = 'pilot_issue_history'
 WHERE source_kind = 'paperclip_issue_history';
