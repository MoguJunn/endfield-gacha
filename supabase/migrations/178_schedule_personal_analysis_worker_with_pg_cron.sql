-- 178: schedule the personal-analysis worker from self-hosted Supabase.
--
-- Runtime credentials are deliberately stored in Supabase Vault. The cron
-- command contains only a call to a locked SECURITY DEFINER wrapper, so
-- Authorization and Vercel protection bypass secrets never appear in
-- cron.job.command.

BEGIN;

CREATE TABLE IF NOT EXISTS public.personal_analysis_worker_dispatches (
  request_id BIGINT PRIMARY KEY,
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  scheduler TEXT NOT NULL DEFAULT 'pg_cron',
  CHECK (btrim(scheduler) <> '')
);

REVOKE ALL ON TABLE public.personal_analysis_worker_dispatches
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.personal_analysis_worker_dispatches
  TO service_role;

DO $migration$
DECLARE
  v_has_pg_cron BOOLEAN := EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron'
  );
  v_has_pg_net BOOLEAN := EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net'
  );
  v_has_vault BOOLEAN := EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'supabase_vault'
  );
  v_has_worker_url BOOLEAN := FALSE;
  v_has_worker_secret BOOLEAN := FALSE;
  v_job_id BIGINT;
BEGIN
  -- The public baseline smoke image intentionally has no Supabase extensions.
  -- Production verification must assert that all three extensions and the job
  -- exist; unsupported development databases safely skip scheduler creation.
  IF NOT (v_has_pg_cron AND v_has_pg_net AND v_has_vault) THEN
    RAISE NOTICE 'Skipping personal-analysis scheduler: pg_cron, pg_net, or Supabase Vault is unavailable';
    RETURN;
  END IF;

  EXECUTE 'CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE';
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net';
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';

  EXECUTE $sql$
    SELECT EXISTS (
      SELECT 1
      FROM vault.decrypted_secrets
      WHERE name = 'personal_analysis_worker_url'
        AND NULLIF(btrim(decrypted_secret), '') IS NOT NULL
    )
  $sql$ INTO v_has_worker_url;
  EXECUTE $sql$
    SELECT EXISTS (
      SELECT 1
      FROM vault.decrypted_secrets
      WHERE name = 'personal_analysis_worker_secret'
        AND NULLIF(btrim(decrypted_secret), '') IS NOT NULL
    )
  $sql$ INTO v_has_worker_secret;

  IF NOT v_has_worker_url OR NOT v_has_worker_secret THEN
    RAISE EXCEPTION 'Personal analysis scheduler Vault secrets are not configured';
  END IF;

  EXECUTE $ddl$
    CREATE OR REPLACE FUNCTION public.dispatch_personal_analysis_worker()
    RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public, vault, net
    AS $function$
    DECLARE
      v_worker_url TEXT;
      v_worker_secret TEXT;
      v_vercel_bypass_secret TEXT;
      v_headers JSONB;
      v_request_id BIGINT;
    BEGIN
      SELECT decrypted_secret
      INTO v_worker_url
      FROM vault.decrypted_secrets
      WHERE name = 'personal_analysis_worker_url'
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1;

      SELECT decrypted_secret
      INTO v_worker_secret
      FROM vault.decrypted_secrets
      WHERE name = 'personal_analysis_worker_secret'
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1;

      SELECT decrypted_secret
      INTO v_vercel_bypass_secret
      FROM vault.decrypted_secrets
      WHERE name = 'personal_analysis_worker_vercel_bypass_secret'
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1;

      v_worker_url := NULLIF(btrim(v_worker_url), '');
      v_worker_secret := NULLIF(btrim(v_worker_secret), '');
      v_vercel_bypass_secret := NULLIF(btrim(v_vercel_bypass_secret), '');

      IF v_worker_url IS NULL OR v_worker_secret IS NULL THEN
        RAISE EXCEPTION 'Personal analysis scheduler Vault secrets are missing';
      END IF;
      IF v_worker_url !~ '^https://[A-Za-z0-9-]+[.]vercel[.]app/api/personal-analysis-worker$' THEN
        RAISE EXCEPTION 'Personal analysis worker URL must be an immutable HTTPS Vercel deployment URL';
      END IF;

      v_headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_worker_secret,
        'Content-Type', 'application/json'
      );
      IF v_vercel_bypass_secret IS NOT NULL THEN
        v_headers := v_headers || jsonb_build_object(
          'x-vercel-protection-bypass', v_vercel_bypass_secret
        );
      END IF;

      SELECT net.http_post(
        url := v_worker_url,
        body := '{}'::jsonb,
        params := '{}'::jsonb,
        headers := v_headers,
        timeout_milliseconds := 50000
      )
      INTO v_request_id;

      INSERT INTO public.personal_analysis_worker_dispatches (
        request_id,
        dispatched_at,
        scheduler
      ) VALUES (
        v_request_id,
        clock_timestamp(),
        'pg_cron'
      );

      DELETE FROM public.personal_analysis_worker_dispatches
      WHERE dispatched_at < clock_timestamp() - INTERVAL '7 days';

      RETURN v_request_id;
    END;
    $function$
  $ddl$;

  EXECUTE 'REVOKE ALL ON FUNCTION public.dispatch_personal_analysis_worker() FROM PUBLIC, anon, authenticated, service_role';

  -- Named scheduling is idempotent across forward redeployments.
  EXECUTE $sql$
    SELECT cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'personal-analysis-worker'
  $sql$;

  EXECUTE $sql$
    SELECT cron.schedule(
      'personal-analysis-worker',
      '* * * * *',
      'SELECT public.dispatch_personal_analysis_worker();'
    )
  $sql$ INTO v_job_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'Personal analysis pg_cron job could not be scheduled';
  END IF;

  -- Migration 177 added a PostgREST RPC. Make the reload explicit so a
  -- rolling API deployment cannot silently treat the queue as unavailable.
  NOTIFY pgrst, 'reload schema';
END;
$migration$;

COMMIT;
