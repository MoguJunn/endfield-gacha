-- 173: add owner/account/server scoped revisions for private analysis read models.
--
-- This migration intentionally marks scopes dirty only. It does not calculate
-- analysis JSON in a history write transaction and does not backfill every
-- existing scope inside the migration transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS public.personal_analysis_scope_state (
  user_id UUID NOT NULL
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  scope_game_uid TEXT NOT NULL,
  server_scope TEXT NOT NULL,
  history_revision BIGINT NOT NULL DEFAULT 0,
  snapshot_revision BIGINT NOT NULL DEFAULT -1,
  dirty_since TIMESTAMPTZ,
  computed_at TIMESTAMPTZ,
  analysis_schema_version INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  PRIMARY KEY (user_id, scope_game_uid, server_scope),
  CHECK (btrim(scope_game_uid) <> ''),
  CHECK (btrim(server_scope) <> ''),
  CHECK (history_revision >= 0),
  CHECK (snapshot_revision >= -1),
  CHECK (snapshot_revision <= history_revision),
  CHECK (analysis_schema_version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_personal_analysis_scope_state_dirty
  ON public.personal_analysis_scope_state (dirty_since, user_id)
  WHERE snapshot_revision < history_revision;

ALTER TABLE public.personal_analysis_scope_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.personal_analysis_scope_state
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.personal_analysis_scope_state
  TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON TABLE public.personal_analysis_scope_state
  TO service_role;

DROP POLICY IF EXISTS personal_analysis_scope_state_select_own
  ON public.personal_analysis_scope_state;
CREATE POLICY personal_analysis_scope_state_select_own
  ON public.personal_analysis_scope_state
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS personal_analysis_scope_state_active_session
  ON public.personal_analysis_scope_state;
CREATE POLICY personal_analysis_scope_state_active_session
  ON public.personal_analysis_scope_state
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (public.is_request_auth_session_allowed());

CREATE OR REPLACE FUNCTION public.normalize_personal_analysis_game_uid(
  p_user_id UUID,
  p_game_uid TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    NULLIF(btrim(p_game_uid), ''),
    'legacy'
  );
$$;

CREATE OR REPLACE FUNCTION public.mark_personal_analysis_scopes_dirty_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.personal_analysis_scope_state (
    user_id,
    scope_game_uid,
    server_scope,
    history_revision,
    snapshot_revision,
    dirty_since,
    analysis_schema_version,
    last_error
  )
  SELECT DISTINCT
    row_data.user_id,
    public.normalize_personal_analysis_game_uid(row_data.user_id, row_data.game_uid),
    COALESCE(NULLIF(btrim(row_data.server_scope), ''), 'legacy'),
    1,
    -1,
    statement_timestamp(),
    1,
    NULL
  FROM new_history_rows AS row_data
  WHERE row_data.user_id IS NOT NULL
  ORDER BY 1, 2, 3
  ON CONFLICT (user_id, scope_game_uid, server_scope)
  DO UPDATE SET
    history_revision = public.personal_analysis_scope_state.history_revision + 1,
    dirty_since = COALESCE(
      public.personal_analysis_scope_state.dirty_since,
      EXCLUDED.dirty_since
    ),
    last_error = NULL;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_personal_analysis_scopes_dirty_after_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.personal_analysis_scope_state (
    user_id,
    scope_game_uid,
    server_scope,
    history_revision,
    snapshot_revision,
    dirty_since,
    analysis_schema_version,
    last_error
  )
  SELECT DISTINCT
    row_data.user_id,
    public.normalize_personal_analysis_game_uid(row_data.user_id, row_data.game_uid),
    COALESCE(NULLIF(btrim(row_data.server_scope), ''), 'legacy'),
    1,
    -1,
    statement_timestamp(),
    1,
    NULL
  FROM old_history_rows AS row_data
  WHERE row_data.user_id IS NOT NULL
    -- A profile/auth-user cascade must remove state, not recreate it after
    -- the parent row has already disappeared.
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = row_data.user_id
    )
  ORDER BY 1, 2, 3
  ON CONFLICT (user_id, scope_game_uid, server_scope)
  DO UPDATE SET
    history_revision = public.personal_analysis_scope_state.history_revision + 1,
    dirty_since = COALESCE(
      public.personal_analysis_scope_state.dirty_since,
      EXCLUDED.dirty_since
    ),
    last_error = NULL;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_personal_analysis_scopes_dirty_after_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  WITH changed_rows AS (
    SELECT
      old_row.user_id AS old_user_id,
      old_row.record_id AS old_record_id,
      new_row.user_id AS new_user_id,
      new_row.record_id AS new_record_id
    FROM old_history_rows AS old_row
    FULL OUTER JOIN new_history_rows AS new_row
      ON new_row.user_id = old_row.user_id
     AND new_row.record_id = old_row.record_id
    WHERE (
      to_jsonb(old_row) - ARRAY['batch_id', 'updated_at']::TEXT[]
    ) IS DISTINCT FROM (
      to_jsonb(new_row) - ARRAY['batch_id', 'updated_at']::TEXT[]
    )
  ),
  affected_scopes AS (
    SELECT
      old_row.user_id,
      public.normalize_personal_analysis_game_uid(old_row.user_id, old_row.game_uid) AS scope_game_uid,
      COALESCE(NULLIF(btrim(old_row.server_scope), ''), 'legacy') AS server_scope
    FROM old_history_rows AS old_row
    JOIN changed_rows AS changed
      ON changed.old_user_id = old_row.user_id
     AND changed.old_record_id = old_row.record_id
    WHERE old_row.user_id IS NOT NULL

    UNION

    SELECT
      new_row.user_id,
      public.normalize_personal_analysis_game_uid(new_row.user_id, new_row.game_uid) AS scope_game_uid,
      COALESCE(NULLIF(btrim(new_row.server_scope), ''), 'legacy') AS server_scope
    FROM new_history_rows AS new_row
    JOIN changed_rows AS changed
      ON changed.new_user_id = new_row.user_id
     AND changed.new_record_id = new_row.record_id
    WHERE new_row.user_id IS NOT NULL
  )
  INSERT INTO public.personal_analysis_scope_state (
    user_id,
    scope_game_uid,
    server_scope,
    history_revision,
    snapshot_revision,
    dirty_since,
    analysis_schema_version,
    last_error
  )
  SELECT
    affected.user_id,
    affected.scope_game_uid,
    affected.server_scope,
    1,
    -1,
    statement_timestamp(),
    1,
    NULL
  FROM affected_scopes AS affected
  ORDER BY 1, 2, 3
  ON CONFLICT (user_id, scope_game_uid, server_scope)
  DO UPDATE SET
    history_revision = public.personal_analysis_scope_state.history_revision + 1,
    dirty_since = COALESCE(
      public.personal_analysis_scope_state.dirty_since,
      EXCLUDED.dirty_since
    ),
    last_error = NULL;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS mark_personal_analysis_scopes_dirty_insert
  ON public.history;
CREATE TRIGGER mark_personal_analysis_scopes_dirty_insert
  AFTER INSERT ON public.history
  REFERENCING NEW TABLE AS new_history_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.mark_personal_analysis_scopes_dirty_after_insert();

DROP TRIGGER IF EXISTS mark_personal_analysis_scopes_dirty_delete
  ON public.history;
CREATE TRIGGER mark_personal_analysis_scopes_dirty_delete
  AFTER DELETE ON public.history
  REFERENCING OLD TABLE AS old_history_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.mark_personal_analysis_scopes_dirty_after_delete();

DROP TRIGGER IF EXISTS mark_personal_analysis_scopes_dirty_update
  ON public.history;
CREATE TRIGGER mark_personal_analysis_scopes_dirty_update
  AFTER UPDATE ON public.history
  REFERENCING OLD TABLE AS old_history_rows NEW TABLE AS new_history_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.mark_personal_analysis_scopes_dirty_after_update();

REVOKE ALL ON FUNCTION public.normalize_personal_analysis_game_uid(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_personal_analysis_game_uid(UUID, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_personal_analysis_scopes_dirty_after_insert()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_personal_analysis_scopes_dirty_after_delete()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_personal_analysis_scopes_dirty_after_update()
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.personal_analysis_scope_state IS
  '私有分析读模型的用户、游戏账号与区服级版本/失效状态；不保存原始抽卡明细。';

COMMENT ON COLUMN public.personal_analysis_scope_state.history_revision IS
  '分析输入发生变更时递增的不透明单调令牌；不要将数值解释为写入次数。混合 UPSERT 可同时触发 INSERT/UPDATE 事件并递增多次。';

COMMENT ON COLUMN public.personal_analysis_scope_state.snapshot_revision IS
  '最近一次成功发布的分析快照对应 history_revision；小于 history_revision 时视为过期。';

COMMENT ON FUNCTION public.mark_personal_analysis_scopes_dirty_after_update() IS
  '仅当除 batch_id、updated_at 外的 history 输入变化时，失效 OLD/NEW 两侧 scope；pity 会进入分析快照，因此必须失效。';

COMMIT;

NOTIFY pgrst, 'reload schema';
