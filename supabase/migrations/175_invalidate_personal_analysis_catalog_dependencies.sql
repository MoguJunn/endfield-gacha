-- 175: invalidate private analysis snapshots when referenced catalog rules change.
--
-- Catalog writes are rare and only bump the opaque analysis input revision for
-- owner/scopes whose history references the changed pool/character/alias.
-- Snapshot computation remains asynchronous.

BEGIN;

CREATE OR REPLACE FUNCTION public.invalidate_personal_analysis_dependencies(
  p_pool_ids TEXT[] DEFAULT NULL,
  p_character_ids TEXT[] DEFAULT NULL,
  p_character_names TEXT[] DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_scope_count INTEGER := 0;
  v_owner_count INTEGER := 0;
BEGIN
  -- Keep the same owner -> scope lock order as the history triggers to avoid
  -- catalog/history update deadlocks.
  WITH affected_owners AS (
    SELECT DISTINCT history_row.user_id
    FROM public.history AS history_row
    WHERE history_row.user_id IS NOT NULL
      AND (
        history_row.pool_id = ANY(COALESCE(p_pool_ids, ARRAY[]::TEXT[]))
        OR history_row.character_id = ANY(COALESCE(p_character_ids, ARRAY[]::TEXT[]))
        OR history_row.character_name = ANY(COALESCE(p_character_names, ARRAY[]::TEXT[]))
        OR history_row.item_name = ANY(COALESCE(p_character_names, ARRAY[]::TEXT[]))
      )
  )
  UPDATE public.personal_analysis_owner_state AS state
  SET
    history_revision = state.history_revision + 1,
    dirty_since = COALESCE(state.dirty_since, statement_timestamp()),
    last_error = NULL
  FROM affected_owners AS affected
  WHERE state.user_id = affected.user_id;
  GET DIAGNOSTICS v_owner_count = ROW_COUNT;

  WITH affected_scopes AS (
    SELECT DISTINCT
      history_row.user_id,
      public.normalize_personal_analysis_game_uid(
        history_row.user_id,
        history_row.game_uid
      ) AS scope_game_uid,
      COALESCE(NULLIF(btrim(history_row.server_scope), ''), 'legacy') AS server_scope
    FROM public.history AS history_row
    WHERE history_row.user_id IS NOT NULL
      AND (
        history_row.pool_id = ANY(COALESCE(p_pool_ids, ARRAY[]::TEXT[]))
        OR history_row.character_id = ANY(COALESCE(p_character_ids, ARRAY[]::TEXT[]))
        OR history_row.character_name = ANY(COALESCE(p_character_names, ARRAY[]::TEXT[]))
        OR history_row.item_name = ANY(COALESCE(p_character_names, ARRAY[]::TEXT[]))
      )
  )
  UPDATE public.personal_analysis_scope_state AS state
  SET
    history_revision = state.history_revision + 1,
    dirty_since = COALESCE(state.dirty_since, statement_timestamp()),
    last_error = NULL
  FROM affected_scopes AS affected
  WHERE state.user_id = affected.user_id
    AND state.scope_game_uid = affected.scope_game_uid
    AND state.server_scope = affected.server_scope;
  GET DIAGNOSTICS v_scope_count = ROW_COUNT;

  RETURN v_scope_count + v_owner_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.invalidate_personal_analysis_after_pool_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old_id TEXT := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.pool_id END;
  v_new_id TEXT := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.pool_id END;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    OLD.pool_id,
    OLD.name,
    OLD.name_en,
    OLD.type,
    OLD.locked,
    OLD.up_character,
    OLD.is_limited_weapon,
    OLD.featured_characters,
    OLD.description,
    OLD.banner_url,
    OLD.start_time,
    OLD.end_time
  ) IS NOT DISTINCT FROM (
    NEW.pool_id,
    NEW.name,
    NEW.name_en,
    NEW.type,
    NEW.locked,
    NEW.up_character,
    NEW.is_limited_weapon,
    NEW.featured_characters,
    NEW.description,
    NEW.banner_url,
    NEW.start_time,
    NEW.end_time
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM public.invalidate_personal_analysis_dependencies(
    ARRAY_REMOVE(ARRAY[v_old_id, v_new_id], NULL),
    NULL,
    NULL
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.invalidate_personal_analysis_after_character_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old_id TEXT := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.id::TEXT END;
  v_new_id TEXT := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.id::TEXT END;
  v_old_name TEXT := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.name::TEXT END;
  v_new_name TEXT := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.name::TEXT END;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    OLD.id,
    OLD.name,
    OLD.rarity,
    OLD.type,
    OLD.aliases,
    OLD.is_limited,
    OLD.pool_config
  ) IS NOT DISTINCT FROM (
    NEW.id,
    NEW.name,
    NEW.rarity,
    NEW.type,
    NEW.aliases,
    NEW.is_limited,
    NEW.pool_config
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM public.invalidate_personal_analysis_dependencies(
    NULL,
    ARRAY_REMOVE(ARRAY[v_old_id, v_new_id], NULL),
    ARRAY_REMOVE(ARRAY[v_old_name, v_new_name], NULL)
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.invalidate_personal_analysis_after_pool_alias_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old_alias TEXT := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.alias_id END;
  v_new_alias TEXT := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.alias_id END;
  v_old_pool TEXT := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.pool_id END;
  v_new_pool TEXT := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.pool_id END;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    OLD.source,
    OLD.alias_id,
    OLD.pool_id,
    OLD.is_primary
  ) IS NOT DISTINCT FROM (
    NEW.source,
    NEW.alias_id,
    NEW.pool_id,
    NEW.is_primary
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM public.invalidate_personal_analysis_dependencies(
    ARRAY_REMOVE(ARRAY[v_old_alias, v_new_alias, v_old_pool, v_new_pool], NULL),
    NULL,
    NULL
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.invalidate_personal_analysis_after_character_alias_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old_alias TEXT := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.alias_id END;
  v_new_alias TEXT := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.alias_id END;
  v_old_character TEXT := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.character_id END;
  v_new_character TEXT := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.character_id END;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    OLD.source,
    OLD.alias_id,
    OLD.character_id,
    OLD.is_primary
  ) IS NOT DISTINCT FROM (
    NEW.source,
    NEW.alias_id,
    NEW.character_id,
    NEW.is_primary
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM public.invalidate_personal_analysis_dependencies(
    NULL,
    ARRAY_REMOVE(
      ARRAY[v_old_alias, v_new_alias, v_old_character, v_new_character],
      NULL
    ),
    NULL
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS invalidate_personal_analysis_pool_change ON public.pools;
CREATE TRIGGER invalidate_personal_analysis_pool_change
  AFTER INSERT OR UPDATE OR DELETE ON public.pools
  FOR EACH ROW
  EXECUTE FUNCTION public.invalidate_personal_analysis_after_pool_change();

DROP TRIGGER IF EXISTS invalidate_personal_analysis_character_change ON public.characters;
CREATE TRIGGER invalidate_personal_analysis_character_change
  AFTER INSERT OR UPDATE OR DELETE ON public.characters
  FOR EACH ROW
  EXECUTE FUNCTION public.invalidate_personal_analysis_after_character_change();

DROP TRIGGER IF EXISTS invalidate_personal_analysis_pool_alias_change ON public.pool_id_aliases;
CREATE TRIGGER invalidate_personal_analysis_pool_alias_change
  AFTER INSERT OR UPDATE OR DELETE ON public.pool_id_aliases
  FOR EACH ROW
  EXECUTE FUNCTION public.invalidate_personal_analysis_after_pool_alias_change();

DROP TRIGGER IF EXISTS invalidate_personal_analysis_character_alias_change ON public.character_id_aliases;
CREATE TRIGGER invalidate_personal_analysis_character_alias_change
  AFTER INSERT OR UPDATE OR DELETE ON public.character_id_aliases
  FOR EACH ROW
  EXECUTE FUNCTION public.invalidate_personal_analysis_after_character_alias_change();

REVOKE ALL ON FUNCTION public.invalidate_personal_analysis_dependencies(TEXT[], TEXT[], TEXT[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invalidate_personal_analysis_after_pool_change()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invalidate_personal_analysis_after_character_change()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invalidate_personal_analysis_after_pool_alias_change()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invalidate_personal_analysis_after_character_alias_change()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.invalidate_personal_analysis_dependencies(TEXT[], TEXT[], TEXT[]) IS
  '目录规则改变时只递增引用该目录项的 owner/scope 不透明分析 revision，不同步重算快照。';

COMMIT;

NOTIFY pgrst, 'reload schema';
