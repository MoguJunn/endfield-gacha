-- 180: do not let a cron dispatch that happened before an active user's
-- priority request throttle that user's immediate worker wake-up.

BEGIN;

DO $migration$
BEGIN
  IF to_regprocedure(
    'public.request_personal_analysis_worker_dispatch(uuid,integer)'
  ) IS NULL THEN
    RAISE NOTICE 'Skipping priority-aware dispatch: migration 179 is unavailable';
    RETURN;
  END IF;

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
      v_user_priority_at TIMESTAMPTZ;
    BEGIN
      IF p_user_id IS NOT NULL THEN
        SELECT
          EXISTS (
            SELECT 1
            FROM public.personal_analysis_owner_state AS owner_state
            WHERE owner_state.user_id = p_user_id
              AND owner_state.snapshot_revision < owner_state.history_revision

            UNION ALL

            SELECT 1
            FROM public.personal_analysis_scope_state AS scope_state
            WHERE scope_state.user_id = p_user_id
              AND scope_state.snapshot_revision < scope_state.history_revision
          ),
          LEAST(
            (
              SELECT owner_state.priority_requested_at
              FROM public.personal_analysis_owner_state AS owner_state
              WHERE owner_state.user_id = p_user_id
                AND owner_state.snapshot_revision < owner_state.history_revision
            ),
            (
              SELECT min(scope_state.priority_requested_at)
              FROM public.personal_analysis_scope_state AS scope_state
              WHERE scope_state.user_id = p_user_id
                AND scope_state.snapshot_revision < scope_state.history_revision
            )
          )
        INTO v_has_pending_job, v_user_priority_at;
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
          > v_now - make_interval(secs => v_min_interval_seconds)
        AND (
          p_user_id IS NULL
          OR v_user_priority_at IS NULL
          OR v_control.last_dispatched_at >= v_user_priority_at
        ) THEN
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

  NOTIFY pgrst, 'reload schema';
END;
$migration$;

COMMIT;
