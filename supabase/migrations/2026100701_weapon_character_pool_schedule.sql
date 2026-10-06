-- 保存限定武器池对应的第一期限定角色池，不自动覆盖人工截止时间。
ALTER TABLE public.pools ADD COLUMN IF NOT EXISTS character_pool_id text
  REFERENCES public.pools(pool_id) ON DELETE SET NULL;
COMMENT ON COLUMN public.pools.character_pool_id IS '限定武器池同期开启的限定角色池；三期截止时间由后台手动一键填入。';

CREATE OR REPLACE FUNCTION public.validate_weapon_character_pool()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.character_pool_id IS NOT NULL AND (
    NEW.type <> 'weapon' OR NEW.is_limited_weapon IS DISTINCT FROM true
    OR NOT EXISTS (SELECT 1 FROM public.pools p WHERE p.pool_id=NEW.character_pool_id AND p.type='limited')
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='character_pool_id must reference a limited character pool for a limited weapon pool';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_weapon_character_pool ON public.pools;
CREATE TRIGGER validate_weapon_character_pool BEFORE INSERT OR UPDATE OF character_pool_id,type,is_limited_weapon
ON public.pools FOR EACH ROW EXECUTE FUNCTION public.validate_weapon_character_pool();

-- 在当前已加固 RPC 中原位加入字段保存，保留认证、别名、阵容及事务合同。
DO $migration$
DECLARE
  definition text;
  columns_marker text := E'    end_time,\n    banner_url,';
  values_marker text := '    NULLIF(BTRIM(p_insert_payload->>''end_time''), '''')::TIMESTAMPTZ,';
  update_marker text := '    banner_url = CASE';
BEGIN
  SELECT pg_get_functiondef('public.admin_upsert_pool_with_aliases(text,jsonb,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO definition;
  IF position('p_update_payload ? ''character_pool_id''' IN definition)=0 THEN
    IF position(columns_marker IN definition)=0 OR position(values_marker IN definition)=0
      OR position(update_marker IN definition)=0 THEN RAISE EXCEPTION 'Pool RPC insertion point unavailable'; END IF;
    definition := replace(definition,columns_marker,E'    end_time,\n    character_pool_id,\n    banner_url,');
    definition := replace(definition,values_marker,values_marker||E'\n    NULLIF(BTRIM(p_insert_payload->>''character_pool_id''), ''''),');
    definition := replace(definition,update_marker,$update$
    character_pool_id = CASE WHEN p_update_payload ? 'character_pool_id'
      THEN NULLIF(BTRIM(p_update_payload->>'character_pool_id'), '')
      ELSE public.pools.character_pool_id END,
$update$||update_marker);
    EXECUTE definition;
  END IF;
END;
$migration$;

-- 仅唯一同日或当前开启期的对应池才自动回填；复刻与常驻武器池不处理。
WITH candidates AS (
  SELECT w.pool_id, c.pool_id AS character_pool_id,
    count(*) OVER (PARTITION BY w.pool_id) AS matches
  FROM public.pools w JOIN public.pools c ON c.type='limited' AND c.start_time IS NOT NULL
    AND (date(c.start_time AT TIME ZONE 'Asia/Shanghai')=date(w.start_time AT TIME ZONE 'Asia/Shanghai')
      OR (c.start_time<=w.start_time AND (c.end_time IS NULL OR w.start_time<c.end_time)))
  WHERE w.type='weapon' AND w.is_limited_weapon=true AND w.character_pool_id IS NULL
)
UPDATE public.pools w SET character_pool_id=c.character_pool_id
FROM candidates c WHERE w.pool_id=c.pool_id AND c.matches=1;
NOTIFY pgrst, 'reload schema';
