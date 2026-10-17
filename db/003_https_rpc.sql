CREATE TABLE IF NOT EXISTS ml_integration.sync_lease (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  owner uuid,
  expires_at timestamptz NOT NULL DEFAULT '-infinity'
);
INSERT INTO ml_integration.sync_lease(singleton) VALUES(true) ON CONFLICT DO NOTHING;
ALTER TABLE ml_integration.sync_lease ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_integration.sync_runs ADD COLUMN IF NOT EXISTS lock_token uuid;
REVOKE ALL ON ml_integration.sync_lease FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.ml_service(
  p_operation text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_lock_token uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  result jsonb;
  existing_seller text;
BEGIN
  -- Deliberately no arbitrary SQL endpoint. Only the named operations below can execute.
  IF p_operation = 'lease_acquire' THEN
    IF p_lock_token IS NULL THEN RETURN jsonb_build_object('error','SYNC_LOCK_LOST'); END IF;
    UPDATE ml_integration.sync_lease SET owner=p_lock_token,expires_at=clock_timestamp()+interval '120 seconds'
      WHERE singleton=true AND (owner=p_lock_token OR expires_at<=clock_timestamp());
    RETURN jsonb_build_object('data',FOUND);
  ELSIF p_operation = 'lease_renew' THEN
    UPDATE ml_integration.sync_lease SET expires_at=clock_timestamp()+interval '120 seconds'
      WHERE singleton=true AND owner=p_lock_token AND expires_at>clock_timestamp();
    RETURN jsonb_build_object('data',FOUND);
  ELSIF p_operation = 'lease_release' THEN
    UPDATE ml_integration.sync_lease SET owner=NULL,expires_at='-infinity'
      WHERE singleton=true AND owner=p_lock_token;
    RETURN jsonb_build_object('data',FOUND);
  END IF;

  -- Hold the row lock for this RPC transaction: a new owner cannot overtake a fenced write.
  IF p_operation NOT IN ('oauth_begin','status_get') THEN
    PERFORM 1 FROM ml_integration.sync_lease
      WHERE singleton=true AND owner=p_lock_token AND expires_at>clock_timestamp() FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','SYNC_LOCK_LOST'); END IF;
  END IF;

  CASE p_operation
  WHEN 'oauth_begin' THEN
    DELETE FROM ml_integration.oauth_states WHERE expires_at<clock_timestamp();
    INSERT INTO ml_integration.oauth_states(state_hash,browser_hash,verifier_encrypted,expires_at)
      VALUES(p_payload->>'state_hash',p_payload->>'browser_hash',p_payload->>'verifier_encrypted',clock_timestamp()+interval '10 minutes');
  WHEN 'oauth_consume' THEN
    DELETE FROM ml_integration.oauth_states WHERE state_hash=p_payload->>'state_hash'
      AND browser_hash=p_payload->>'browser_hash' AND expires_at>clock_timestamp()
      RETURNING to_jsonb(verifier_encrypted) INTO result;
  WHEN 'account_get' THEN
    SELECT to_jsonb(a) INTO result FROM ml_integration.ml_account a WHERE singleton=true;
  WHEN 'account_save' THEN
    SELECT seller_id INTO existing_seller FROM ml_integration.ml_account WHERE singleton=true;
    IF existing_seller IS NOT NULL AND existing_seller<>p_payload->>'seller_id' THEN
      RETURN jsonb_build_object('error','ML_SELLER_MISMATCH');
    END IF;
    INSERT INTO ml_integration.ml_account(singleton,seller_id,tokens_encrypted,expires_at)
      VALUES(true,p_payload->>'seller_id',p_payload->>'tokens_encrypted',(p_payload->>'expires_at')::timestamptz)
      ON CONFLICT(singleton) DO UPDATE SET tokens_encrypted=excluded.tokens_encrypted,expires_at=excluded.expires_at,
        refresh_pending=false,updated_at=clock_timestamp();
  WHEN 'refresh_begin' THEN
    UPDATE ml_integration.ml_account SET refresh_pending=true WHERE singleton=true AND refresh_pending=false;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','ML_REAUTH_REQUIRED'); END IF;
  WHEN 'mapping_get' THEN
    SELECT to_jsonb(t) INTO result FROM ml_integration.return_tasks t WHERE seller_id=p_payload->>'seller_id'
      AND list_id=p_payload->>'list_id' AND return_id=p_payload->>'return_id';
  WHEN 'mapping_reserve' THEN
    INSERT INTO ml_integration.return_tasks(seller_id,list_id,return_id,claim_id,creation_uncertain)
      VALUES(p_payload->>'seller_id',p_payload->>'list_id',p_payload->>'return_id',p_payload->>'claim_id',true)
      ON CONFLICT(seller_id,list_id,return_id) DO NOTHING;
    IF NOT FOUND THEN RETURN jsonb_build_object('error','CLICKUP_CREATE_UNCERTAIN'); END IF;
  WHEN 'mapping_save' THEN
    INSERT INTO ml_integration.return_tasks(seller_id,list_id,return_id,claim_id,task_id,content_hash,creation_uncertain)
      VALUES(p_payload->>'seller_id',p_payload->>'list_id',p_payload->>'return_id',p_payload->>'claim_id',p_payload->>'task_id',p_payload->>'content_hash',false)
      ON CONFLICT(seller_id,list_id,return_id) DO UPDATE SET claim_id=excluded.claim_id,task_id=excluded.task_id,
        content_hash=excluded.content_hash,creation_uncertain=false,updated_at=clock_timestamp();
  WHEN 'known_claims' THEN
    SELECT coalesce(jsonb_agg(claim_id),'[]'::jsonb) INTO result FROM (
      SELECT DISTINCT claim_id FROM ml_integration.return_tasks
      WHERE seller_id=p_payload->>'seller_id' AND list_id=p_payload->>'list_id'
    ) t;
  WHEN 'run_start' THEN
    INSERT INTO ml_integration.sync_runs(lock_token) VALUES(p_lock_token) RETURNING to_jsonb(id::text) INTO result;
  WHEN 'run_finish' THEN
    UPDATE ml_integration.sync_runs SET status=p_payload->>'status',finished_at=clock_timestamp(),
      processed=(p_payload->>'processed')::integer,error_code=p_payload->>'error_code'
      WHERE id=(p_payload->>'id')::bigint AND lock_token=p_lock_token;
  WHEN 'checkpoint_save' THEN
    UPDATE ml_integration.ml_account SET checkpoint=(p_payload->>'checkpoint')::timestamptz WHERE singleton=true;
  WHEN 'status_get' THEN
    SELECT jsonb_build_object(
      'connected',EXISTS(SELECT 1 FROM ml_integration.ml_account),
      'account',(SELECT jsonb_build_object('seller_id',seller_id,'expires_at',expires_at,'refresh_pending',refresh_pending,'checkpoint',checkpoint)
        FROM ml_integration.ml_account WHERE singleton=true),
      'listId',p_payload->>'list_id',
      'runs',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM (
        SELECT s.id::text,s.started_at,s.finished_at,s.status,s.processed,s.error_code FROM ml_integration.sync_runs s ORDER BY s.id DESC LIMIT 20
      ) r),
      'uncertain',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM (
        SELECT return_id,claim_id,updated_at FROM ml_integration.return_tasks
        WHERE seller_id=(SELECT seller_id FROM ml_integration.ml_account WHERE singleton=true)
          AND list_id=p_payload->>'list_id' AND creation_uncertain=true ORDER BY updated_at
      ) t)
    ) INTO result;
  ELSE
    RAISE EXCEPTION 'Unsupported integration operation' USING ERRCODE='22023';
  END CASE;
  RETURN jsonb_build_object('data',result);
END
$function$;

REVOKE ALL ON FUNCTION public.ml_service(text,jsonb,uuid) FROM PUBLIC;
DO $permissions$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON ml_integration.sync_lease FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON FUNCTION public.ml_service(text,jsonb,uuid) FROM %I',role_name);
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT EXECUTE ON FUNCTION public.ml_service(text,jsonb,uuid) TO service_role;
  END IF;
END
$permissions$;
INSERT INTO ml_integration.schema_migrations(version) VALUES('003') ON CONFLICT DO NOTHING;
NOTIFY pgrst, 'reload schema';
