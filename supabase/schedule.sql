-- Enable pg_cron, pg_net and Vault in the Supabase dashboard first.
-- Create Vault secrets ml_clickup_app_url (HTTPS origin) and ml_clickup_cron_secret.
-- This script contains secret NAMES only; credentials are resolved when each job runs.
BEGIN;
DO $checks$
DECLARE
  app_url text;
  cron_secret text;
BEGIN
  IF to_regclass('cron.job') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL
    OR to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'Enable Supabase Cron (pg_cron), pg_net and Vault first';
  END IF;
  SELECT decrypted_secret INTO STRICT app_url FROM vault.decrypted_secrets WHERE name='ml_clickup_app_url';
  SELECT decrypted_secret INTO STRICT cron_secret FROM vault.decrypted_secrets WHERE name='ml_clickup_cron_secret';
  IF app_url !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?/?$' THEN
    RAISE EXCEPTION 'ml_clickup_app_url must contain only the HTTPS origin, without paths or credentials';
  END IF;
  IF length(cron_secret) < 32 THEN
    RAISE EXCEPTION 'ml_clickup_cron_secret must match CRON_SECRET and have at least 32 characters';
  END IF;
END
$checks$;

SELECT cron.schedule(
  'ml-clickup-sync',
  '*/15 * * * *',
  $job$
    SELECT net.http_get(
      url := rtrim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='ml_clickup_app_url'), '/') || '/api/cron/sync',
      headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='ml_clickup_cron_secret')),
      timeout_milliseconds := 300000
    );
  $job$
);
COMMIT;
