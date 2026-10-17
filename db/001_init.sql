CREATE TABLE IF NOT EXISTS public.schema_migrations (version text PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.ml_account (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  seller_id text NOT NULL,
  tokens_encrypted text NOT NULL,
  expires_at timestamptz NOT NULL,
  refresh_pending boolean NOT NULL DEFAULT false,
  checkpoint timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.oauth_states (
  state_hash text PRIMARY KEY,
  browser_hash text NOT NULL,
  verifier_encrypted text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS public.return_tasks (
  seller_id text NOT NULL,
  list_id text NOT NULL,
  return_id text NOT NULL,
  claim_id text NOT NULL,
  task_id text,
  content_hash text,
  creation_uncertain boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (seller_id, list_id, return_id),
  UNIQUE (list_id, task_id)
);
CREATE TABLE IF NOT EXISTS public.sync_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  processed integer NOT NULL DEFAULT 0,
  error_code text
);
INSERT INTO public.schema_migrations(version) VALUES ('001') ON CONFLICT DO NOTHING;
