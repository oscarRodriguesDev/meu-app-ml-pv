-- OAuth credentials and synchronization state are backend-only, never exposed through PostgREST.
CREATE SCHEMA IF NOT EXISTS ml_integration;
REVOKE ALL ON SCHEMA ml_integration FROM PUBLIC;

DO $migration$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['schema_migrations', 'ml_account', 'oauth_states', 'return_tasks', 'sync_runs']
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      IF to_regclass(format('ml_integration.%I', table_name)) IS NOT NULL THEN
        RAISE EXCEPTION 'Both public and private integration tables exist; inspect before migrating';
      END IF;
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA ml_integration', table_name);
    END IF;
    EXECUTE format('ALTER TABLE ml_integration.%I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END
$migration$;

REVOKE ALL ON ALL TABLES IN SCHEMA ml_integration FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ml_integration FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA ml_integration REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA ml_integration REVOKE ALL ON SEQUENCES FROM PUBLIC;

-- Roles exist on Supabase, but not necessarily on a development PostgreSQL installation.
DO $permissions$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA ml_integration FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA ml_integration FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA ml_integration FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA ml_integration REVOKE ALL ON TABLES FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA ml_integration REVOKE ALL ON SEQUENCES FROM %I', role_name);
    END IF;
  END LOOP;
END
$permissions$;

INSERT INTO ml_integration.schema_migrations(version) VALUES ('002') ON CONFLICT DO NOTHING;
