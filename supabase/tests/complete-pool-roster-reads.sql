BEGIN;
INSERT INTO public.characters(id, name, rarity, type, is_limited, aliases, pool_config)
SELECT 'entity-' || lpad(i::text, 4, '0'), '测试角色 ' || i, 4 + i % 3,
       CASE WHEN i % 2 = 0 THEN 'weapon' ELSE 'character' END,
       i % 5 = 0, ARRAY['别名 ' || i], jsonb_build_object('test', i)
FROM generate_series(1, 1227) i;
INSERT INTO public.pool_characters(pool_id, character_id, is_up)
SELECT CASE WHEN i <= 1000 THEN 'older' ELSE 'zero-history' END,
       'entity-' || lpad(i::text, 4, '0'), i = 1227
FROM generate_series(1, 1227) i;

SET LOCAL ROLE service_role;
DO $$
DECLARE result jsonb; scoped jsonb; differences integer;
BEGIN
  result := public.read_pool_roster_catalog(NULL);
  IF (result->>'rowCount')::integer <> 1227 OR jsonb_array_length(result->'rows') <> 1227 THEN
    RAISE EXCEPTION 'Full roster was truncated';
  END IF;
  SELECT count(*) INTO differences FROM (
    (SELECT pool_id, character_id, is_up FROM public.pool_characters
     EXCEPT SELECT r->>'pool_id', r->>'character_id', (r->>'is_up')::boolean
       FROM jsonb_array_elements(result->'rows') r)
    UNION ALL
    (SELECT r->>'pool_id', r->>'character_id', (r->>'is_up')::boolean
       FROM jsonb_array_elements(result->'rows') r
     EXCEPT SELECT pool_id, character_id, is_up FROM public.pool_characters)
  ) comparison;
  IF differences <> 0 THEN RAISE EXCEPTION 'Roster differs from source'; END IF;
  scoped := public.read_pool_roster_catalog(ARRAY['zero-history', 'empty', 'zero-history']);
  IF (scoped->>'rowCount')::integer <> 227 THEN RAISE EXCEPTION 'Scoped roster incorrect'; END IF;
  IF scoped->'rows'->0->>'character_id' <> 'entity-1001' OR
     scoped->'rows'->226->'characters'->>'name' <> '测试角色 1227' OR
     scoped->'rows'->226->'characters'->'pool_config' <> '{"test":1227}'::jsonb THEN
    RAISE EXCEPTION 'Order or joined fields lost';
  END IF;
  IF public.read_pool_roster_catalog(ARRAY[]::text[]) <> '{"rowCount":0,"rows":[]}'::jsonb OR
     public.read_pool_roster_catalog(ARRAY['empty']) <> '{"rowCount":0,"rows":[]}'::jsonb THEN
    RAISE EXCEPTION 'Empty scope read unrelated pools';
  END IF;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.read_pool_roster_catalog(text[])', 'EXECUTE') OR
     has_function_privilege('authenticated', 'public.read_pool_roster_catalog(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'Browser role can read server catalog';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.read_pool_roster_catalog(text[])'::regprocedure) THEN
    RAISE EXCEPTION 'Function must preserve caller table permissions';
  END IF;
END;
$$;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.read_pool_roster_catalog(NULL);
    RAISE EXCEPTION 'Authenticated role unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;
ROLLBACK;
