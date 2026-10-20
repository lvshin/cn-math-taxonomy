-- Pre-existing rows are explicitly marked as unavailable rather than inventing past activity content.
ALTER TABLE learning.observations ADD COLUMN activity_snapshot jsonb NOT NULL DEFAULT '{"unavailable":true}'::jsonb;
ALTER TABLE learning.observations ALTER COLUMN activity_snapshot DROP DEFAULT;
