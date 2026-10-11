-- Return one JSON value so PostgREST's row limit cannot truncate a roster.
-- NULL selects all pools for the authenticated admin API; an empty array
-- selects none. Only the server role can invoke this catalog read.
BEGIN;

CREATE OR REPLACE FUNCTION public.read_pool_roster_catalog(p_pool_ids TEXT[] DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
SET statement_timeout = '10s'
AS $$
  SELECT jsonb_build_object(
    'rowCount', count(*),
    'rows', COALESCE(jsonb_agg(
      jsonb_build_object(
        'pool_id', pc.pool_id,
        'character_id', pc.character_id,
        'is_up', pc.is_up,
        'characters', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'rarity', c.rarity,
          'type', c.type,
          'is_limited', c.is_limited,
          'aliases', c.aliases,
          'pool_config', c.pool_config
        ) END
      ) ORDER BY pc.pool_id, pc.character_id
    ), '[]'::jsonb)
  )
  FROM public.pool_characters pc
  LEFT JOIN public.characters c ON c.id = pc.character_id
  WHERE p_pool_ids IS NULL OR pc.pool_id = ANY(p_pool_ids);
$$;

REVOKE ALL ON FUNCTION public.read_pool_roster_catalog(TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_pool_roster_catalog(TEXT[]) TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
