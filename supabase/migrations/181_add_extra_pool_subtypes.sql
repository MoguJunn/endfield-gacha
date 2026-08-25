-- 181: classify extra recruitment pools without changing pools.type or canonical ids.

ALTER TABLE public.pools
  ADD COLUMN IF NOT EXISTS extra_subtype TEXT,
  ADD COLUMN IF NOT EXISTS extra_rule_profile TEXT,
  ADD COLUMN IF NOT EXISTS extra_series_key TEXT,
  ADD COLUMN IF NOT EXISTS extra_series_phase INTEGER;

ALTER TABLE public.pools
  DROP CONSTRAINT IF EXISTS pools_extra_subtype_check,
  DROP CONSTRAINT IF EXISTS pools_extra_rule_profile_check,
  DROP CONSTRAINT IF EXISTS pools_extra_metadata_contract_check;

ALTER TABLE public.pools
  ADD CONSTRAINT pools_extra_subtype_check CHECK (
    extra_subtype IS NULL
    OR extra_subtype IN ('reconstruction', 'special')
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
          AND extra_rule_profile IN (
            'reconstruction_character_v1',
            'reconstruction_weapon_v1'
          )
          AND NULLIF(BTRIM(extra_series_key), '') IS NOT NULL
          AND extra_series_phase > 0
        )
      )
    )
  ) IS TRUE);

COMMENT ON COLUMN public.pools.extra_subtype IS
  '附加寻访子类型：reconstruction（重构）或 special（特殊庆典）；非附加寻访必须为空。';
COMMENT ON COLUMN public.pools.extra_rule_profile IS
  '附加寻访规则模板；用于区分重构角色、重构申领与辉光庆典。';
COMMENT ON COLUMN public.pools.extra_series_key IS
  '重构系列稳定键；同一系列不同阶段共用，非重构附加寻访必须为空。';
COMMENT ON COLUMN public.pools.extra_series_phase IS
  '重构系列阶段，从 1 开始的正整数；非重构附加寻访必须为空。';

-- This is the only legacy Joint id with a known special-banner contract.
-- Do not infer special classification from the joint_ prefix.
UPDATE public.pools
SET
  type = 'extra',
  extra_subtype = 'special',
  extra_rule_profile = 'brilliance_festival_v1',
  extra_series_key = NULL,
  extra_series_phase = NULL,
  updated_at = NOW()
WHERE pool_id = 'joint_1_2_2';

DROP FUNCTION IF EXISTS public.get_app_visible_pools();

CREATE OR REPLACE FUNCTION public.get_app_visible_pools()
RETURNS TABLE (
  pool_id TEXT,
  name TEXT,
  name_en TEXT,
  type TEXT,
  extra_subtype TEXT,
  extra_rule_profile TEXT,
  extra_series_key TEXT,
  extra_series_phase INTEGER,
  locked BOOLEAN,
  is_limited_weapon BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  user_id UUID,
  creator_username TEXT,
  creator_role TEXT,
  up_character TEXT,
  description TEXT,
  banner_url TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  featured_characters TEXT[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH visible_pools AS (
    SELECT p.*
    FROM public.pools AS p
    WHERE
      p.pool_id IN ('standard', 'beginner')
      OR split_part(p.pool_id, '_', 1) IN ('special', 'weponbox', 'weaponbox')
      OR p.user_id IS NULL
      OR p.user_id = auth.uid()
      OR p.locked = true
      OR EXISTS (
        SELECT 1
        FROM public.profiles AS owner_profile
        WHERE owner_profile.id = p.user_id
          AND owner_profile.role IN ('admin', 'super_admin')
      )
  ),
  ranked_pools AS (
    SELECT
      p.pool_id,
      p.name,
      p.name_en,
      p.type,
      p.extra_subtype,
      p.extra_rule_profile,
      p.extra_series_key,
      p.extra_series_phase,
      p.locked,
      p.is_limited_weapon,
      p.created_at,
      p.updated_at,
      p.user_id,
      prof.username AS creator_username,
      prof.role AS creator_role,
      p.up_character,
      p.description,
      p.banner_url,
      p.start_time,
      p.end_time,
      p.featured_characters,
      ROW_NUMBER() OVER (
        PARTITION BY p.pool_id
        ORDER BY
          CASE
            WHEN prof.role = 'super_admin' THEN 3
            WHEN prof.role = 'admin' THEN 2
            ELSE 1
          END DESC,
          (
            CASE WHEN NULLIF(BTRIM(COALESCE(p.up_character, '')), '') IS NOT NULL THEN 4 ELSE 0 END +
            CASE WHEN p.start_time IS NOT NULL THEN 2 ELSE 0 END +
            CASE WHEN p.end_time IS NOT NULL THEN 2 ELSE 0 END +
            CASE WHEN COALESCE(array_length(p.featured_characters, 1), 0) > 0 THEN 1 ELSE 0 END +
            CASE WHEN NULLIF(BTRIM(COALESCE(p.banner_url, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
            CASE WHEN NULLIF(BTRIM(COALESCE(p.description, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
            CASE WHEN NULLIF(BTRIM(COALESCE(p.name_en, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
            CASE WHEN p.locked THEN 1 ELSE 0 END
          ) DESC,
          CASE WHEN p.user_id = auth.uid() THEN 1 ELSE 0 END DESC,
          COALESCE(p.start_time, p.updated_at, p.created_at, to_timestamp(0)) DESC,
          COALESCE(p.updated_at, p.created_at, to_timestamp(0)) DESC
      ) AS row_rank
    FROM visible_pools AS p
    LEFT JOIN public.profiles AS prof
      ON prof.id = p.user_id
  )
  SELECT
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
    created_at,
    updated_at,
    user_id,
    creator_username,
    creator_role,
    up_character,
    description,
    banner_url,
    start_time,
    end_time,
    featured_characters
  FROM ranked_pools
  WHERE row_rank = 1
  ORDER BY COALESCE(start_time, created_at, updated_at, to_timestamp(0)) DESC, pool_id ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_app_visible_pools() TO anon, authenticated;

COMMENT ON FUNCTION public.get_app_visible_pools() IS
  '返回 app 端可见卡池及附加寻访分类字段，并在服务端完成 pool_id 级别去重。';

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
    IF v_extra_rule_profile IS NULL
      OR v_extra_rule_profile NOT IN ('reconstruction_character_v1', 'reconstruction_weapon_v1')
      OR v_extra_series_key IS NULL
      OR v_extra_series_phase_text !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reconstruction_pool_metadata_invalid';
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
  '管理端原子化写入单个卡池、附加寻访分类、alias 与 pool_characters。';

-- Keep migration 135's legacy parameter overload compatible with uncategorized
-- extra pools. The JSON overload remains strict for the HTTP admin route. This
-- branch intentionally omits the four classification columns from conflict
-- updates so an old caller cannot erase an explicit classification.
CREATE OR REPLACE FUNCTION public.admin_upsert_pool_with_aliases(
  p_pool_id TEXT,
  p_name TEXT,
  p_type TEXT DEFAULT 'limited',
  p_description TEXT DEFAULT NULL,
  p_start_time TIMESTAMPTZ DEFAULT NULL,
  p_end_time TIMESTAMPTZ DEFAULT NULL,
  p_up_character TEXT DEFAULT NULL,
  p_featured_characters TEXT[] DEFAULT NULL,
  p_banner_url TEXT DEFAULT NULL,
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
  v_payload JSONB;
  v_pool_type TEXT;
BEGIN
  v_payload := jsonb_build_object(
    'name', p_name,
    'type', p_type,
    'description', p_description,
    'start_time', p_start_time,
    'end_time', p_end_time,
    'up_character', p_up_character,
    'featured_characters', p_featured_characters,
    'banner_url', p_banner_url
  );
  v_pool_type := COALESCE(NULLIF(BTRIM(p_type), ''), 'limited');

  IF v_pool_type <> 'extra' THEN
    PERFORM public.admin_upsert_pool_with_aliases(
      p_pool_id,
      v_payload,
      v_payload,
      p_alias_rows,
      p_pool_character_rows,
      p_actor_user_id
    );
    RETURN;
  END IF;

  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'only super_admin can manage pools';
  END IF;

  IF COALESCE(BTRIM(p_pool_id), '') = '' THEN
    RAISE EXCEPTION 'p_pool_id is required';
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

  v_actor_user_id := COALESCE(p_actor_user_id, auth.uid());

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
    type,
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
    BTRIM(p_name),
    v_pool_type,
    FALSE,
    NULL,
    NULLIF(BTRIM(p_description), ''),
    p_start_time,
    p_end_time,
    NULLIF(BTRIM(p_banner_url), ''),
    p_featured_characters,
    NULLIF(BTRIM(p_up_character), '')
  )
  ON CONFLICT (pool_id) DO UPDATE
  SET
    name = COALESCE(NULLIF(BTRIM(p_name), ''), public.pools.name),
    type = v_pool_type,
    description = NULLIF(BTRIM(p_description), ''),
    start_time = p_start_time,
    end_time = p_end_time,
    banner_url = NULLIF(BTRIM(p_banner_url), ''),
    featured_characters = p_featured_characters,
    up_character = NULLIF(BTRIM(p_up_character), '');

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

GRANT EXECUTE ON FUNCTION public.admin_upsert_pool_with_aliases(
  TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT[], TEXT, JSONB, JSONB, UUID
) TO authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_upsert_pool_with_aliases(
      TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
      TEXT, TEXT[], TEXT, JSONB, JSONB, UUID
    ) TO service_role;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_upsert_pool_with_aliases(
  TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT[], TEXT, JSONB, JSONB, UUID
) IS
  '兼容旧参数形式的卡池写入 RPC；extra 可保持未分类，且不会覆盖已有附加寻访分类。';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.history'::REGCLASS
      AND constraint_row.contype IN ('p', 'u')
      AND (
        SELECT array_agg(attribute.attname::TEXT ORDER BY key_column.ordinality)
        FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = constraint_row.conrelid
         AND attribute.attnum = key_column.attnum
      ) = ARRAY['user_id', 'game_uid', 'server_scope', 'pool_id', 'seq_id']::TEXT[]
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'official_import_history_conflict_constraint_missing';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_official_import_records(
  p_task_id UUID,
  p_user_id UUID,
  p_pools JSONB,
  p_history JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task public.official_import_tasks%ROWTYPE;
  v_pools JSONB := COALESCE(p_pools, '[]'::JSONB);
  v_history JSONB := COALESCE(p_history, '[]'::JSONB);
  v_pool_count INTEGER := 0;
  v_history_count INTEGER := 0;
  v_expected_count INTEGER := 0;
  v_result JSONB;
BEGIN
  IF jsonb_typeof(v_pools) <> 'array' OR jsonb_typeof(v_history) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'official_import_payload_must_be_arrays';
  END IF;

  SELECT *
  INTO v_task
  FROM public.official_import_tasks
  WHERE id = p_task_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'official_import_task_not_found';
  END IF;
  IF v_task.status = 'committed' THEN
    RETURN COALESCE(v_task.summary -> 'commitResult', '{}'::JSONB);
  END IF;
  IF v_task.status <> 'confirming' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'official_import_task_not_confirming';
  END IF;

  IF NOT public.is_account_credential_allowed(p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'temporary_password_expired';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(v_history) AS item(
      record_id TEXT,
      pool_id TEXT,
      seq_id TEXT,
      game_uid TEXT,
      rarity INTEGER,
      timestamp TIMESTAMPTZ
    )
    WHERE NULLIF(btrim(item.record_id), '') IS NULL
      OR NULLIF(btrim(item.pool_id), '') IS NULL
      OR NULLIF(btrim(item.seq_id), '') IS NULL
      OR NULLIF(btrim(item.game_uid), '') IS NULL
      OR item.rarity IS NULL
      OR item.rarity NOT BETWEEN 3 AND 6
      OR item.timestamp IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'official_import_history_record_invalid';
  END IF;

  INSERT INTO public.pools (
    user_id,
    pool_id,
    name,
    type,
    extra_subtype,
    extra_rule_profile,
    extra_series_key,
    extra_series_phase,
    start_time,
    end_time,
    up_character,
    featured_characters,
    created_at,
    updated_at
  )
  SELECT
    p_user_id,
    item.pool_id,
    COALESCE(NULLIF(btrim(item.name), ''), item.pool_id),
    item.type,
    item.extra_subtype,
    item.extra_rule_profile,
    item.extra_series_key,
    item.extra_series_phase,
    item.start_time,
    item.end_time,
    NULLIF(btrim(item.up_character), ''),
    item.featured_characters,
    COALESCE(item.created_at, NOW()),
    NOW()
  FROM jsonb_to_recordset(v_pools) AS item(
    pool_id TEXT,
    name TEXT,
    type TEXT,
    extra_subtype TEXT,
    extra_rule_profile TEXT,
    extra_series_key TEXT,
    extra_series_phase INTEGER,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    up_character TEXT,
    featured_characters TEXT[],
    created_at TIMESTAMPTZ
  )
  WHERE NULLIF(btrim(item.pool_id), '') IS NOT NULL
    AND NULLIF(btrim(item.type), '') IS NOT NULL
  ON CONFLICT (pool_id) DO NOTHING;
  GET DIAGNOSTICS v_pool_count = ROW_COUNT;

  INSERT INTO public.history (
    user_id,
    record_id,
    pool_id,
    seq_id,
    game_uid,
    nick_name,
    rarity,
    character_name,
    item_name,
    character_id,
    timestamp,
    pity,
    is_free,
    is_info_book,
    is_new,
    is_standard,
    server_id,
    region,
    batch_id,
    special_type,
    created_at,
    updated_at
  )
  SELECT
    p_user_id,
    item.record_id,
    item.pool_id,
    item.seq_id,
    item.game_uid,
    item.nick_name,
    item.rarity,
    item.character_name,
    item.item_name,
    item.character_id,
    item.timestamp,
    LEAST(GREATEST(COALESCE(item.pity, 0), 0), 80),
    COALESCE(item.is_free, FALSE),
    COALESCE(item.is_info_book, FALSE),
    COALESCE(item.is_new, FALSE),
    COALESCE(item.is_standard, FALSE),
    item.server_id,
    item.region,
    item.batch_id,
    item.special_type,
    COALESCE(item.created_at, NOW()),
    NOW()
  FROM jsonb_to_recordset(v_history) AS item(
    record_id TEXT,
    pool_id TEXT,
    seq_id TEXT,
    game_uid TEXT,
    nick_name TEXT,
    rarity INTEGER,
    character_name TEXT,
    item_name TEXT,
    character_id TEXT,
    timestamp TIMESTAMPTZ,
    pity INTEGER,
    is_free BOOLEAN,
    is_info_book BOOLEAN,
    is_new BOOLEAN,
    is_standard BOOLEAN,
    server_id TEXT,
    region TEXT,
    batch_id TEXT,
    special_type TEXT,
    created_at TIMESTAMPTZ
  )
  ON CONFLICT (user_id, game_uid, server_scope, pool_id, seq_id)
  DO UPDATE SET
    record_id = EXCLUDED.record_id,
    nick_name = EXCLUDED.nick_name,
    rarity = EXCLUDED.rarity,
    character_name = EXCLUDED.character_name,
    item_name = EXCLUDED.item_name,
    character_id = EXCLUDED.character_id,
    timestamp = EXCLUDED.timestamp,
    pity = EXCLUDED.pity,
    is_free = EXCLUDED.is_free,
    is_info_book = EXCLUDED.is_info_book,
    is_new = EXCLUDED.is_new,
    is_standard = EXCLUDED.is_standard,
    server_id = EXCLUDED.server_id,
    region = EXCLUDED.region,
    batch_id = EXCLUDED.batch_id,
    special_type = EXCLUDED.special_type,
    updated_at = NOW();
  GET DIAGNOSTICS v_history_count = ROW_COUNT;

  v_expected_count := COALESCE((v_task.summary ->> 'newRecords')::INTEGER, v_history_count);
  v_result := jsonb_build_object(
    'savedRecords', v_history_count,
    'skippedRecords', GREATEST(v_expected_count - v_history_count, 0),
    'createdPools', v_pool_count,
    'atomicCommit', TRUE
  );

  UPDATE public.official_import_tasks
  SET
    status = 'committed',
    summary = COALESCE(summary, '{}'::JSONB) || jsonb_build_object('commitResult', v_result),
    committed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_task_id
    AND user_id = p_user_id
    AND status = 'confirming';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'official_import_task_state_changed';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_official_import_records(UUID, UUID, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.commit_official_import_records(UUID, UUID, JSONB, JSONB)
      TO service_role;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.commit_official_import_records(UUID, UUID, JSONB, JSONB) IS
  '确认官方导入时原子写入卡池分类与历史；已有 canonical 卡池保持原目录字段。';

DO $$
DECLARE
  v_definition TEXT;
BEGIN
  v_definition := pg_get_functiondef(
    'public.commit_official_import_records(uuid,uuid,jsonb,jsonb)'::REGPROCEDURE
  );

  IF v_definition !~* 'ON CONFLICT\s*\(\s*user_id\s*,\s*game_uid\s*,\s*server_scope\s*,\s*pool_id\s*,\s*seq_id\s*\)' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'official_import_history_conflict_target_invalid';
  END IF;

  IF v_definition ~* 'ON CONFLICT\s*\(\s*user_id\s*,\s*game_uid\s*,\s*server_id\s*,' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'official_import_legacy_conflict_target_present';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
