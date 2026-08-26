-- 179: dispatch active personal-analysis jobs immediately and batch within a
-- bounded Worker request. pg_cron remains the once-per-minute recovery path.

BEGIN;

CREATE TABLE IF NOT EXISTS public.personal_analysis_worker_dispatch_control (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  last_dispatched_at TIMESTAMPTZ,
  last_request_id BIGINT
);

INSERT INTO public.personal_analysis_worker_dispatch_control (singleton)
VALUES (TRUE)
ON CONFLICT (singleton) DO NOTHING;

REVOKE ALL ON TABLE public.personal_analysis_worker_dispatch_control
  FROM PUBLIC, anon, authenticated, service_role;

DO $migration$
DECLARE
  v_extensions_ready BOOLEAN :=
    to_regnamespace('vault') IS NOT NULL
    AND to_regnamespace('net') IS NOT NULL
    AND to_regnamespace('cron') IS NOT NULL;
  v_job_id BIGINT;
BEGIN
  IF NOT v_extensions_ready THEN
    RAISE NOTICE 'Skipping immediate personal-analysis dispatch: Vault, pg_net, or pg_cron is unavailable';
    RETURN;
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
        body := jsonb_build_object(
          'maxBatches', 4,
          'timeBudgetMs', 45000
        ),
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
        'pg_net'
      );

      DELETE FROM public.personal_analysis_worker_dispatches
      WHERE dispatched_at < clock_timestamp() - INTERVAL '7 days';

      RETURN v_request_id;
    END;
    $function$
  $ddl$;

  EXECUTE 'REVOKE ALL ON FUNCTION public.dispatch_personal_analysis_worker() FROM PUBLIC, anon, authenticated, service_role';

  EXECUTE $ddl$
    CREATE OR REPLACE FUNCTION public.request_personal_analysis_worker_dispatch(
      p_user_id UUID DEFAULT NULL,
      p_min_interval_seconds INTEGER DEFAULT 5
    )
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      v_now TIMESTAMPTZ := clock_timestamp();
      v_min_interval_seconds INTEGER := LEAST(
        GREATEST(COALESCE(p_min_interval_seconds, 5), 1),
        60
      );
      v_control public.personal_analysis_worker_dispatch_control%ROWTYPE;
      v_request_id BIGINT;
      v_has_pending_job BOOLEAN := TRUE;
    BEGIN
      IF p_user_id IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.personal_analysis_owner_state AS owner_state
          WHERE owner_state.user_id = p_user_id
            AND owner_state.snapshot_revision < owner_state.history_revision

          UNION ALL

          SELECT 1
          FROM public.personal_analysis_scope_state AS scope_state
          WHERE scope_state.user_id = p_user_id
            AND scope_state.snapshot_revision < scope_state.history_revision
        )
        INTO v_has_pending_job;
      END IF;

      IF NOT v_has_pending_job THEN
        RETURN jsonb_build_object(
          'accepted', TRUE,
          'dispatched', FALSE,
          'throttled', FALSE,
          'reason', 'no_pending_job'
        );
      END IF;

      PERFORM pg_advisory_xact_lock(hashtextextended(
        'personal-analysis-worker-dispatch',
        0
      ));

      SELECT *
      INTO v_control
      FROM public.personal_analysis_worker_dispatch_control
      WHERE singleton = TRUE
      FOR UPDATE;

      IF v_control.last_dispatched_at IS NOT NULL
        AND v_control.last_dispatched_at
          > v_now - make_interval(secs => v_min_interval_seconds) THEN
        RETURN jsonb_build_object(
          'accepted', TRUE,
          'dispatched', FALSE,
          'throttled', TRUE,
          'nextDispatchAt', v_control.last_dispatched_at
            + make_interval(secs => v_min_interval_seconds)
        );
      END IF;

      v_request_id := public.dispatch_personal_analysis_worker();

      UPDATE public.personal_analysis_worker_dispatch_control
      SET last_dispatched_at = v_now,
          last_request_id = v_request_id
      WHERE singleton = TRUE;

      RETURN jsonb_build_object(
        'accepted', TRUE,
        'dispatched', TRUE,
        'throttled', FALSE,
        'requestId', v_request_id
      );
    END;
    $function$
  $ddl$;

  EXECUTE 'REVOKE ALL ON FUNCTION public.request_personal_analysis_worker_dispatch(UUID, INTEGER) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.request_personal_analysis_worker_dispatch(UUID, INTEGER) TO service_role';

  EXECUTE $sql$
    SELECT cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'personal-analysis-worker'
  $sql$;

  EXECUTE $sql$
    SELECT cron.schedule(
      'personal-analysis-worker',
      '* * * * *',
      'SELECT public.request_personal_analysis_worker_dispatch(NULL, 5);'
    )
  $sql$ INTO v_job_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'Immediate personal analysis pg_cron job could not be scheduled';
  END IF;

  NOTIFY pgrst, 'reload schema';
END;
$migration$;

COMMIT;
