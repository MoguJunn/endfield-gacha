-- 179: split reconstruction weapon claims into their own product subtype.

ALTER TABLE public.pools
  DROP CONSTRAINT IF EXISTS pools_extra_subtype_check,
  DROP CONSTRAINT IF EXISTS pools_extra_rule_profile_check,
  DROP CONSTRAINT IF EXISTS pools_extra_metadata_contract_check;

CREATE OR REPLACE FUNCTION public.canonicalize_reconstruction_claim_subtype()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.type = 'extra'
    AND NEW.extra_subtype = 'reconstruction'
    AND NEW.extra_rule_profile = 'reconstruction_weapon_v1' THEN
    NEW.extra_subtype := 'reconstruction_claim';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canonicalize_reconstruction_claim_subtype_trigger ON public.pools;
CREATE TRIGGER canonicalize_reconstruction_claim_subtype_trigger
  BEFORE INSERT OR UPDATE ON public.pools
  FOR EACH ROW
  EXECUTE FUNCTION public.canonicalize_reconstruction_claim_subtype();

UPDATE public.pools
SET
  extra_subtype = 'reconstruction_claim',
  updated_at = NOW()
WHERE type = 'extra'
  AND extra_subtype = 'reconstruction'
  AND extra_rule_profile = 'reconstruction_weapon_v1';

ALTER TABLE public.pools
  ADD CONSTRAINT pools_extra_subtype_check CHECK (
    extra_subtype IS NULL
    OR extra_subtype IN ('reconstruction', 'reconstruction_claim', 'special')
  ),
  ADD CONSTRAINT pools_extra_rule_profile_check CHECK (
    extra_rule_profile IS NULL
    OR extra_rule_profile IN (
      'reconstruction_character_v1',
      'reconstruction_weapon_v1',
      'brilliance_festival_v1'
    )
  ),
  ADD CONSTRAINT pools_extra_metadata_contract_check CHECK ((
    (
      type <> 'extra'
      AND extra_subtype IS NULL
      AND extra_rule_profile IS NULL
      AND extra_series_key IS NULL
      AND extra_series_phase IS NULL
    )
    OR (
      type = 'extra'
      AND (
        (
          extra_subtype IS NULL
          AND extra_rule_profile IS NULL
          AND extra_series_key IS NULL
          AND extra_series_phase IS NULL
        )
        OR (
          extra_subtype = 'special'
          AND extra_rule_profile = 'brilliance_festival_v1'
          AND extra_series_key IS NULL
          AND extra_series_phase IS NULL
        )
        OR (
          extra_subtype = 'reconstruction'
          AND extra_rule_profile = 'reconstruction_character_v1'
          AND NULLIF(BTRIM(extra_series_key), '') IS NOT NULL
          AND extra_series_phase > 0
        )
        OR (
          extra_subtype = 'reconstruction_claim'
          AND extra_rule_profile = 'reconstruction_weapon_v1'
          AND NULLIF(BTRIM(extra_series_key), '') IS NOT NULL
          AND extra_series_phase > 0
        )
      )
    )
  ) IS TRUE);

COMMENT ON COLUMN public.pools.extra_subtype IS
  '附加寻访产品子类：reconstruction（重构寻访）、reconstruction_claim（重构申领）或 special（特殊寻访）；可为空表示未分类。';

-- Rebuild only the JSON overload. The legacy positional overload from 177 is
-- intentionally preserved so old callers can still write unclassified extras.
CREATE OR REPLACE FUNCTION public.admin_upsert_pool_with_aliases(
  p_pool_id TEXT,
  p_insert_payload JSONB,
  p_update_payload JSONB DEFAULT '{}'::jsonb,
  p_alias_rows JSONB DEFAULT '[]'::jsonb,
  p_pool_character_rows JSONB DEFAULT '[]'::jsonb,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id UUID;
  v_pool_type TEXT;
  v_extra_subtype TEXT;
  v_extra_rule_profile TEXT;
  v_extra_series_key TEXT;
  v_extra_series_phase_text TEXT;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'only super_admin can manage pools';
  END IF;

  IF COALESCE(BTRIM(p_pool_id), '') = '' THEN
    RAISE EXCEPTION 'p_pool_id is required';
  END IF;

  IF p_insert_payload IS NULL OR jsonb_typeof(p_insert_payload) <> 'object' THEN
    RAISE EXCEPTION 'p_insert_payload must be a JSON object';
  END IF;

  IF p_update_payload IS NULL THEN
    p_update_payload := '{}'::jsonb;
  END IF;
  IF jsonb_typeof(p_update_payload) <> 'object' THEN
    RAISE EXCEPTION 'p_update_payload must be a JSON object';
  END IF;

  IF p_alias_rows IS NULL THEN
    p_alias_rows := '[]'::jsonb;
  END IF;
  IF jsonb_typeof(p_alias_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_alias_rows must be a JSON array';
  END IF;

  IF p_pool_character_rows IS NULL THEN
    p_pool_character_rows := '[]'::jsonb;
  END IF;
  IF jsonb_typeof(p_pool_character_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_pool_character_rows must be a JSON array';
  END IF;

  v_pool_type := COALESCE(NULLIF(BTRIM(p_insert_payload->>'type'), ''), 'limited');
  v_extra_subtype := NULLIF(BTRIM(p_insert_payload->>'extra_subtype'), '');
  v_extra_rule_profile := NULLIF(BTRIM(p_insert_payload->>'extra_rule_profile'), '');
  v_extra_series_key := NULLIF(BTRIM(p_insert_payload->>'extra_series_key'), '');
  v_extra_series_phase_text := NULLIF(BTRIM(p_insert_payload->>'extra_series_phase'), '');

  IF v_pool_type = 'extra'
    AND v_extra_subtype = 'reconstruction'
    AND v_extra_rule_profile = 'reconstruction_weapon_v1' THEN
    v_extra_subtype := 'reconstruction_claim';
    p_insert_payload := jsonb_set(
      p_insert_payload,
      '{extra_subtype}',
      to_jsonb(v_extra_subtype),
      TRUE
    );
  END IF;

  IF COALESCE(NULLIF(BTRIM(p_update_payload->>'type'), ''), v_pool_type) = 'extra'
    AND COALESCE(NULLIF(BTRIM(p_update_payload->>'extra_subtype'), ''), v_extra_subtype) = 'reconstruction'
    AND COALESCE(NULLIF(BTRIM(p_update_payload->>'extra_rule_profile'), ''), v_extra_rule_profile) = 'reconstruction_weapon_v1' THEN
    p_update_payload := jsonb_set(
      p_update_payload,
      '{extra_subtype}',
      to_jsonb('reconstruction_claim'::TEXT),
      TRUE
    );
  END IF;

  IF v_pool_type <> 'extra' THEN
    IF v_extra_subtype IS NOT NULL
      OR v_extra_rule_profile IS NOT NULL
      OR v_extra_series_key IS NOT NULL
      OR v_extra_series_phase_text IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'extra_pool_fields_not_allowed';
    END IF;
  ELSIF v_extra_subtype = 'special' THEN
    IF v_extra_rule_profile IS DISTINCT FROM 'brilliance_festival_v1'
      OR v_extra_series_key IS NOT NULL
      OR v_extra_series_phase_text IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'brilliance_pool_metadata_invalid';
    END IF;
  ELSIF v_extra_subtype = 'reconstruction' THEN
    IF v_extra_rule_profile IS DISTINCT FROM 'reconstruction_character_v1'
      OR v_extra_series_key IS NULL
      OR v_extra_series_phase_text !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconstruction_pool_metadata_invalid';
    END IF;
  ELSIF v_extra_subtype = 'reconstruction_claim' THEN
    IF v_extra_rule_profile IS DISTINCT FROM 'reconstruction_weapon_v1'
      OR v_extra_series_key IS NULL
      OR v_extra_series_phase_text !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconstruction_claim_pool_metadata_invalid';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'extra_pool_template_required';
  END IF;

  v_actor_user_id := COALESCE(
    p_actor_user_id,
    CASE
      WHEN COALESCE(BTRIM(p_insert_payload->>'user_id'), '') <> ''
      THEN BTRIM(p_insert_payload->>'user_id')::UUID
      ELSE NULL
    END,
    auth.uid()
  );

  IF v_actor_user_id IS NULL AND auth.role() = 'service_role' THEN
    SELECT id
      INTO v_actor_user_id
      FROM public.profiles
     WHERE role = 'super_admin'
     ORDER BY created_at ASC NULLS LAST, id ASC
     LIMIT 1;
  END IF;

  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'pool owner is required';
  END IF;

  INSERT INTO public.pools (
    user_id,
    pool_id,
    name,
    name_en,
    type,
    extra_subtype,
    extra_rule_profile,
    extra_series_key,
    extra_series_phase,
    locked,
    is_limited_weapon,
    description,
    start_time,
    end_time,
    banner_url,
    featured_characters,
    up_character
  )
  VALUES (
    v_actor_user_id,
    BTRIM(p_pool_id),
    BTRIM(p_insert_payload->>'name'),
    NULLIF(BTRIM(p_insert_payload->>'name_en'), ''),
    COALESCE(NULLIF(BTRIM(p_insert_payload->>'type'), ''), 'limited'),
    NULLIF(BTRIM(p_insert_payload->>'extra_subtype'), ''),
    NULLIF(BTRIM(p_insert_payload->>'extra_rule_profile'), ''),
    NULLIF(BTRIM(p_insert_payload->>'extra_series_key'), ''),
    NULLIF(BTRIM(p_insert_payload->>'extra_series_phase'), '')::INTEGER,
    COALESCE((p_insert_payload->>'locked')::BOOLEAN, FALSE),
    CASE
      WHEN p_insert_payload ? 'is_limited_weapon'
        AND jsonb_typeof(p_insert_payload->'is_limited_weapon') = 'boolean'
      THEN (p_insert_payload->>'is_limited_weapon')::BOOLEAN
      ELSE NULL
    END,
    NULLIF(BTRIM(p_insert_payload->>'description'), ''),
    NULLIF(BTRIM(p_insert_payload->>'start_time'), '')::TIMESTAMPTZ,
    NULLIF(BTRIM(p_insert_payload->>'end_time'), '')::TIMESTAMPTZ,
    NULLIF(BTRIM(p_insert_payload->>'banner_url'), ''),
    CASE
      WHEN p_insert_payload ? 'featured_characters'
        AND jsonb_typeof(p_insert_payload->'featured_characters') = 'array'
      THEN ARRAY(
        SELECT jsonb_array_elements_text(p_insert_payload->'featured_characters')
      )
      ELSE NULL
    END,
    NULLIF(BTRIM(p_insert_payload->>'up_character'), '')
  )
  ON CONFLICT (pool_id) DO UPDATE
  SET
    name = CASE
      WHEN p_update_payload ? 'name'
      THEN COALESCE(NULLIF(BTRIM(p_update_payload->>'name'), ''), public.pools.name)
      ELSE public.pools.name
    END,
    name_en = CASE
      WHEN p_update_payload ? 'name_en'
      THEN NULLIF(BTRIM(p_update_payload->>'name_en'), '')
      ELSE public.pools.name_en
    END,
    type = CASE
      WHEN p_update_payload ? 'type'
      THEN COALESCE(NULLIF(BTRIM(p_update_payload->>'type'), ''), public.pools.type)
      ELSE public.pools.type
    END,
    extra_subtype = CASE
      WHEN p_update_payload ? 'extra_subtype'
      THEN NULLIF(BTRIM(p_update_payload->>'extra_subtype'), '')
      ELSE public.pools.extra_subtype
    END,
    extra_rule_profile = CASE
      WHEN p_update_payload ? 'extra_rule_profile'
      THEN NULLIF(BTRIM(p_update_payload->>'extra_rule_profile'), '')
      ELSE public.pools.extra_rule_profile
    END,
    extra_series_key = CASE
      WHEN p_update_payload ? 'extra_series_key'
      THEN NULLIF(BTRIM(p_update_payload->>'extra_series_key'), '')
      ELSE public.pools.extra_series_key
    END,
    extra_series_phase = CASE
      WHEN p_update_payload ? 'extra_series_phase'
      THEN NULLIF(BTRIM(p_update_payload->>'extra_series_phase'), '')::INTEGER
      ELSE public.pools.extra_series_phase
    END,
    locked = CASE
      WHEN p_update_payload ? 'locked'
        AND jsonb_typeof(p_update_payload->'locked') = 'boolean'
      THEN (p_update_payload->>'locked')::BOOLEAN
      ELSE public.pools.locked
    END,
    is_limited_weapon = CASE
      WHEN p_update_payload ? 'is_limited_weapon'
        AND jsonb_typeof(p_update_payload->'is_limited_weapon') = 'boolean'
      THEN (p_update_payload->>'is_limited_weapon')::BOOLEAN
      WHEN p_update_payload ? 'is_limited_weapon'
        AND jsonb_typeof(p_update_payload->'is_limited_weapon') = 'null'
      THEN NULL
      ELSE public.pools.is_limited_weapon
    END,
    description = CASE
      WHEN p_update_payload ? 'description'
      THEN NULLIF(BTRIM(p_update_payload->>'description'), '')
      ELSE public.pools.description
    END,
    start_time = CASE
      WHEN p_update_payload ? 'start_time'
      THEN NULLIF(BTRIM(p_update_payload->>'start_time'), '')::TIMESTAMPTZ
      ELSE public.pools.start_time
    END,
    end_time = CASE
      WHEN p_update_payload ? 'end_time'
      THEN NULLIF(BTRIM(p_update_payload->>'end_time'), '')::TIMESTAMPTZ
      ELSE public.pools.end_time
    END,
    banner_url = CASE
      WHEN p_update_payload ? 'banner_url'
      THEN NULLIF(BTRIM(p_update_payload->>'banner_url'), '')
      ELSE public.pools.banner_url
    END,
    featured_characters = CASE
      WHEN p_update_payload ? 'featured_characters'
        AND jsonb_typeof(p_update_payload->'featured_characters') = 'array'
      THEN ARRAY(
        SELECT jsonb_array_elements_text(p_update_payload->'featured_characters')
      )
      WHEN p_update_payload ? 'featured_characters'
        AND jsonb_typeof(p_update_payload->'featured_characters') = 'null'
      THEN NULL
      ELSE public.pools.featured_characters
    END,
    up_character = CASE
      WHEN p_update_payload ? 'up_character'
      THEN NULLIF(BTRIM(p_update_payload->>'up_character'), '')
      ELSE public.pools.up_character
    END;

  INSERT INTO public.pool_id_aliases (
    source,
    alias_id,
    pool_id,
    is_primary,
    note
  )
  SELECT
    BTRIM(alias_entry.value->>'source'),
    BTRIM(alias_entry.value->>'alias_id'),
    BTRIM(p_pool_id),
    COALESCE((alias_entry.value->>'is_primary')::BOOLEAN, FALSE),
    NULLIF(BTRIM(alias_entry.value->>'note'), '')
  FROM jsonb_array_elements(p_alias_rows) AS alias_entry(value)
  WHERE
    jsonb_typeof(alias_entry.value) = 'object'
    AND COALESCE(BTRIM(alias_entry.value->>'source'), '') <> ''
    AND COALESCE(BTRIM(alias_entry.value->>'alias_id'), '') <> ''
  ON CONFLICT (source, alias_id) DO UPDATE
  SET
    pool_id = EXCLUDED.pool_id,
    is_primary = EXCLUDED.is_primary,
    note = EXCLUDED.note,
    updated_at = NOW();

  IF jsonb_array_length(p_pool_character_rows) > 0 THEN
    DELETE FROM public.pool_characters
    WHERE pool_id = BTRIM(p_pool_id);

    INSERT INTO public.pool_characters (
      pool_id,
      character_id,
      is_up
    )
    SELECT
      BTRIM(p_pool_id),
      BTRIM(character_entry.value->>'character_id'),
      COALESCE((character_entry.value->>'is_up')::BOOLEAN, FALSE)
    FROM jsonb_array_elements(p_pool_character_rows) AS character_entry(value)
    WHERE
      jsonb_typeof(character_entry.value) = 'object'
      AND COALESCE(BTRIM(character_entry.value->>'character_id'), '') <> ''
    ON CONFLICT (pool_id, character_id) DO UPDATE
    SET is_up = EXCLUDED.is_up;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_pool_with_aliases(TEXT, JSONB, JSONB, JSONB, JSONB, UUID)
  TO authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_upsert_pool_with_aliases(TEXT, JSONB, JSONB, JSONB, JSONB, UUID)
      TO service_role;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_upsert_pool_with_aliases(TEXT, JSONB, JSONB, JSONB, JSONB, UUID) IS
  '管理端原子化写入单个卡池；严格校验三种附加寻访产品，并兼容旧 reconstruction 武器 tuple。';

CREATE OR REPLACE FUNCTION public.promote_manual_pool_to_official_id(
  p_manual_pool_id TEXT,
  p_official_pool JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manual public.pools%ROWTYPE;
  v_official public.pools%ROWTYPE;
  v_official_id TEXT;
  v_payload_featured TEXT[];
  v_binding_record RECORD;
  v_config JSONB;
  v_versions JSONB := '[]'::JSONB;
  v_version JSONB;
  v_version_result JSONB := '[]'::JSONB;
  v_pool_ids JSONB;
  v_pool_ids_result JSONB;
  v_pool_value JSONB;
  v_pool_text TEXT;
  v_seen_pool_ids TEXT[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required';
  END IF;

  IF COALESCE(BTRIM(p_manual_pool_id), '') = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'manual_pool_id_required';
  END IF;

  IF p_official_pool IS NULL OR jsonb_typeof(p_official_pool) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'official_pool_payload_required';
  END IF;

  v_official_id := COALESCE(
    NULLIF(BTRIM(p_official_pool->>'pool_id'), ''),
    NULLIF(BTRIM(p_official_pool->>'id'), '')
  );

  IF v_official_id IS NULL OR v_official_id = BTRIM(p_manual_pool_id) OR v_official_id LIKE '%\_manual\_%' ESCAPE '\' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'official_pool_id_invalid';
  END IF;

  SELECT *
  INTO v_manual
  FROM public.pools
  WHERE pool_id = BTRIM(p_manual_pool_id)
  FOR UPDATE;

  IF NOT FOUND
    OR v_manual.pool_id NOT LIKE '%\_manual\_%' ESCAPE '\'
    OR v_manual.type <> 'extra'
    OR NOT (
      (
        v_manual.extra_subtype = 'reconstruction'
        AND v_manual.extra_rule_profile = 'reconstruction_character_v1'
      )
      OR (
        v_manual.extra_subtype = 'reconstruction_claim'
        AND v_manual.extra_rule_profile = 'reconstruction_weapon_v1'
      )
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'manual_reconstruction_pool_invalid';
  END IF;

  SELECT *
  INTO v_official
  FROM public.pools
  WHERE pool_id = v_official_id
  FOR UPDATE;

  IF jsonb_typeof(p_official_pool->'featured_characters') = 'array' THEN
    SELECT ARRAY_AGG(featured_id)
    INTO v_payload_featured
    FROM jsonb_array_elements_text(p_official_pool->'featured_characters') AS featured_id;
  END IF;

  INSERT INTO public.pools (
    user_id,
    pool_id,
    name,
    name_en,
    type,
    extra_subtype,
    extra_rule_profile,
    extra_series_key,
    extra_series_phase,
    locked,
    is_limited_weapon,
    description,
    banner_url,
    start_time,
    end_time,
    up_character,
    featured_characters
  ) VALUES (
    v_manual.user_id,
    v_official_id,
    COALESCE(NULLIF(BTRIM(p_official_pool->>'name'), ''), v_official.name, v_manual.name),
    COALESCE(NULLIF(BTRIM(p_official_pool->>'name_en'), ''), v_official.name_en, v_manual.name_en),
    v_manual.type,
    v_manual.extra_subtype,
    v_manual.extra_rule_profile,
    v_manual.extra_series_key,
    v_manual.extra_series_phase,
    COALESCE(v_manual.locked, FALSE) OR COALESCE(v_official.locked, FALSE),
    COALESCE(v_manual.is_limited_weapon, v_official.is_limited_weapon),
    COALESCE(v_manual.description, v_official.description, NULLIF(BTRIM(p_official_pool->>'description'), '')),
    COALESCE(v_manual.banner_url, v_official.banner_url, NULLIF(BTRIM(p_official_pool->>'banner_url'), '')),
    COALESCE(NULLIF(BTRIM(p_official_pool->>'start_time'), '')::TIMESTAMPTZ, v_manual.start_time, v_official.start_time),
    COALESCE(NULLIF(BTRIM(p_official_pool->>'end_time'), '')::TIMESTAMPTZ, v_manual.end_time, v_official.end_time),
    COALESCE(NULLIF(BTRIM(p_official_pool->>'up_character'), ''), v_manual.up_character, v_official.up_character),
    COALESCE(v_payload_featured, v_manual.featured_characters, v_official.featured_characters)
  )
  ON CONFLICT (pool_id) DO UPDATE
  SET
    user_id = EXCLUDED.user_id,
    name = EXCLUDED.name,
    name_en = EXCLUDED.name_en,
    type = EXCLUDED.type,
    extra_subtype = EXCLUDED.extra_subtype,
    extra_rule_profile = EXCLUDED.extra_rule_profile,
    extra_series_key = EXCLUDED.extra_series_key,
    extra_series_phase = EXCLUDED.extra_series_phase,
    locked = EXCLUDED.locked,
    is_limited_weapon = EXCLUDED.is_limited_weapon,
    description = EXCLUDED.description,
    banner_url = EXCLUDED.banner_url,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    up_character = EXCLUDED.up_character,
    featured_characters = EXCLUDED.featured_characters,
    updated_at = NOW();

  -- Keep an existing official copy when the same import record already exists.
  DELETE FROM public.history AS manual_history
  USING public.history AS official_history
  WHERE manual_history.pool_id = v_manual.pool_id
    AND official_history.pool_id = v_official_id
    AND manual_history.user_id = official_history.user_id
    AND manual_history.game_uid = official_history.game_uid
    AND manual_history.server_scope = official_history.server_scope
    AND manual_history.seq_id = official_history.seq_id
    AND manual_history.game_uid IS NOT NULL
    AND manual_history.seq_id IS NOT NULL;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'history'
      AND column_name = 'legacy_pool_id'
  ) THEN
    EXECUTE $sql$
      UPDATE public.history
      SET
        pool_id = $1,
        legacy_pool_id = COALESCE(legacy_pool_id, $2),
        updated_at = NOW()
      WHERE pool_id = $2
    $sql$
    USING v_official_id, v_manual.pool_id;
  ELSE
    UPDATE public.history
    SET
      pool_id = v_official_id,
      updated_at = NOW()
    WHERE pool_id = v_manual.pool_id;
  END IF;

  INSERT INTO public.pool_characters (pool_id, character_id, is_up, created_at)
  SELECT v_official_id, character_id, is_up, created_at
  FROM public.pool_characters
  WHERE pool_id = v_manual.pool_id
  ON CONFLICT (pool_id, character_id) DO UPDATE
  SET is_up = COALESCE(pool_characters.is_up, FALSE) OR COALESCE(EXCLUDED.is_up, FALSE);

  DELETE FROM public.pool_characters
  WHERE pool_id = v_manual.pool_id;

  UPDATE public.pool_id_aliases
  SET
    pool_id = v_official_id,
    is_primary = FALSE,
    updated_at = NOW()
  WHERE pool_id = v_manual.pool_id;

  INSERT INTO public.pool_id_aliases (source, alias_id, pool_id, is_primary, note)
  VALUES
    ('manual_placeholder', v_manual.pool_id, v_official_id, FALSE, 'Migration 179 promoted manual pool ID'),
    ('internal', v_official_id, v_official_id, TRUE, 'Migration 179 official pool self alias'),
    ('official_api', v_official_id, v_official_id, TRUE, 'Migration 179 official source self alias')
  ON CONFLICT (source, alias_id) DO UPDATE
  SET
    pool_id = EXCLUDED.pool_id,
    is_primary = EXCLUDED.is_primary,
    note = EXCLUDED.note,
    updated_at = NOW();

  FOR v_binding_record IN
    SELECT snapshot.id
    FROM public.version_content_snapshots AS snapshot
    WHERE EXISTS (
      SELECT 1
      FROM jsonb_each(snapshot.pool_bindings) AS binding(binding_key, binding_value)
      WHERE binding_value = to_jsonb(v_manual.pool_id)
    )
  LOOP
    UPDATE public.version_content_snapshots AS snapshot
    SET
      pool_bindings = (
        SELECT jsonb_object_agg(
          binding_key,
          CASE
            WHEN binding_value = to_jsonb(v_manual.pool_id) THEN to_jsonb(v_official_id)
            ELSE binding_value
          END
        )
        FROM jsonb_each(snapshot.pool_bindings) AS binding(binding_key, binding_value)
      ),
      updated_at = NOW()
    WHERE snapshot.id = v_binding_record.id;
  END LOOP;

  BEGIN
    SELECT value::JSONB
    INTO v_config
    FROM public.site_config
    WHERE key = 'home_version_timeline'
    FOR UPDATE;

    IF jsonb_typeof(v_config->'versions') = 'array' THEN
      FOR v_version IN
        SELECT version_row
        FROM jsonb_array_elements(v_config->'versions') AS version_row
      LOOP
        IF jsonb_typeof(v_version->'pool_ids') = 'array' THEN
          v_pool_ids := v_version->'pool_ids';
          v_pool_ids_result := '[]'::JSONB;
          v_seen_pool_ids := ARRAY[]::TEXT[];

          FOR v_pool_value IN
            SELECT pool_value
            FROM jsonb_array_elements(v_pool_ids) AS pool_value
          LOOP
            v_pool_text := v_pool_value #>> '{}';
            IF v_pool_text = v_manual.pool_id THEN
              v_pool_text := v_official_id;
            END IF;

            IF v_pool_text IS NOT NULL AND NOT (v_pool_text = ANY(v_seen_pool_ids)) THEN
              v_seen_pool_ids := array_append(v_seen_pool_ids, v_pool_text);
              v_pool_ids_result := v_pool_ids_result || jsonb_build_array(v_pool_text);
            END IF;
          END LOOP;

          v_version := jsonb_set(v_version, '{pool_ids}', v_pool_ids_result, TRUE);
        END IF;

        v_version_result := v_version_result || jsonb_build_array(v_version);
      END LOOP;

      v_config := jsonb_set(v_config, '{versions}', v_version_result, TRUE);
      UPDATE public.site_config
      SET
        value = v_config::TEXT,
        updated_at = NOW()
      WHERE key = 'home_version_timeline';
    END IF;
  EXCEPTION
    WHEN invalid_text_representation THEN
      NULL;
  END;

  DELETE FROM public.pools
  WHERE pool_id = v_manual.pool_id;

  INSERT INTO public.site_config (key, value, label, category, updated_at)
  VALUES (
    'public_cache_epoch',
    jsonb_build_object(
      'version', ((EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT)::TEXT,
      'scope', 'pool-id-promotion',
      'reason', 'promote_manual_pool_to_official_id',
      'updatedAt', NOW()
    )::TEXT,
    '公开缓存版本',
    'system',
    NOW()
  )
  ON CONFLICT (key) DO UPDATE
  SET
    value = EXCLUDED.value,
    updated_at = NOW();

  PERFORM pg_notify('pgrst', 'reload schema');

  RETURN jsonb_build_object(
    'manualPoolId', v_manual.pool_id,
    'officialPoolId', v_official_id,
    'promoted', TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.promote_manual_pool_to_official_id(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.promote_manual_pool_to_official_id(TEXT, JSONB)
      TO service_role;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.promote_manual_pool_to_official_id(TEXT, JSONB) IS
  '由 service_role 原子晋升重构寻访或重构申领临时 ID，并迁移历史、阵容、别名与版本配置引用。';

NOTIFY pgrst, 'reload schema';
