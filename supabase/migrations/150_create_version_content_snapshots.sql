-- 150: 版本内容快照与「向渊行」初始备份
--
-- 用途：
-- 1. 保存独立版本日历的整版内容，便于修订、回滚和后续版本复用。
-- 2. 通过 pool_bindings 关联主站规范卡池，公开接口据此返回正确名称。
-- 3. 匿名用户只能读取当前启用快照，历史修订与写操作保持服务端私有。

CREATE TABLE IF NOT EXISTS public.version_content_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_key TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  content JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(content) = 'object'),
  pool_bindings JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(pool_bindings) = 'object'),
  source_meta JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(source_meta) = 'object'),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (version_key, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_version_content_snapshots_active_version
  ON public.version_content_snapshots(version_key)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_version_content_snapshots_published
  ON public.version_content_snapshots(is_active, published_at DESC);

CREATE OR REPLACE FUNCTION public.set_version_content_snapshot_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_version_content_snapshots_updated_at
  ON public.version_content_snapshots;
CREATE TRIGGER trg_version_content_snapshots_updated_at
  BEFORE UPDATE ON public.version_content_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.set_version_content_snapshot_updated_at();

ALTER TABLE public.version_content_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS version_content_snapshots_public_read
  ON public.version_content_snapshots;
CREATE POLICY version_content_snapshots_public_read
  ON public.version_content_snapshots
  FOR SELECT
  TO anon, authenticated
  USING (is_active = TRUE);

REVOKE ALL ON public.version_content_snapshots FROM anon, authenticated;
GRANT SELECT ON public.version_content_snapshots TO anon, authenticated;

COMMENT ON TABLE public.version_content_snapshots IS
  '版本日历整版 JSON 快照；公开端仅可读取 is_active=true 的当前修订。';
COMMENT ON COLUMN public.version_content_snapshots.pool_bindings IS
  '事件 ID 到 pools.pool_id 的关联，由公共接口解析为规范卡池名称。';

UPDATE public.version_content_snapshots
SET is_active = FALSE
WHERE version_key = 'xiangyuan-2026'
  AND is_active = TRUE;

INSERT INTO public.version_content_snapshots (
  version_key,
  revision,
  title,
  starts_at,
  ends_at,
  content,
  pool_bindings,
  source_meta,
  is_active,
  published_at
)
VALUES (
  'xiangyuan-2026',
  1,
  '终「向渊行」',
  '2026-07-16 12:00:00+08',
  '2026-09-02 06:00:00+08',
  $content$
  {
    "timelineStart": "2026-07-11T00:00:00+08:00",
    "timelineEnd": "2026-09-03T00:00:00+08:00",
    "timezone": "Asia/Shanghai",
    "events": [
      {"id":"op-wander","category":"operator","title":"「临渊望北」特许寻访","related":"「踏渊北眺」签到 & 作战演练","start":"2026-07-16T12:00:00+08:00","end":"2026-08-09T11:59:00+08:00","color":"#43aebc","lane":0,"symbol":"渊","visual":"rift","description":"「向渊行」版本首期特许寻访，同期开放「踏渊北眺」签到与「作战演练」干员试用活动。"},
      {"id":"op-dawn","category":"operator","title":"「晨星于此闪耀」特许寻访","related":"「明耀晨星」签到 & 作战演练","start":"2026-08-09T12:00:00+08:00","end":"2026-09-02T06:00:00+08:00","color":"#af42d7","lane":0,"symbol":"星","visual":"star","description":"版本第二期特许寻访，同期开放「明耀晨星」签到与「作战演练」干员试用活动。"},
      {"id":"weapon-years","category":"arsenal","title":"「军列申领」","start":"2026-07-16T12:00:00+08:00","end":null,"endLabel":"「晨星于此闪耀」后第1个特许寻访结束时","color":"#48c2d5","lane":0,"symbol":"轮","visual":"arsenal"},
      {"id":"weapon-edge","category":"arsenal","title":"「绛结申领」","start":"2026-06-05T12:00:00+08:00","end":"2026-08-09T11:59:00+08:00","color":"#cf1986","lane":1,"symbol":"锋","visual":"arsenal"},
      {"id":"weapon-red","category":"arsenal","title":"「染赤申领」","start":"2026-06-26T12:00:00+08:00","end":"2026-09-02T06:00:00+08:00","color":"#c7003c","lane":2,"symbol":"赤","visual":"arsenal"},
      {"id":"weapon-pupil","category":"arsenal","title":"「明曜申领」","start":"2026-08-09T12:00:00+08:00","end":null,"endLabel":"「晨星于此闪耀」后第2个特许寻访结束时","color":"#b54ad2","lane":1,"symbol":"瞳","visual":"arsenal"},
      {"id":"war-echo-1","category":"permanent","title":"「战争回响」新赛季「追忆赛季」","start":"2026-07-16T12:00:00+08:00","end":"2026-08-09T11:59:00+08:00","color":"#df2118","lane":0,"symbol":"战","visual":"echo"},
      {"id":"war-echo-2","category":"permanent","title":"「战争回响」新赛季「谵妄赛季」","start":"2026-08-09T12:00:00+08:00","end":"2026-09-02T06:00:00+08:00","color":"#d92222","lane":0,"symbol":"战","visual":"echo"},
      {"id":"meteor-story","category":"permanent","title":"「如同流星飞越边界」梨诺叙事活动","start":"2026-08-09T12:00:00+08:00","end":null,"color":"#ae36e0","lane":1,"permanent":true,"symbol":"契","visual":"story"},
      {"id":"monument-birds","category":"permanent","title":"「影拓丰碑」新系列「山中见犼」","start":"2026-08-06T12:00:00+08:00","end":null,"color":"#8e2725","lane":2,"permanent":true,"symbol":"碑","visual":"monument"},
      {"id":"monument-beast","category":"permanent","title":"「丰碑留名 · 兽犼」","start":"2026-08-06T12:00:00+08:00","end":"2026-08-20T04:00:00+08:00","color":"#76312f","lane":3,"symbol":"兽","visual":"monument"},
      {"id":"secret-realm","category":"permanent","title":"「密境行者」新空间组「六方巧境」","start":"2026-08-19T12:00:00+08:00","end":null,"color":"#526194","lane":2,"permanent":true,"symbol":"境","visual":"realm"},
      {"id":"secret-realm-update","category":"permanent","title":"「密境行者」活动内容更新","start":"2026-08-26T04:00:00+08:00","end":null,"milestone":true,"color":"#7181bd","lane":3,"symbol":"更","visual":"realm"},
      {"id":"companion-gift","category":"limited","title":"「相伴赠礼」庆典活动","start":"2026-07-16T12:00:00+08:00","end":"2026-08-09T12:00:00+08:00","color":"#b7b600","eventInk":"#171a14","lane":0,"symbol":"礼","visual":"gift"},
      {"id":"fortune","category":"limited","title":"「宏运连连乐」庆典活动","start":"2026-07-16T12:00:00+08:00","end":"2026-07-31T04:00:00+08:00","color":"#d96a1f","lane":1,"symbol":"运","visual":"festival"},
      {"id":"northland","category":"limited","title":"「北观禁土」引入活动","start":"2026-07-16T12:00:00+08:00","end":"2026-08-09T12:00:00+08:00","color":"#9d2779","lane":2,"symbol":"禁","visual":"northland"},
      {"id":"burning-arena","category":"limited","title":"「炽燃！竞技大会！！」挑战活动","start":"2026-07-30T12:00:00+08:00","end":"2026-08-13T04:00:00+08:00","color":"#9e2a2d","lane":3,"symbol":"竞","visual":"arena"},
      {"id":"sanity-supply-first","category":"limited","title":"「理智补给」第一期","start":"2026-08-02T04:00:00+08:00","end":"2026-08-09T04:00:00+08:00","color":"#7e7c7a","lane":4,"symbol":"智","visual":"supply"},
      {"id":"roots","category":"limited","title":"「根脉奇境」趣味活动","start":"2026-08-09T12:00:00+08:00","end":"2026-09-02T06:00:00+08:00","color":"#b8860b","lane":2,"symbol":"根","visual":"roots"},
      {"id":"sanity-supply-final","category":"limited","title":"「理智补给」第二期","start":"2026-08-26T04:00:00+08:00","end":"2026-09-02T04:00:00+08:00","color":"#7e7c7a","lane":4,"symbol":"智","visual":"supply"},
      {"id":"next-version-warmup","category":"limited","title":"新版本预热签到活动","start":"2026-08-28T04:00:00+08:00","startUnknown":true,"startLabel":"待官方公布（海报标注为 ??）","end":"2026-09-02T06:00:00+08:00","color":"#555b57","lane":5,"symbol":"签","visual":"ticket"}
    ]
  }
  $content$::JSONB,
  $bindings$
  {
    "op-wander": "special_manual_limited_pool_ixd68v_20260716_1aogy7",
    "op-dawn": "special_manual_limited_pool_1d87dz_20260809_nsisrc",
    "weapon-years": "weaponbox_manual_weapon_pool_1g47uo_20260716_7bm8em",
    "weapon-edge": "weponbox_1_3_1",
    "weapon-red": "weponbox_1_3_2",
    "weapon-pupil": "weaponbox_manual_weapon_pool_4e5oi9_20260809_roujh3"
  }
  $bindings$::JSONB,
  $source$
  {
    "source": "official-version-calendar",
    "sourceDate": "2026-07-11",
    "timezone": "Asia/Shanghai",
    "notes": "角色池与武器池名称关联主站 pools；时间以官方版本日历为准。"
  }
  $source$::JSONB,
  TRUE,
  NOW()
)
ON CONFLICT (version_key, revision)
DO UPDATE SET
  title = EXCLUDED.title,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at,
  content = EXCLUDED.content,
  pool_bindings = EXCLUDED.pool_bindings,
  source_meta = EXCLUDED.source_meta,
  is_active = TRUE,
  published_at = EXCLUDED.published_at;
