-- 182: seed the first reconstruction series and atomically promote manual pool IDs.

-- The generated baseline does not include the historical high-risk pool primary-key
-- conversion. Normalize that shape here so system-owned pools can use user_id = NULL.
DO $$
DECLARE
  v_primary_key_name TEXT;
  v_primary_key_is_pool_id BOOLEAN := FALSE;
BEGIN
  SELECT
    constraint_row.conname,
    constraint_row.conkey = ARRAY[
      (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.pools'::REGCLASS AND attname = 'pool_id')
    ]::SMALLINT[]
  INTO v_primary_key_name, v_primary_key_is_pool_id
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.pools'::REGCLASS
    AND constraint_row.contype = 'p'
  LIMIT 1;

  IF v_primary_key_name IS NOT NULL AND NOT v_primary_key_is_pool_id THEN
    EXECUTE format('ALTER TABLE public.pools DROP CONSTRAINT %I', v_primary_key_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.pools'::REGCLASS
      AND constraint_row.contype = 'p'
  ) THEN
    ALTER TABLE public.pools
      ADD CONSTRAINT pools_pkey PRIMARY KEY (pool_id);
  END IF;
END;
$$;

ALTER TABLE public.pools
  ALTER COLUMN user_id DROP NOT NULL;

-- Service-role-only maintenance RPCs need to preserve the locked flag even
-- when no interactive super-admin session exists.
CREATE OR REPLACE FUNCTION public.protect_locked_field()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_role TEXT;
BEGIN
  IF OLD.locked IS NOT DISTINCT FROM NEW.locked THEN
    RETURN NEW;
  END IF;

  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT role
  INTO v_user_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_user_role = 'super_admin' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only super admin or service role can modify locked field';
END;
$$;

-- The empty-database baseline still contains legacy entity IDs only. Seed the
-- canonical rows conservatively: keep managed media/config and union aliases.
INSERT INTO public.characters (id, name, rarity, type, is_limited, aliases)
VALUES
  ('chr_0017_yvonne', '伊冯', 6, 'character', TRUE, ARRAY['伊冯', '伊文', 'Yiwen', 'Yvonne']),
  ('chr_0009_azrila', '余烬', 6, 'character', FALSE, ARRAY['余烬', 'Yujin', 'Azrila']),
  ('chr_0015_lifeng', '黎风', 6, 'character', FALSE, ARRAY['黎风', 'Lifeng']),
  ('chr_0025_ardelia', '艾尔黛拉', 6, 'character', FALSE, ARRAY['艾尔黛拉', 'Eldelra', 'Ardelia']),
  ('chr_0026_lastrite', '别礼', 6, 'character', FALSE, ARRAY['别礼', '别离', 'Bieli', 'Lastrite']),
  ('chr_0029_pograni', '骏卫', 6, 'character', FALSE, ARRAY['骏卫', 'Junwei', 'Pograni']),
  ('wpn_pistol_0010', '艺术暴君', 6, 'weapon', TRUE, ARRAY['艺术暴君', 'Art Tyrant', 'Arttyrant'])
ON CONFLICT (id) DO UPDATE
SET
  name = COALESCE(NULLIF(BTRIM(characters.name), ''), EXCLUDED.name),
  rarity = COALESCE(characters.rarity, EXCLUDED.rarity),
  type = COALESCE(NULLIF(BTRIM(characters.type), ''), EXCLUDED.type),
  is_limited = COALESCE(characters.is_limited, EXCLUDED.is_limited),
  aliases = ARRAY(
    SELECT DISTINCT alias_value
    FROM UNNEST(
      COALESCE(characters.aliases, ARRAY[]::TEXT[])
      || COALESCE(EXCLUDED.aliases, ARRAY[]::TEXT[])
    ) AS alias_value
    WHERE NULLIF(BTRIM(alias_value), '') IS NOT NULL
  ),
  updated_at = NOW();

INSERT INTO public.character_id_aliases (
  source,
  alias_id,
  character_id,
  is_primary,
  note
)
VALUES
  ('legacy_manual', 'char_yiwen', 'chr_0017_yvonne', FALSE, 'Migration 182 legacy character alias'),
  ('legacy_manual', 'char_yujin', 'chr_0009_azrila', FALSE, 'Migration 182 legacy character alias'),
  ('legacy_manual', 'char_lifeng', 'chr_0015_lifeng', FALSE, 'Migration 182 legacy character alias'),
  ('legacy_manual', 'char_eldela', 'chr_0025_ardelia', FALSE, 'Migration 182 legacy character alias'),
  ('legacy_manual', 'char_eldelra', 'chr_0025_ardelia', FALSE, 'Migration 182 legacy character alias'),
  ('legacy_manual', 'char_bieli', 'chr_0026_lastrite', FALSE, 'Migration 182 legacy character alias'),
  ('legacy_manual', 'char_junwei', 'chr_0029_pograni', FALSE, 'Migration 182 legacy character alias')
ON CONFLICT (source, alias_id) DO UPDATE
SET
  character_id = EXCLUDED.character_id,
  is_primary = FALSE,
  note = EXCLUDED.note,
  updated_at = NOW();

INSERT INTO public.pools (
  user_id,
  pool_id,
  name,
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
)
VALUES
  (
    NULL,
    'joint_manual_extra_reconstruction_yvonne_p1',
    '绚丽异彩',
    'extra',
    'reconstruction',
    'reconstruction_character_v1',
    'reconstruction-xuesong-youmeng',
    1,
    TRUE,
    NULL,
    '官方图片仅标注“版本更新维护前”，结束时间尚未公布，因此 end_time 保持为空。',
    NULL,
    '2026-09-24T12:00:00+08:00'::TIMESTAMPTZ,
    NULL,
    '伊冯',
    ARRAY['chr_0017_yvonne']::TEXT[]
  ),
  (
    NULL,
    'joint_manual_extra_reconstruction_arttyrant_p1',
    '点绘申领',
    'extra',
    'reconstruction',
    'reconstruction_weapon_v1',
    'reconstruction-xuesong-youmeng',
    1,
    TRUE,
    NULL,
    '官方图片仅标注“版本更新维护前”，结束时间尚未公布，因此 end_time 保持为空。',
    NULL,
    '2026-09-24T12:00:00+08:00'::TIMESTAMPTZ,
    NULL,
    '艺术暴君',
    ARRAY['wpn_pistol_0010']::TEXT[]
  )
ON CONFLICT (pool_id) DO UPDATE
SET
  user_id = NULL,
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  extra_subtype = EXCLUDED.extra_subtype,
  extra_rule_profile = EXCLUDED.extra_rule_profile,
  extra_series_key = EXCLUDED.extra_series_key,
  extra_series_phase = EXCLUDED.extra_series_phase,
  locked = EXCLUDED.locked,
  is_limited_weapon = EXCLUDED.is_limited_weapon,
  description = EXCLUDED.description,
  banner_url = NULL,
  start_time = EXCLUDED.start_time,
  end_time = NULL,
  up_character = EXCLUDED.up_character,
  featured_characters = EXCLUDED.featured_characters,
  updated_at = NOW();

INSERT INTO public.pool_characters (pool_id, character_id, is_up)
VALUES
  ('joint_manual_extra_reconstruction_yvonne_p1', 'chr_0017_yvonne', TRUE),
  ('joint_manual_extra_reconstruction_yvonne_p1', 'chr_0009_azrila', FALSE),
  ('joint_manual_extra_reconstruction_yvonne_p1', 'chr_0015_lifeng', FALSE),
  ('joint_manual_extra_reconstruction_yvonne_p1', 'chr_0025_ardelia', FALSE),
  ('joint_manual_extra_reconstruction_yvonne_p1', 'chr_0026_lastrite', FALSE),
  ('joint_manual_extra_reconstruction_yvonne_p1', 'chr_0029_pograni', FALSE),
  ('joint_manual_extra_reconstruction_arttyrant_p1', 'wpn_pistol_0010', TRUE)
ON CONFLICT (pool_id, character_id) DO UPDATE
SET is_up = EXCLUDED.is_up;

INSERT INTO public.pool_id_aliases (source, alias_id, pool_id, is_primary, note)
SELECT
  alias_source,
  seeded_pool.pool_id,
  seeded_pool.pool_id,
  TRUE,
  'Migration 182 reconstruction pool self alias'
FROM (
  VALUES
    ('joint_manual_extra_reconstruction_yvonne_p1'),
    ('joint_manual_extra_reconstruction_arttyrant_p1')
) AS seeded_pool(pool_id)
CROSS JOIN (
  VALUES ('internal'), ('manual_placeholder')
) AS source_row(alias_source)
ON CONFLICT (source, alias_id) DO UPDATE
SET
  pool_id = EXCLUDED.pool_id,
  is_primary = TRUE,
  note = EXCLUDED.note,
  updated_at = NOW();

-- Add version 6 without replacing unrelated snapshot fields or existing events.
DO $$
DECLARE
  v_version_start TIMESTAMPTZ;
  v_character_event JSONB := jsonb_build_object(
    'id', 'reconstruction-xuesong-youmeng-character-p1',
    'category', 'operator',
    'title', '「绚丽异彩」重构寻访',
    'start', '2026-09-24T12:00:00+08:00',
    'end', NULL,
    'endLabel', '版本更新维护前',
    'lane', 0,
    'symbol', '绚',
    'visual', 'reconstruction'
  );
  v_weapon_event JSONB := jsonb_build_object(
    'id', 'reconstruction-xuesong-youmeng-weapon-p1',
    'category', 'arsenal',
    'title', '「点绘申领」重构申领',
    'start', '2026-09-24T12:00:00+08:00',
    'end', NULL,
    'endLabel', '版本更新维护前',
    'lane', 0,
    'symbol', '绘',
    'visual', 'reconstruction'
  );
  v_existing_content JSONB;
  v_existing_bindings JSONB;
  v_merged_events JSONB;
BEGIN
  SELECT COALESCE(
    (SELECT ends_at FROM public.version_content_snapshots WHERE version_key = 'version-5' ORDER BY revision DESC LIMIT 1),
    '2026-09-02T06:00:00+08:00'::TIMESTAMPTZ
  ) INTO v_version_start;

  SELECT content, pool_bindings
  INTO v_existing_content, v_existing_bindings
  FROM public.version_content_snapshots
  WHERE version_key = 'version-6'
    AND revision = 1;

  v_existing_content := COALESCE(v_existing_content, '{}'::JSONB);
  v_existing_bindings := COALESCE(v_existing_bindings, '{}'::JSONB);

  SELECT COALESCE(jsonb_agg(event_row), '[]'::JSONB)
  INTO v_merged_events
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(v_existing_content->'events') = 'array' THEN v_existing_content->'events'
      ELSE '[]'::JSONB
    END
  ) AS event_row
  WHERE event_row->>'id' NOT IN (
    'reconstruction-xuesong-youmeng-character-p1',
    'reconstruction-xuesong-youmeng-weapon-p1'
  );

  v_merged_events := v_merged_events || jsonb_build_array(v_character_event, v_weapon_event);

  INSERT INTO public.version_content_snapshots (
    version_key,
    version_number,
    revision,
    title,
    starts_at,
    ends_at,
    content,
    pool_bindings,
    source_meta,
    is_active,
    published_at
  ) VALUES (
    'version-6',
    '6',
    1,
    '雪凇幽梦',
    v_version_start,
    NULL,
    v_existing_content || jsonb_build_object('events', v_merged_events),
    v_existing_bindings || jsonb_build_object(
      'reconstruction-xuesong-youmeng-character-p1', 'joint_manual_extra_reconstruction_yvonne_p1',
      'reconstruction-xuesong-youmeng-weapon-p1', 'joint_manual_extra_reconstruction_arttyrant_p1'
    ),
    jsonb_build_object(
      'source', 'official-version-calendar',
      'timezone', 'Asia/Shanghai',
      'notes', '结束时间按官方图片记为“版本更新维护前”。'
    ),
    TRUE,
    NOW()
  )
  ON CONFLICT (version_key, revision) DO UPDATE
  SET
    version_number = '6',
    title = '雪凇幽梦',
    starts_at = v_version_start,
    ends_at = NULL,
    content = version_content_snapshots.content || jsonb_build_object('events', v_merged_events),
    pool_bindings = version_content_snapshots.pool_bindings || jsonb_build_object(
      'reconstruction-xuesong-youmeng-character-p1', 'joint_manual_extra_reconstruction_yvonne_p1',
      'reconstruction-xuesong-youmeng-weapon-p1', 'joint_manual_extra_reconstruction_arttyrant_p1'
    ),
    is_active = TRUE,
    published_at = COALESCE(version_content_snapshots.published_at, NOW()),
    updated_at = NOW();
END;
$$;

-- Merge the home timeline entry while preserving root keys, other versions and
-- any user-managed fields already present on version-6.
DO $$
DECLARE
  v_config JSONB := '{}'::JSONB;
  v_versions JSONB := '[]'::JSONB;
  v_existing_version JSONB := '{}'::JSONB;
  v_existing_pool_ids JSONB := '[]'::JSONB;
  v_version_start TEXT;
BEGIN
  SELECT COALESCE(
    (SELECT ends_at::TEXT FROM public.version_content_snapshots WHERE version_key = 'version-5' ORDER BY revision DESC LIMIT 1),
    '2026-09-02 06:00:00+08'
  ) INTO v_version_start;

  BEGIN
    SELECT value::JSONB
    INTO v_config
    FROM public.site_config
    WHERE key = 'home_version_timeline';
  EXCEPTION
    WHEN invalid_text_representation THEN
      v_config := '{}'::JSONB;
  END;

  v_config := COALESCE(v_config, '{}'::JSONB);
  IF jsonb_typeof(v_config->'versions') = 'array' THEN
    v_versions := v_config->'versions';
  END IF;

  SELECT COALESCE(version_row, '{}'::JSONB)
  INTO v_existing_version
  FROM jsonb_array_elements(v_versions) WITH ORDINALITY AS version_item(version_row, ordinal)
  WHERE version_row->>'id' = 'version-6'
  ORDER BY ordinal
  LIMIT 1;

  v_existing_version := COALESCE(v_existing_version, '{}'::JSONB);

  IF jsonb_typeof(v_existing_version->'pool_ids') = 'array' THEN
    v_existing_pool_ids := v_existing_version->'pool_ids';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(pool_id) ORDER BY first_ordinal), '[]'::JSONB)
  INTO v_existing_pool_ids
  FROM (
    SELECT pool_id, MIN(ordinal) AS first_ordinal
    FROM (
      SELECT pool_value #>> '{}' AS pool_id, ordinal
      FROM jsonb_array_elements(
        v_existing_pool_ids || jsonb_build_array(
          'joint_manual_extra_reconstruction_yvonne_p1',
          'joint_manual_extra_reconstruction_arttyrant_p1'
        )
      ) WITH ORDINALITY AS pool_item(pool_value, ordinal)
    ) AS pool_values
    WHERE NULLIF(BTRIM(pool_id), '') IS NOT NULL
    GROUP BY pool_id
  ) AS unique_pool_ids;

  v_existing_version := v_existing_version || jsonb_build_object(
    'id', 'version-6',
    'name', '雪凇幽梦',
    'starts_at', COALESCE(v_existing_version->>'starts_at', v_version_start),
    'ends_at', NULL,
    'enabled', TRUE,
    'order', 60,
    'pool_ids', v_existing_pool_ids
  );

  SELECT COALESCE(jsonb_agg(version_row ORDER BY ordinal), '[]'::JSONB)
  INTO v_versions
  FROM jsonb_array_elements(v_versions) WITH ORDINALITY AS version_item(version_row, ordinal)
  WHERE version_row->>'id' IS DISTINCT FROM 'version-6';

  v_versions := v_versions || jsonb_build_array(v_existing_version);
  v_config := v_config || jsonb_build_object('versions', v_versions);

  INSERT INTO public.site_config (key, value, label, category, updated_at)
  VALUES (
    'home_version_timeline',
    v_config::TEXT,
    '首页版本时间线',
    'content',
    NOW()
  )
  ON CONFLICT (key) DO UPDATE
  SET
    value = EXCLUDED.value,
    updated_at = NOW();
END;
$$;

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
    OR v_manual.extra_subtype <> 'reconstruction'
    OR v_manual.extra_rule_profile NOT IN ('reconstruction_character_v1', 'reconstruction_weapon_v1')
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
    ('manual_placeholder', v_manual.pool_id, v_official_id, FALSE, 'Migration 182 promoted manual pool ID'),
    ('internal', v_official_id, v_official_id, TRUE, 'Migration 182 official pool self alias'),
    ('official_api', v_official_id, v_official_id, TRUE, 'Migration 182 official source self alias')
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
  '由 service_role 原子晋升重构寻访临时 ID，并迁移历史、阵容、别名与版本配置引用。';

INSERT INTO public.site_config (key, value, label, category, updated_at)
VALUES (
  'public_cache_epoch',
  jsonb_build_object(
    'version', ((EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT)::TEXT,
    'scope', 'reconstruction-pool-seed',
    'reason', 'migration:182_seed_reconstruction_pools_and_promotion',
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

NOTIFY pgrst, 'reload schema';
