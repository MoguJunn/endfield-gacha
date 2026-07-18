-- 122: normalize 2026-05-14 "辉光庆典" featured character refs.
--
-- Some production rows still have display names in pools.featured_characters
-- for joint_1_2_2. Admin/audit tooling expects character IDs there.

DO $$
DECLARE
  v_pool_id TEXT := 'joint_1_2_2';
  v_featured_refs TEXT[];
  v_missing_names TEXT[];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.pools
    WHERE pool_id = v_pool_id
  ) THEN
    RAISE NOTICE '122_fix_joint_pool_featured_character_refs skipped: target pool % not found', v_pool_id;
    RETURN;
  END IF;

  WITH featured(source_id, legacy_id, fallback_name, sort_order) AS (
    VALUES
      ('chr_0016_laevat', 'char_levantin', '莱万汀', 1),
      ('chr_0013_aglina', 'char_jerpeta', '洁尔佩塔', 2),
      ('chr_0025_ardelia', 'char_eldelra', '艾尔黛拉', 3),
      ('chr_0029_pograni', 'char_junwei', '骏卫', 4)
  ),
  resolved AS (
    SELECT
      featured.fallback_name,
      featured.sort_order,
      COALESCE(source_match.id, legacy_match.id) AS character_id
    FROM featured
    LEFT JOIN public.characters AS source_match
      ON source_match.id = featured.source_id
    LEFT JOIN public.characters AS legacy_match
      ON legacy_match.id = featured.legacy_id
  )
  SELECT
    ARRAY_AGG(character_id ORDER BY sort_order) FILTER (WHERE character_id IS NOT NULL),
    ARRAY_AGG(fallback_name ORDER BY sort_order) FILTER (WHERE character_id IS NULL)
    INTO v_featured_refs, v_missing_names
  FROM resolved;

  IF COALESCE(array_length(v_missing_names, 1), 0) > 0 THEN
    RAISE EXCEPTION '122_fix_joint_pool_featured_character_refs missing character IDs for: %', array_to_string(v_missing_names, ', ');
  END IF;

  UPDATE public.pools
  SET
    featured_characters = v_featured_refs,
    updated_at = NOW()
  WHERE pool_id = v_pool_id
    AND featured_characters IS DISTINCT FROM v_featured_refs;

  WITH resolved(character_id, sort_order) AS (
    SELECT character_id, sort_order
    FROM UNNEST(v_featured_refs) WITH ORDINALITY AS item(character_id, sort_order)
  )
  INSERT INTO public.pool_characters (pool_id, character_id, is_up)
  SELECT v_pool_id, character_id, TRUE
  FROM resolved
  ON CONFLICT (pool_id, character_id) DO UPDATE
  SET is_up = TRUE;
END $$;
