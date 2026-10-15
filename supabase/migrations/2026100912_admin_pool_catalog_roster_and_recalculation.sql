-- 2026100912: explicit roster completeness and preview-guarded global recalculation.
-- No history/entity roster is rewritten by applying this migration.
BEGIN;

ALTER TABLE public.pools ADD COLUMN roster_status TEXT NOT NULL DEFAULT 'missing'
  CHECK (roster_status IN ('missing', 'partial', 'complete'));
UPDATE public.pools p SET roster_status = 'partial'
WHERE EXISTS (SELECT 1 FROM public.pool_characters pc WHERE pc.pool_id = p.pool_id);
COMMENT ON COLUMN public.pools.roster_status IS
  '名单核对状态：missing 缺失、partial 不完整、complete 超管明确确认完整；非空不代表完整。';
GRANT SELECT (roster_status) ON public.pools TO anon, authenticated;

CREATE FUNCTION public.guard_pool_roster_confirmation() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.roster_status = 'complete' AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'only super_admin can confirm a complete pool roster';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.roster_status = 'complete' AND
    ROW(NEW.type, NEW.up_character, NEW.featured_characters, NEW.start_time, NEW.end_time,
      NEW.extra_subtype, NEW.extra_rule_profile, NEW.extra_series_key, NEW.extra_series_phase)
    IS DISTINCT FROM
    ROW(OLD.type, OLD.up_character, OLD.featured_characters, OLD.start_time, OLD.end_time,
      OLD.extra_subtype, OLD.extra_rule_profile, OLD.extra_series_key, OLD.extra_series_phase) THEN
    NEW.roster_status := 'partial';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_pool_roster_confirmation
BEFORE INSERT OR UPDATE ON public.pools FOR EACH ROW
EXECUTE FUNCTION public.guard_pool_roster_confirmation();

CREATE FUNCTION public.invalidate_changed_pool_roster() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pool_id TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.pool_id IS DISTINCT FROM NEW.pool_id THEN
    UPDATE public.pools SET roster_status = CASE WHEN EXISTS (
      SELECT 1 FROM public.pool_characters WHERE pool_id = OLD.pool_id
    ) THEN 'partial' ELSE 'missing' END WHERE pool_id = OLD.pool_id;
  END IF;
  v_pool_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.pool_id ELSE NEW.pool_id END;
  UPDATE public.pools SET roster_status = CASE WHEN EXISTS (
    SELECT 1 FROM public.pool_characters WHERE pool_id = v_pool_id
  ) THEN 'partial' ELSE 'missing' END WHERE pool_id = v_pool_id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER invalidate_changed_pool_roster
AFTER INSERT OR UPDATE OR DELETE ON public.pool_characters FOR EACH ROW
EXECUTE FUNCTION public.invalidate_changed_pool_roster();

CREATE FUNCTION public.admin_pool_catalog_bump_cache(p_scope TEXT DEFAULT 'pools') RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.site_config (key, value, label, category, updated_at)
  VALUES ('public_cache_epoch', jsonb_build_object(
    'version', gen_random_uuid()::TEXT, 'scope', p_scope,
    'reason', 'admin:pool:catalog', 'updatedAt', clock_timestamp()
  )::TEXT, '公共缓存版本', 'system', NOW())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
$$;
REVOKE ALL ON FUNCTION public.admin_pool_catalog_bump_cache(TEXT) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.admin_save_pool_catalog(
  p_pool_id TEXT, p_insert_payload JSONB, p_update_payload JSONB,
  p_alias_rows JSONB, p_pool_character_rows JSONB, p_actor_user_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  -- The existing alias RPC can reassign aliases. Catalog edits must not silently
  -- move a canonical/self alias away from another pool, including concurrent saves.
  LOCK TABLE public.pool_id_aliases IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_alias_rows) r
    JOIN public.pool_id_aliases a ON a.source = BTRIM(r->>'source')
      AND a.alias_id = BTRIM(r->>'alias_id')
    WHERE a.pool_id <> p_pool_id
  ) THEN RAISE EXCEPTION 'pool_alias_conflict'; END IF;
  -- Existing RPC preserves special-pool metadata, owner and alias behavior.
  PERFORM public.admin_upsert_pool_with_aliases(
    p_pool_id, p_insert_payload, p_update_payload, p_alias_rows, '[]'::JSONB, p_actor_user_id
  );
  DELETE FROM public.pool_characters WHERE pool_id = p_pool_id;
  INSERT INTO public.pool_characters (pool_id, character_id, is_up)
  SELECT p_pool_id, r->>'character_id', COALESCE((r->>'is_up')::BOOLEAN, FALSE)
  FROM jsonb_array_elements(p_pool_character_rows) r;
  v_status := COALESCE(p_update_payload->>'roster_status', p_insert_payload->>'roster_status',
    CASE WHEN jsonb_array_length(p_pool_character_rows) > 0 THEN 'partial' ELSE 'missing' END);
  IF (v_status = 'missing') IS DISTINCT FROM (jsonb_array_length(p_pool_character_rows) = 0) THEN
    RAISE EXCEPTION 'pool_roster_status_mismatch';
  END IF;
  IF v_status = 'complete' AND NOT EXISTS (
    SELECT 1 FROM public.pool_characters pc JOIN public.characters c ON c.id = pc.character_id
    WHERE pc.pool_id = p_pool_id AND c.rarity = 6
  ) THEN RAISE EXCEPTION 'complete roster requires six-star entities'; END IF;
  UPDATE public.pools SET roster_status = v_status, updated_at = NOW() WHERE pool_id = p_pool_id;
  -- This succeeds or rolls back together with the catalog and roster save.
  PERFORM public.admin_pool_catalog_bump_cache();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_save_pool_catalog(TEXT, JSONB, JSONB, JSONB, JSONB, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_pool_catalog(TEXT, JSONB, JSONB, JSONB, JSONB, UUID) TO service_role;

-- Preserve the existing visibility/ranking rules and public field allowlist.
DROP FUNCTION public.get_app_visible_pools();
CREATE FUNCTION public.get_app_visible_pools()
RETURNS TABLE (
  pool_id TEXT, name TEXT, name_en TEXT, type TEXT, extra_subtype TEXT,
  extra_rule_profile TEXT, extra_series_key TEXT, extra_series_phase INTEGER,
  locked BOOLEAN, is_limited_weapon BOOLEAN, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
  up_character TEXT, description TEXT, banner_url TEXT, start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ, featured_characters TEXT[], roster_status TEXT
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH visible AS (
    SELECT p.*, ROW_NUMBER() OVER (PARTITION BY p.pool_id ORDER BY
      (CASE WHEN NULLIF(BTRIM(COALESCE(p.up_character, '')), '') IS NOT NULL THEN 4 ELSE 0 END +
       CASE WHEN p.start_time IS NOT NULL THEN 2 ELSE 0 END +
       CASE WHEN p.end_time IS NOT NULL THEN 2 ELSE 0 END +
       CASE WHEN COALESCE(array_length(p.featured_characters, 1), 0) > 0 THEN 1 ELSE 0 END +
       CASE WHEN NULLIF(BTRIM(COALESCE(p.banner_url, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
       CASE WHEN NULLIF(BTRIM(COALESCE(p.description, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
       CASE WHEN NULLIF(BTRIM(COALESCE(p.name_en, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
       CASE WHEN p.locked THEN 1 ELSE 0 END) DESC,
      CASE WHEN p.user_id = auth.uid() THEN 1 ELSE 0 END DESC,
      COALESCE(p.start_time, p.updated_at, p.created_at, to_timestamp(0)) DESC,
      COALESCE(p.updated_at, p.created_at, to_timestamp(0)) DESC
    ) AS row_rank
    FROM public.pools p WHERE p.pool_id IN ('standard', 'beginner')
      OR split_part(p.pool_id, '_', 1) IN ('special', 'weponbox', 'weaponbox')
      OR p.user_id IS NULL OR p.user_id = auth.uid() OR p.locked = TRUE
      OR EXISTS (SELECT 1 FROM public.profiles owner_profile
        WHERE owner_profile.id = p.user_id AND owner_profile.role IN ('admin', 'super_admin'))
  ) SELECT pool_id, name, name_en, type, extra_subtype, extra_rule_profile,
    extra_series_key, extra_series_phase, locked, is_limited_weapon, created_at, updated_at,
    up_character, description, banner_url, start_time, end_time, featured_characters, roster_status
  FROM visible WHERE row_rank = 1
  ORDER BY COALESCE(start_time, created_at, updated_at, to_timestamp(0)) DESC, pool_id ASC;
$$;
GRANT EXECUTE ON FUNCTION public.get_app_visible_pools() TO anon, authenticated, service_role;

-- A single JSON snapshot bypasses REST row limits. Only the trusted API sees
-- record identities; the browser receives counts, affected pool IDs and a token.
CREATE FUNCTION public.admin_pool_recalculation_snapshot() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_snapshot JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role required'; END IF;
  SELECT jsonb_build_object(
    'pools', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.pool_id) FROM (
      SELECT p.pool_id, p.type, COALESCE(c.name, p.up_character) AS up_character,
        c.id AS up_character_id, to_jsonb(c.aliases) AS up_character_aliases,
        p.extra_subtype, p.extra_rule_profile, p.extra_series_key, p.extra_series_phase
      FROM public.pools p LEFT JOIN LATERAL (
        SELECT c.id, c.name, c.aliases FROM public.characters c
        WHERE (c.id = p.up_character OR c.name = p.up_character) AND c.rarity = 6
          AND c.type = CASE WHEN p.type = 'weapon' OR p.extra_rule_profile = 'reconstruction_weapon_v1'
            THEN 'weapon' ELSE 'character' END
        ORDER BY (c.id = p.up_character) DESC, c.id LIMIT 1
      ) c ON TRUE
    ) p), '[]'::JSONB),
    'records', COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.user_id, h.id, h.record_id) FROM (
      SELECT id::TEXT, user_id, game_uid, server_id, record_id, pool_id,
        rarity, character_id, character_name, item_name, is_standard FROM public.history WHERE rarity = 6
    ) h), '[]'::JSONB)
  ) INTO v_snapshot;
  RETURN v_snapshot || jsonb_build_object('previewToken', md5(v_snapshot::TEXT));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_pool_recalculation_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_pool_recalculation_snapshot() TO service_role;

CREATE FUNCTION public.admin_apply_pool_recalculation(p_preview_token TEXT, p_updates JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
SET lock_timeout = '5s' SET statement_timeout = '50s' AS $$
DECLARE v_snapshot JSONB; v_changed INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role required'; END IF;
  IF p_preview_token IS NULL OR jsonb_typeof(p_updates) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'recalculate_preview_required';
  END IF;
  -- Prevent inserts, deletes or catalog edits between token comparison and UPDATE.
  -- Locks exist only during this transaction, never while awaiting confirmation.
  LOCK TABLE public.pools IN SHARE MODE;
  LOCK TABLE public.characters IN SHARE MODE;
  LOCK TABLE public.history IN SHARE ROW EXCLUSIVE MODE;
  v_snapshot := public.admin_pool_recalculation_snapshot();
  IF v_snapshot->>'previewToken' IS DISTINCT FROM p_preview_token THEN
    RAISE EXCEPTION 'recalculate_preview_stale';
  END IF;
  UPDATE public.history h SET is_standard = (u->>'is_standard')::BOOLEAN
  FROM jsonb_array_elements(p_updates) u
  WHERE h.id = (u->>'id')::BIGINT AND h.user_id = (u->>'user_id')::UUID
    AND h.record_id = u->>'record_id' AND h.pool_id = u->>'pool_id'
    AND h.game_uid IS NOT DISTINCT FROM (u->>'game_uid')
    AND h.server_id IS NOT DISTINCT FROM (u->>'server_id')
    AND h.rarity = 6 AND jsonb_typeof(u->'is_standard') = 'boolean'
    AND h.is_standard IS DISTINCT FROM (u->>'is_standard')::BOOLEAN;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> jsonb_array_length(p_updates) THEN
    RAISE EXCEPTION 'recalculate_scope_mismatch';
  END IF;
  IF v_changed > 0 THEN PERFORM public.admin_pool_catalog_bump_cache('stats'); END IF;
  RETURN v_changed;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_apply_pool_recalculation(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_apply_pool_recalculation(TEXT, JSONB) TO service_role;
COMMIT;
