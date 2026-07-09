-- 140: 小游戏平台核心表
--
-- 为独立小游戏站 (endfield-games) 提供货币钱包、成绩流水、排行榜、用户统计
-- 和游戏目录。小游戏站后端使用 service_role 访问这些表（前端只持有 HttpOnly
-- 会话 cookie，不直连 Supabase），因此这些表对 anon/authenticated 一律 REVOKE，
-- 仅授予 service_role，沿用 129 私有表的安全惯例。
--
-- 用户 id 锚点仍为 auth.users(id)，与主站共享同一身份体系。

-- ============================================
-- 1. 货币钱包 (game_currency_wallets)
-- ============================================
CREATE TABLE IF NOT EXISTS public.game_currency_wallets (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  currency_code TEXT NOT NULL,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_earned BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_earned >= 0),
  lifetime_spent BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_spent >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, currency_code)
);

CREATE INDEX IF NOT EXISTS idx_game_currency_wallets_user
  ON public.game_currency_wallets(user_id);

ALTER TABLE public.game_currency_wallets ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 2. 货币流水台账 (game_currency_ledger)
-- ============================================
-- 不可变流水，记录每一次余额变更；带幂等 key 防重复入账。
CREATE TABLE IF NOT EXISTS public.game_currency_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  currency_code TEXT NOT NULL,
  amount BIGINT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'unspecified',
  source_game_id TEXT,
  source_event_id UUID,
  idempotency_key TEXT,
  balance_after BIGINT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_game_currency_ledger_user_created
  ON public.game_currency_ledger(user_id, created_at DESC);

ALTER TABLE public.game_currency_ledger ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 3. 成绩事件流水 (game_score_events)
-- ============================================
CREATE TABLE IF NOT EXISTS public.game_score_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  rules_version TEXT,
  client_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  integrity_status TEXT NOT NULL DEFAULT 'accepted'
    CHECK (integrity_status IN ('accepted', 'pending', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_score_events_user_game
  ON public.game_score_events(user_id, game_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_game_score_events_game_created
  ON public.game_score_events(game_id, created_at DESC);

-- 拼图完成幂等查询使用 client_meta 上的 GIN 索引（contains 查询）
CREATE INDEX IF NOT EXISTS idx_game_score_events_client_meta
  ON public.game_score_events USING GIN (client_meta);

ALTER TABLE public.game_score_events ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 4. 排行榜条目 (game_leaderboard_entries)
-- ============================================
CREATE TABLE IF NOT EXISTS public.game_leaderboard_entries (
  game_id TEXT NOT NULL,
  season_id TEXT NOT NULL DEFAULT 'global',
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  best_score INTEGER NOT NULL DEFAULT 0,
  best_duration_ms INTEGER,
  total_points BIGINT NOT NULL DEFAULT 0,
  play_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, season_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_game_leaderboard_rank
  ON public.game_leaderboard_entries(game_id, season_id, best_score DESC, best_duration_ms ASC);

ALTER TABLE public.game_leaderboard_entries ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 5. 用户统计 (game_user_stats)
-- ============================================
CREATE TABLE IF NOT EXISTS public.game_user_stats (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  total_points BIGINT NOT NULL DEFAULT 0,
  play_count INTEGER NOT NULL DEFAULT 0,
  last_played_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.game_user_stats ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 6. 游戏目录 (game_catalog)
-- ============================================
CREATE TABLE IF NOT EXISTS public.game_catalog (
  game_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'hidden', 'archived')),
  rules_version TEXT NOT NULL DEFAULT 'v1',
  sort_order INTEGER NOT NULL DEFAULT 100,
  leaderboard_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_catalog_status_sort
  ON public.game_catalog(status, sort_order);

ALTER TABLE public.game_catalog ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 7. updated_at 触发器
-- ============================================
DROP TRIGGER IF EXISTS update_game_currency_wallets_updated_at ON public.game_currency_wallets;
CREATE TRIGGER update_game_currency_wallets_updated_at
  BEFORE UPDATE ON public.game_currency_wallets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_game_leaderboard_entries_updated_at ON public.game_leaderboard_entries;
CREATE TRIGGER update_game_leaderboard_entries_updated_at
  BEFORE UPDATE ON public.game_leaderboard_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_game_user_stats_updated_at ON public.game_user_stats;
CREATE TRIGGER update_game_user_stats_updated_at
  BEFORE UPDATE ON public.game_user_stats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_game_catalog_updated_at ON public.game_catalog;
CREATE TRIGGER update_game_catalog_updated_at
  BEFORE UPDATE ON public.game_catalog
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 8. 权限：撤销 anon/authenticated，仅授予 service_role
-- ============================================
-- 小游戏站后端用 service_role 访问；浏览器不直连这些表。
REVOKE ALL ON public.game_currency_wallets FROM anon, authenticated;
REVOKE ALL ON public.game_currency_ledger FROM anon, authenticated;
REVOKE ALL ON public.game_score_events FROM anon, authenticated;
REVOKE ALL ON public.game_leaderboard_entries FROM anon, authenticated;
REVOKE ALL ON public.game_user_stats FROM anon, authenticated;
REVOKE ALL ON public.game_catalog FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_currency_wallets TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_currency_ledger TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_score_events TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_leaderboard_entries TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_user_stats TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_catalog TO service_role;
  END IF;
END $$;

-- ============================================
-- 9. 注释
-- ============================================
COMMENT ON TABLE public.game_currency_wallets IS
  '小游戏货币钱包（折金票等），主键 user_id + currency_code。仅 service_role 可访问。';
COMMENT ON TABLE public.game_currency_ledger IS
  '小游戏货币不可变流水台账，带幂等 key 防重复入账。仅 service_role 可访问。';
COMMENT ON TABLE public.game_score_events IS
  '小游戏成绩事件流水。client_meta 用于幂等判断（如拼图完成 mode/puzzleId）。仅 service_role 可访问。';
COMMENT ON TABLE public.game_leaderboard_entries IS
  '小游戏排行榜条目，按 game_id + season_id + user_id 聚合最佳成绩。仅 service_role 可访问。';
COMMENT ON TABLE public.game_user_stats IS
  '小游戏用户累计统计（总积分、局数、最近游玩时间）。仅 service_role 可访问。';
COMMENT ON TABLE public.game_catalog IS
  '小游戏目录，定义可用游戏及其展示信息与规则版本。仅 service_role 可访问。';
