-- 149: 小游戏可变存档表 + AIC 协议目录 seed
--
-- 放置挂机玩法 aic-protocol（AIC 协议）需要一张按 user_id + game_id 可读写覆盖
-- 的存档表，用于持久化产线进度（四资源、建筑数、升级、转生货币等）并支持离线
-- 收益结算。这是小游戏平台首张「可变存档」表——已有的 game_score_events 是
-- 只增流水、game_leaderboard_entries 只存最佳分，都不适合放可变游戏状态。
--
-- 沿用 140 的安全惯例：启用 RLS、REVOKE anon/authenticated、仅 GRANT
-- service_role（小游戏站后端用 service_role 访问，浏览器只持 HttpOnly 会话
-- cookie，不直连 Supabase）。用户 id 锚点仍为 auth.users(id)。

-- ============================================
-- 1. 可变存档表 (game_saves)
-- ============================================
CREATE TABLE IF NOT EXISTS public.game_saves (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id     TEXT NOT NULL,
  save_data   JSONB NOT NULL DEFAULT '{}'::jsonb,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_game_saves_game_updated
  ON public.game_saves(game_id, updated_at DESC);

ALTER TABLE public.game_saves ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 2. updated_at 触发器
-- ============================================
DROP TRIGGER IF EXISTS update_game_saves_updated_at ON public.game_saves;
CREATE TRIGGER update_game_saves_updated_at
  BEFORE UPDATE ON public.game_saves
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 3. 权限：撤销 anon/authenticated，仅授予 service_role
-- ============================================
REVOKE ALL ON public.game_saves FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_saves TO service_role;
  END IF;
END $$;

COMMENT ON TABLE public.game_saves IS
  '小游戏可变存档（按 user_id + game_id 覆盖写）。save_data 存游戏状态，用于离线收益结算。仅 service_role 可访问。';

-- ============================================
-- 4. AIC 协议目录 seed
-- ============================================
-- 与 endfield-games/api/_lib/gameRules.js 的 FALLBACK_GAMES 白名单保持一致。
-- 终末地 AIC 自动化产线放置模拟：四资源加工链 + 三层转生（MVP 仅 L1）。
INSERT INTO public.game_catalog (game_id, title, summary, status, rules_version, sort_order, leaderboard_enabled)
VALUES
  ('aic-protocol', 'AIC 协议', '终末地 AIC 自动化产线放置模拟，四资源加工链 + 转生系统。', 'active', 'v1', 40, TRUE)
ON CONFLICT (game_id) DO UPDATE
  SET title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      status = EXCLUDED.status,
      rules_version = EXCLUDED.rules_version,
      sort_order = EXCLUDED.sort_order,
      leaderboard_enabled = EXCLUDED.leaderboard_enabled,
      updated_at = NOW();
