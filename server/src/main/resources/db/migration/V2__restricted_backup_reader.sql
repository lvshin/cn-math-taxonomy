-- Provision this dedicated login separately. It has no write access and is never used by Web requests.
GRANT USAGE ON SCHEMA learning TO learning_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA learning TO learning_backup;
GRANT SELECT ON public.flyway_schema_history TO learning_backup;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA learning TO learning_backup;
DO $$
DECLARE table_name text;
BEGIN
 FOR table_name IN SELECT tablename FROM pg_tables WHERE schemaname='learning' LOOP
  EXECUTE format('CREATE POLICY protected_backup_read ON learning.%I FOR SELECT TO learning_backup USING(true)',table_name);
 END LOOP;
END $$;
