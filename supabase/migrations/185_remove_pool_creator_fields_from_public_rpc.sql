-- Keep pool ownership available for server-side visibility/ranking decisions,
-- but never return authentication UUIDs or roles from the anonymous RPC.

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
      p.up_character,
      p.description,
      p.banner_url,
      p.start_time,
      p.end_time,
      p.featured_characters,
      ROW_NUMBER() OVER (
        PARTITION BY p.pool_id
        ORDER BY
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
  '返回 app 端可见卡池及附加寻访分类字段；不公开创建者认证标识或角色。';
