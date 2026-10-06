-- 细枝申领缺少起止时间，按已登记的同系列同一期角色池补齐前瞻日期。
-- 属于受控数据修正，不加入新环境 baseline；运行前备份 pools/site_config。
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.pools IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE
  weapon public.pools;
  counterpart public.pools;
BEGIN
  SELECT * INTO STRICT weapon FROM public.pools
  WHERE pool_id='joint_manual_extra_pool_5ubt2r_undated_19o5dh';
  SELECT * INTO STRICT counterpart FROM public.pools
  WHERE pool_id='joint_manual_extra_pool_cf4379_20261029_ceid6k';
  IF weapon.extra_rule_profile IS DISTINCT FROM 'reconstruction_weapon_v1'
    OR counterpart.extra_rule_profile IS DISTINCT FROM 'reconstruction_character_v1'
    OR weapon.extra_series_key IS DISTINCT FROM 'reconstruction_danqingdu'
    OR weapon.extra_series_key IS DISTINCT FROM counterpart.extra_series_key
    OR weapon.extra_series_phase IS DISTINCT FROM counterpart.extra_series_phase
    OR counterpart.start_time IS NULL OR counterpart.end_time IS NULL
    OR counterpart.end_time <= counterpart.start_time THEN
    RAISE EXCEPTION 'Reconstruction counterpart contract changed';
  END IF;
  IF weapon.start_time IS NOT NULL OR weapon.end_time IS NOT NULL THEN
    IF weapon.start_time IS NOT DISTINCT FROM counterpart.start_time
      AND weapon.end_time IS NOT DISTINCT FROM counterpart.end_time THEN RETURN; END IF;
    RAISE EXCEPTION 'Weapon dates already maintained; stop instead of overwriting';
  END IF;
  UPDATE public.pools SET start_time=counterpart.start_time,end_time=counterpart.end_time,
    description='前瞻暂定时间：按同系列同一期「祖泉的新流」重构寻访时间补齐，待官方最终公告确认。',
    updated_at=now() WHERE pool_id=weapon.pool_id;
  UPDATE public.site_config SET value=jsonb_build_object(
    'version',floor(extract(epoch FROM clock_timestamp())*1000)::bigint::text,
    'scope','public','reason','fill-reconstruction-weapon-dates','updatedAt',now()),updated_at=now()
  WHERE key='public_cache_epoch';
END;
$$;
COMMIT;
