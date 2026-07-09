-- ============================================
-- 终末地抽卡分析器 - 自动生成基线 Schema
--
-- 说明:
--   1. 此文件由 scripts/generate-supabase-baseline.mjs 自动生成
--   2. 合并 supabase/archive/migrations/ 与 supabase/migrations/ 中的标准前向迁移
--   3. 不包含 supabase/manual/ 下的 destructive / rollback / data-backfill 脚本
--   4. 生成时间: 2026-07-02T19:20:31.726Z
--   5. 覆盖范围: archive/001_init_tables.sql -> active/149_create_game_saves_and_aic_catalog.sql
-- ============================================

-- >>> BEGIN MIGRATION: archive/001_init_tables.sql
-- ============================================
-- 001: 终末地抽卡分析器 - 数据库初始化
-- 创建基础表: profiles, pools, history, admin_applications
-- ============================================

-- ============================================
-- 1. 用户资料表 (profiles)
-- ============================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 启用 RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS 策略：所有人可读取（用于显示创建者用户名等）
CREATE POLICY "profiles_select_policy" ON public.profiles
  FOR SELECT USING (true);

-- RLS 策略：用户只能更新自己的资料
CREATE POLICY "profiles_update_policy" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- RLS 策略：用户可以插入自己的资料
CREATE POLICY "profiles_insert_policy" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- 创建触发器函数：自动创建 profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', SPLIT_PART(NEW.email, '@', 1)),
    'user'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 绑定触发器到 auth.users 表
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 2. 卡池表 (pools)
-- ============================================
CREATE TABLE IF NOT EXISTS public.pools (
  id SERIAL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pool_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('limited', 'standard', 'weapon')),
  locked BOOLEAN DEFAULT FALSE,
  is_limited_weapon BOOLEAN DEFAULT TRUE,  -- 武器池类型：限定/常驻
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, pool_id)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_pools_user_id ON public.pools(user_id);
CREATE INDEX IF NOT EXISTS idx_pools_type ON public.pools(type);

-- 启用 RLS
ALTER TABLE public.pools ENABLE ROW LEVEL SECURITY;

-- RLS 策略：所有人可读取卡池（公开查看）
CREATE POLICY "pools_select_policy" ON public.pools
  FOR SELECT USING (true);

-- RLS 策略：用户可以管理自己的卡池
CREATE POLICY "pools_insert_policy" ON public.pools
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pools_update_policy" ON public.pools
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "pools_delete_policy" ON public.pools
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 3. 抽卡记录表 (history)
-- ============================================
CREATE TABLE IF NOT EXISTS public.history (
  id SERIAL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  rarity INTEGER NOT NULL CHECK (rarity BETWEEN 3 AND 6),
  is_standard BOOLEAN DEFAULT FALSE,
  special_type TEXT CHECK (special_type IS NULL OR special_type IN ('gift', 'guaranteed')),
  item_name TEXT,  -- 可选：物品名称
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, record_id)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_history_user_id ON public.history(user_id);
CREATE INDEX IF NOT EXISTS idx_history_pool_id ON public.history(pool_id);
CREATE INDEX IF NOT EXISTS idx_history_rarity ON public.history(rarity);
CREATE INDEX IF NOT EXISTS idx_history_timestamp ON public.history(timestamp);

-- 启用 RLS
ALTER TABLE public.history ENABLE ROW LEVEL SECURITY;

-- RLS 策略：所有人可读取历史记录（公开查看）
CREATE POLICY "history_select_policy" ON public.history
  FOR SELECT USING (true);

-- RLS 策略：用户可以管理自己的记录
CREATE POLICY "history_insert_policy" ON public.history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "history_update_policy" ON public.history
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "history_delete_policy" ON public.history
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 4. 管理员申请表 (admin_applications)
-- ============================================
CREATE TABLE IF NOT EXISTS public.admin_applications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_admin_applications_user_id ON public.admin_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_applications_status ON public.admin_applications(status);

-- 启用 RLS
ALTER TABLE public.admin_applications ENABLE ROW LEVEL SECURITY;

-- RLS 策略：用户可以查看自己的申请
CREATE POLICY "admin_applications_select_own" ON public.admin_applications
  FOR SELECT USING (auth.uid() = user_id);

-- RLS 策略：超管可以查看所有申请
CREATE POLICY "admin_applications_select_super" ON public.admin_applications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- RLS 策略：用户可以创建申请
CREATE POLICY "admin_applications_insert_policy" ON public.admin_applications
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS 策略：超管可以更新申请状态
CREATE POLICY "admin_applications_update_super" ON public.admin_applications
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- ============================================
-- 5. 辅助函数
-- ============================================

-- 更新 updated_at 时间戳的触发器函数
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 为各表添加 updated_at 触发器
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_pools_updated_at ON public.pools;
CREATE TRIGGER update_pools_updated_at
  BEFORE UPDATE ON public.pools
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_history_updated_at ON public.history;
CREATE TRIGGER update_history_updated_at
  BEFORE UPDATE ON public.history
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_admin_applications_updated_at ON public.admin_applications;
CREATE TRIGGER update_admin_applications_updated_at
  BEFORE UPDATE ON public.admin_applications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 注释
-- ============================================
COMMENT ON TABLE public.profiles IS '用户资料表，存储用户名和角色信息';
COMMENT ON TABLE public.pools IS '卡池表，存储用户创建的抽卡卡池';
COMMENT ON TABLE public.history IS '抽卡历史记录表，存储所有抽卡结果';
COMMENT ON TABLE public.admin_applications IS '管理员申请表，用户申请成为管理员的记录';
-- <<< END MIGRATION: archive/001_init_tables.sql

-- >>> BEGIN MIGRATION: archive/002_global_stats_function.sql
-- 创建全服统计 RPC 函数（使用 SECURITY DEFINER 绕过 RLS）
CREATE OR REPLACE FUNCTION get_global_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  avg_pity NUMERIC;
BEGIN
  -- 使用 LAG 窗口函数计算平均出货
  WITH ordered_pulls AS (
    SELECT
      pool_id,
      rarity,
      ROW_NUMBER() OVER (PARTITION BY pool_id ORDER BY record_id) as rn
    FROM history
    WHERE special_type IS DISTINCT FROM 'gift'
  ),
  six_stars_with_prev AS (
    SELECT
      rn,
      LAG(rn, 1, 0) OVER (PARTITION BY pool_id ORDER BY rn) as prev_rn
    FROM ordered_pulls
    WHERE rarity = 6
  )
  SELECT COALESCE(AVG(rn - prev_rn), 0) INTO avg_pity FROM six_stars_with_prev;

  SELECT json_build_object(
    'totalPulls', COALESCE((SELECT COUNT(*) FROM history WHERE special_type IS DISTINCT FROM 'gift'), 0),
    'totalUsers', COALESCE((SELECT COUNT(*) FROM profiles), 0),
    'sixStarTotal', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 6 AND is_standard = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 6 AND is_standard = true), 0),
    'fiveStar', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 5), 0),
    'fourStar', COALESCE((SELECT COUNT(*) FROM history WHERE rarity <= 4), 0),
    'avgPity', ROUND(avg_pity, 1),
    'byType', json_build_object(
      'limited', json_build_object(
        'total', COALESCE((SELECT COUNT(*) FROM history h JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id WHERE p.type = 'limited' AND h.special_type IS DISTINCT FROM 'gift'), 0)
      ),
      'weapon', json_build_object(
        'total', COALESCE((SELECT COUNT(*) FROM history h JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id WHERE p.type = 'weapon' AND h.special_type IS DISTINCT FROM 'gift'), 0)
      ),
      'standard', json_build_object(
        'total', COALESCE((SELECT COUNT(*) FROM history h JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id WHERE p.type = 'standard' AND h.special_type IS DISTINCT FROM 'gift'), 0)
      )
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- 授权所有认证用户调用此函数
GRANT EXECUTE ON FUNCTION get_global_stats() TO authenticated;
-- 也授权匿名用户（如果需要未登录也能看到统计）
GRANT EXECUTE ON FUNCTION get_global_stats() TO anon;
-- <<< END MIGRATION: archive/002_global_stats_function.sql

-- >>> BEGIN MIGRATION: archive/003_global_stats_with_charts.sql
-- 扩展全服统计 RPC 函数，添加图表所需的详细数据
-- 包括：各稀有度计数、6星出货分布、分类型详细统计

DROP FUNCTION IF EXISTS get_global_stats();

CREATE OR REPLACE FUNCTION get_global_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  avg_pity NUMERIC;
  global_distribution JSON;
  limited_stats JSON;
  weapon_stats JSON;
  standard_stats JSON;
BEGIN
  -- ============================================
  -- 1. 计算全局平均出货
  -- ============================================
  WITH ordered_pulls AS (
    SELECT
      pool_id,
      user_id,
      rarity,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM history
    WHERE special_type IS DISTINCT FROM 'gift'
  ),
  six_stars_with_prev AS (
    SELECT
      pool_id,
      user_id,
      rn,
      LAG(rn, 1, 0) OVER (PARTITION BY pool_id, user_id ORDER BY rn) as prev_rn
    FROM ordered_pulls
    WHERE rarity = 6
  )
  SELECT COALESCE(AVG(rn - prev_rn), 0) INTO avg_pity FROM six_stars_with_prev;

  -- ============================================
  -- 2. 计算全局6星出货分布
  -- ============================================
  WITH ordered_pulls AS (
    SELECT
      h.pool_id,
      h.user_id,
      h.rarity,
      h.is_standard,
      ROW_NUMBER() OVER (PARTITION BY h.pool_id, h.user_id ORDER BY h.record_id) as rn
    FROM history h
    WHERE h.special_type IS DISTINCT FROM 'gift'
  ),
  six_stars_pity AS (
    SELECT
      is_standard,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM ordered_pulls
    WHERE rarity = 6
  ),
  pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard
    FROM six_stars_pity
  ),
  grouped_ranges AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM pity_ranges
    GROUP BY range_label
  )
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'range', REPLACE(range_label, '01-10', '1-10'),
        'limited', limited_count,
        'standard', standard_count
      ) ORDER BY range_label
    ),
    '[]'::json
  ) INTO global_distribution FROM grouped_ranges;

  -- ============================================
  -- 3. 计算限定池统计
  -- ============================================
  WITH limited_pulls AS (
    SELECT h.*
    FROM history h
    JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
    WHERE p.type = 'limited'
  ),
  limited_ordered AS (
    SELECT
      pool_id,
      user_id,
      rarity,
      is_standard,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM limited_pulls
    WHERE special_type IS DISTINCT FROM 'gift'
  ),
  limited_six_pity AS (
    SELECT
      pool_id,
      user_id,
      is_standard,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM limited_ordered
    WHERE rarity = 6
  ),
  limited_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard
    FROM limited_six_pity
  ),
  limited_grouped AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM limited_pity_ranges
    GROUP BY range_label
  )
  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE special_type IS DISTINCT FROM 'gift'), 0),
    'six', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard = true), 0),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM limited_six_pity), 1), 0),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity <= 4), 0)
    ),
    'distribution', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        ) ORDER BY range_label
      ) FROM limited_grouped),
      '[]'::json
    )
  ) INTO limited_stats;

  -- ============================================
  -- 4. 计算武器池统计
  -- ============================================
  WITH weapon_pulls AS (
    SELECT h.*
    FROM history h
    JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
    WHERE p.type = 'weapon'
  ),
  weapon_ordered AS (
    SELECT
      pool_id,
      user_id,
      rarity,
      is_standard,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM weapon_pulls
    WHERE special_type IS DISTINCT FROM 'gift'
  ),
  weapon_six_pity AS (
    SELECT
      pool_id,
      user_id,
      is_standard,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM weapon_ordered
    WHERE rarity = 6
  ),
  weapon_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard
    FROM weapon_six_pity
  ),
  weapon_grouped AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM weapon_pity_ranges
    GROUP BY range_label
  )
  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE special_type IS DISTINCT FROM 'gift'), 0),
    'six', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard = true), 0),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM weapon_six_pity), 1), 0),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity <= 4), 0)
    ),
    'distribution', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        ) ORDER BY range_label
      ) FROM weapon_grouped),
      '[]'::json
    )
  ) INTO weapon_stats;

  -- ============================================
  -- 5. 计算常驻池统计
  -- ============================================
  WITH standard_pulls AS (
    SELECT h.*
    FROM history h
    JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
    WHERE p.type = 'standard'
  ),
  standard_ordered AS (
    SELECT
      pool_id,
      user_id,
      rarity,
      is_standard,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM standard_pulls
    WHERE special_type IS DISTINCT FROM 'gift'
  ),
  standard_six_pity AS (
    SELECT
      pool_id,
      user_id,
      is_standard,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM standard_ordered
    WHERE rarity = 6
  ),
  standard_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard
    FROM standard_six_pity
  ),
  standard_grouped AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM standard_pity_ranges
    GROUP BY range_label
  )
  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE special_type IS DISTINCT FROM 'gift'), 0),
    'six', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6 AND is_standard = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6 AND is_standard = true), 0),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM standard_six_pity), 1), 0),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6 AND is_standard = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6 AND is_standard = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity <= 4), 0)
    ),
    'distribution', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        ) ORDER BY range_label
      ) FROM standard_grouped),
      '[]'::json
    )
  ) INTO standard_stats;

  -- ============================================
  -- 6. 组装最终结果
  -- ============================================
  SELECT json_build_object(
    'totalPulls', COALESCE((SELECT COUNT(*) FROM history WHERE special_type IS DISTINCT FROM 'gift'), 0),
    'totalUsers', COALESCE((SELECT COUNT(*) FROM profiles), 0),
    'sixStarTotal', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 6 AND is_standard = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 6 AND is_standard = true), 0),
    'fiveStar', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 5), 0),
    'fourStar', COALESCE((SELECT COUNT(*) FROM history WHERE rarity <= 4), 0),
    'avgPity', ROUND(avg_pity, 1),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 6 AND is_standard = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 6 AND is_standard = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM history WHERE rarity <= 4), 0)
    ),
    'distribution', global_distribution,
    'byType', json_build_object(
      'limited', limited_stats,
      'weapon', weapon_stats,
      'standard', standard_stats
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- 授权所有认证用户调用此函数
GRANT EXECUTE ON FUNCTION get_global_stats() TO authenticated;
-- 也授权匿名用户（如果需要未登录也能看到统计）
GRANT EXECUTE ON FUNCTION get_global_stats() TO anon;
-- <<< END MIGRATION: archive/003_global_stats_with_charts.sql

-- >>> BEGIN MIGRATION: archive/004_tickets_system.sql
-- 工单系统数据库表结构
-- 支持用户向管理员、管理员向超管提交工单

-- ============================================
-- 0. 清理旧数据（如果存在）
-- ============================================

-- 删除旧的RLS策略
DROP POLICY IF EXISTS "Users can view own tickets" ON tickets;
DROP POLICY IF EXISTS "Admins can view admin tickets" ON tickets;
DROP POLICY IF EXISTS "Super admins can view all tickets" ON tickets;
DROP POLICY IF EXISTS "Users can create tickets" ON tickets;
DROP POLICY IF EXISTS "Users can update own pending tickets" ON tickets;
DROP POLICY IF EXISTS "Admins can update admin tickets" ON tickets;
DROP POLICY IF EXISTS "Super admins can update all tickets" ON tickets;
DROP POLICY IF EXISTS "Users can delete own pending tickets" ON tickets;
DROP POLICY IF EXISTS "Super admins can delete any ticket" ON tickets;

DROP POLICY IF EXISTS "Users can view replies on own tickets" ON ticket_replies;
DROP POLICY IF EXISTS "Admins can view replies on admin tickets" ON ticket_replies;
DROP POLICY IF EXISTS "Super admins can view all replies" ON ticket_replies;
DROP POLICY IF EXISTS "Related users can create replies" ON ticket_replies;

-- 删除旧的触发器和函数
DROP TRIGGER IF EXISTS tickets_updated_at_trigger ON tickets;
DROP FUNCTION IF EXISTS update_tickets_updated_at();
DROP FUNCTION IF EXISTS get_ticket_stats();

-- 删除旧的索引
DROP INDEX IF EXISTS idx_tickets_user_id;
DROP INDEX IF EXISTS idx_tickets_target_role;
DROP INDEX IF EXISTS idx_tickets_status;
DROP INDEX IF EXISTS idx_tickets_created_at;
DROP INDEX IF EXISTS idx_ticket_replies_ticket_id;

-- 删除旧的表（注意顺序：先删除有外键依赖的表）
DROP TABLE IF EXISTS ticket_replies;
DROP TABLE IF EXISTS tickets;

-- ============================================
-- 1. 创建工单主表
-- ============================================
CREATE TABLE IF NOT EXISTS tickets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_role TEXT NOT NULL CHECK (target_role IN ('admin', 'super_admin')),
  type TEXT NOT NULL DEFAULT 'question' CHECK (type IN ('bug', 'feature', 'question', 'data_issue', 'other')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'resolved', 'rejected', 'closed')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  resolution_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. 创建工单回复表
-- ============================================
CREATE TABLE IF NOT EXISTS ticket_replies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT FALSE,  -- 内部备注，仅管理员可见
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 3. 创建索引
-- ============================================
CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_target_role ON tickets(target_role);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_replies_ticket_id ON ticket_replies(ticket_id);

-- ============================================
-- 4. 启用 RLS
-- ============================================
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_replies ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 5. 工单表 RLS 策略
-- ============================================

-- 5.1 查看策略：用户可以查看自己创建的工单
CREATE POLICY "Users can view own tickets"
  ON tickets FOR SELECT
  USING (auth.uid() = user_id);

-- 5.2 查看策略：管理员可以查看发给管理员的工单
CREATE POLICY "Admins can view admin tickets"
  ON tickets FOR SELECT
  USING (
    target_role = 'admin' AND
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

-- 5.3 查看策略：超级管理员可以查看所有工单
CREATE POLICY "Super admins can view all tickets"
  ON tickets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- 5.4 创建策略：认证用户可以创建工单
CREATE POLICY "Users can create tickets"
  ON tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 5.5 更新策略：用户可以更新自己的待处理工单
CREATE POLICY "Users can update own pending tickets"
  ON tickets FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- 5.6 更新策略：管理员可以更新发给管理员的工单
CREATE POLICY "Admins can update admin tickets"
  ON tickets FOR UPDATE
  USING (
    target_role = 'admin' AND
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

-- 5.7 更新策略：超级管理员可以更新所有工单
CREATE POLICY "Super admins can update all tickets"
  ON tickets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- 5.8 删除策略：用户可以删除自己的待处理工单
CREATE POLICY "Users can delete own pending tickets"
  ON tickets FOR DELETE
  USING (auth.uid() = user_id AND status = 'pending');

-- 5.9 删除策略：超级管理员可以删除任何工单
CREATE POLICY "Super admins can delete any ticket"
  ON tickets FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- ============================================
-- 6. 工单回复表 RLS 策略
-- ============================================

-- 6.1 查看策略：可以查看自己工单的回复
CREATE POLICY "Users can view replies on own tickets"
  ON ticket_replies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tickets
      WHERE tickets.id = ticket_replies.ticket_id
      AND tickets.user_id = auth.uid()
    )
    AND (NOT is_internal)  -- 用户看不到内部备注
  );

-- 6.2 查看策略：管理员可以查看管理员工单的回复
CREATE POLICY "Admins can view replies on admin tickets"
  ON ticket_replies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tickets
      WHERE tickets.id = ticket_replies.ticket_id
      AND tickets.target_role = 'admin'
    )
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

-- 6.3 查看策略：超级管理员可以查看所有回复
CREATE POLICY "Super admins can view all replies"
  ON ticket_replies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- 6.4 创建策略：工单相关人员可以创建回复
CREATE POLICY "Related users can create replies"
  ON ticket_replies FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    (
      -- 工单创建者可以回复
      EXISTS (
        SELECT 1 FROM tickets
        WHERE tickets.id = ticket_replies.ticket_id
        AND tickets.user_id = auth.uid()
      )
      OR
      -- 管理员可以回复管理员工单
      (
        EXISTS (
          SELECT 1 FROM tickets
          WHERE tickets.id = ticket_replies.ticket_id
          AND tickets.target_role = 'admin'
        )
        AND EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.role IN ('admin', 'super_admin')
        )
      )
      OR
      -- 超级管理员可以回复任何工单
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
      )
    )
  );

-- ============================================
-- 7. 自动更新 updated_at 触发器
-- ============================================
CREATE OR REPLACE FUNCTION update_tickets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tickets_updated_at_trigger
  BEFORE UPDATE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_tickets_updated_at();

-- ============================================
-- 8. 工单统计 RPC 函数（仅管理员可用）
-- ============================================
CREATE OR REPLACE FUNCTION get_ticket_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  user_role TEXT;
BEGIN
  -- 获取当前用户角色
  SELECT role INTO user_role FROM profiles WHERE id = auth.uid();

  -- 仅管理员可调用
  IF user_role NOT IN ('admin', 'super_admin') THEN
    RETURN json_build_object('error', 'Unauthorized');
  END IF;

  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM tickets), 0),
    'pending', COALESCE((SELECT COUNT(*) FROM tickets WHERE status = 'pending'), 0),
    'processing', COALESCE((SELECT COUNT(*) FROM tickets WHERE status = 'processing'), 0),
    'resolved', COALESCE((SELECT COUNT(*) FROM tickets WHERE status = 'resolved'), 0),
    'byType', json_build_object(
      'bug', COALESCE((SELECT COUNT(*) FROM tickets WHERE type = 'bug'), 0),
      'feature', COALESCE((SELECT COUNT(*) FROM tickets WHERE type = 'feature'), 0),
      'question', COALESCE((SELECT COUNT(*) FROM tickets WHERE type = 'question'), 0),
      'data_issue', COALESCE((SELECT COUNT(*) FROM tickets WHERE type = 'data_issue'), 0),
      'other', COALESCE((SELECT COUNT(*) FROM tickets WHERE type = 'other'), 0)
    ),
    'byPriority', json_build_object(
      'urgent', COALESCE((SELECT COUNT(*) FROM tickets WHERE priority = 'urgent' AND status IN ('pending', 'processing')), 0),
      'high', COALESCE((SELECT COUNT(*) FROM tickets WHERE priority = 'high' AND status IN ('pending', 'processing')), 0),
      'medium', COALESCE((SELECT COUNT(*) FROM tickets WHERE priority = 'medium' AND status IN ('pending', 'processing')), 0),
      'low', COALESCE((SELECT COUNT(*) FROM tickets WHERE priority = 'low' AND status IN ('pending', 'processing')), 0)
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- 授权
GRANT EXECUTE ON FUNCTION get_ticket_stats() TO authenticated;

-- ============================================
-- 9. 添加注释
-- ============================================
COMMENT ON TABLE tickets IS '工单表：用户向管理员或超管提交的问题/建议';
COMMENT ON TABLE ticket_replies IS '工单回复表：工单的对话记录';
COMMENT ON COLUMN tickets.target_role IS '目标角色：admin-发给管理员，super_admin-发给超管';
COMMENT ON COLUMN tickets.type IS '工单类型：bug/feature/question/data_issue/other';
COMMENT ON COLUMN tickets.status IS '状态：pending/processing/resolved/rejected/closed';
COMMENT ON COLUMN tickets.priority IS '优先级：low/medium/high/urgent';
COMMENT ON COLUMN ticket_replies.is_internal IS '是否为内部备注（仅管理员可见）';
-- <<< END MIGRATION: archive/004_tickets_system.sql

-- >>> BEGIN MIGRATION: archive/005_open_view_permissions.sql
-- ============================================
-- RLS 策略更新：方案A - 开放查看权限
-- 所有登录用户都能查看所有卡池和历史记录
-- 但只有管理员能录入/编辑数据
--
-- 执行时间: 2025-12-01
-- 说明: 解决新用户无数据、管理员录入数据不显示的问题
-- ============================================

-- 1. 删除旧的 pools 读取策略
DROP POLICY IF EXISTS "Users can view own pools" ON public.pools;
DROP POLICY IF EXISTS "Admins can view all pools" ON public.pools;

-- 2. 创建新的 pools 读取策略：完全开放查看（包括游客）
CREATE POLICY "All users can view all pools" ON public.pools
  FOR SELECT USING (
    -- 完全开放读取权限，游客和登录用户都能查看
    true
  );

-- 3. 确保写入权限仍然受限（保持现有策略）
-- "Users can insert own pools" - 保持不变
-- "Users can update own pools" - 保持不变
-- "Users can delete own pools" - 保持不变

-- 4. 删除旧的 history 读取策略
DROP POLICY IF EXISTS "Users can view own history" ON public.history;
DROP POLICY IF EXISTS "Admins can view all history" ON public.history;

-- 5. 创建新的 history 读取策略：完全开放查看（包括游客）
CREATE POLICY "All users can view all history" ON public.history
  FOR SELECT USING (
    -- 完全开放读取权限，游客和登录用户都能查看
    true
  );

-- 6. 确保写入权限仍然受限（保持现有策略）
-- "Users can insert own history" - 保持不变
-- "Users can update own history" - 保持不变
-- "Users can delete own history" - 保持不变

-- ============================================
-- 完成！执行后的效果：
-- 1. ✅ 新用户登录后能看到所有现有卡池
-- 2. ✅ 管理员录入的数据会立即显示在看板和记录中
-- 3. ✅ 所有用户看到同一个卡池的全部数据（协作模式）
-- 4. ✅ 写入权限仍受 user_id 保护（安全性）
-- ============================================
-- <<< END MIGRATION: archive/005_open_view_permissions.sql

-- >>> BEGIN MIGRATION: archive/006_superadmin_delete_permissions.sql
-- ============================================
-- RLS 策略更新：超管删除权限
-- 允许超级管理员删除任何用户的数据
-- 普通用户/管理员只能删除自己创建的数据
--
-- 执行时间: 2025-12-02
-- 说明: 修复超管无法删除其他用户数据的问题
-- ============================================

-- 1. 删除旧的 pools 删除策略
DROP POLICY IF EXISTS "Users can delete own pools" ON public.pools;

-- 2. 创建新的 pools 删除策略：超管可删除任何卡池，普通用户只能删除自己的
CREATE POLICY "Users and superadmins can delete pools" ON public.pools
  FOR DELETE USING (
    -- 超管可以删除任何卡池
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
    OR
    -- 普通用户只能删除自己创建的卡池
    user_id = auth.uid()
  );

-- 3. 删除旧的 history 删除策略
DROP POLICY IF EXISTS "Users can delete own history" ON public.history;

-- 4. 创建新的 history 删除策略：超管可删除任何记录，普通用户只能删除自己的
CREATE POLICY "Users and superadmins can delete history" ON public.history
  FOR DELETE USING (
    -- 超管可以删除任何历史记录
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
    OR
    -- 普通用户只能删除自己创建的记录
    user_id = auth.uid()
  );

-- ============================================
-- 完成！执行后的效果：
-- 1. ✅ 超管可以删除任何用户创建的卡池和历史记录
-- 2. ✅ 普通用户/管理员只能删除自己创建的数据
-- 3. ✅ 保持数据安全性的同时，赋予超管完全管理权限
-- ============================================
-- <<< END MIGRATION: archive/006_superadmin_delete_permissions.sql

-- >>> BEGIN MIGRATION: archive/007_add_is_limited_weapon.sql
-- 为 pools 表添加 is_limited_weapon 字段
-- 用于区分限定武器池（有额外获取内容）和常驻武器池（无额外获取）

-- 添加字段，默认为 true（向后兼容：现有武器池默认为限定武器池）
ALTER TABLE public.pools
ADD COLUMN IF NOT EXISTS is_limited_weapon BOOLEAN DEFAULT TRUE;

-- 添加注释说明
COMMENT ON COLUMN public.pools.is_limited_weapon IS '武器池类型：true=限定武器池（有额外获取），false=常驻武器池（无额外获取）。仅当 type=weapon 时有效。';

-- 更新说明：
-- 限定武器池（is_limited_weapon = true）：
--   - 累计申领10次，额外获得补充武库箱×1
--   - 累计申领18次，额外获得限定UP武器×1
--   - 之后每8次申领交替获得
--
-- 常驻武器池（is_limited_weapon = false）：
--   - 无额外获取内容
-- <<< END MIGRATION: archive/007_add_is_limited_weapon.sql

-- >>> BEGIN MIGRATION: archive/008_announcements_table.sql
-- 创建公告表
CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  version VARCHAR(20) NOT NULL DEFAULT '1.0.0',  -- 用于"下次更新前不显示"功能
  is_active BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- 添加注释
COMMENT ON TABLE public.announcements IS '系统公告表';
COMMENT ON COLUMN public.announcements.version IS '公告版本号，用户可选择在此版本更新前不再显示';
COMMENT ON COLUMN public.announcements.is_active IS '公告是否激活显示';
COMMENT ON COLUMN public.announcements.priority IS '显示优先级，数字越大越靠前';

-- 启用 RLS
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- 所有人可读取激活的公告
CREATE POLICY "Anyone can read active announcements"
  ON public.announcements FOR SELECT
  USING (is_active = true);

-- 超级管理员可以管理公告
CREATE POLICY "Super admins can manage announcements"
  ON public.announcements FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- 插入默认公告
INSERT INTO public.announcements (title, content, version, is_active, priority)
VALUES (
  '欢迎使用抽卡分析器',
  '本站为 《明日方舟：终末地》 抽卡数据统计分析工具。

## 功能说明

- 支持**限定池**、**常驻池**、**武器池**数据录入
- 自动计算保底进度、出货分布
- 支持数据导入导出

> 如需录入数据，请登录后申请成为管理员。',
  '2.1.0',
  true,
  1
);
-- <<< END MIGRATION: archive/008_announcements_table.sql

-- >>> BEGIN MIGRATION: archive/009_fix_announcements_version.sql
-- 修复：为已存在的 announcements 表添加缺失的 version 字段

-- 添加 version 字段（如果不存在）
ALTER TABLE public.announcements
ADD COLUMN IF NOT EXISTS version VARCHAR(20) DEFAULT '1.0.0';

-- 添加注释
COMMENT ON COLUMN public.announcements.version IS '公告版本号，用户可选择在此版本更新前不再显示';

-- 确保其他必要字段存在
ALTER TABLE public.announcements
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE public.announcements
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

-- 更新现有公告的版本号（如果为空）
UPDATE public.announcements
SET version = '1.0.0'
WHERE version IS NULL;
-- <<< END MIGRATION: archive/009_fix_announcements_version.sql

-- >>> BEGIN MIGRATION: archive/010_fix_gift_exclusion.sql
-- 修复全服统计RPC函数：排除赠送(gift)的6星统计
-- 在 Supabase SQL Editor 中运行此脚本

DROP FUNCTION IF EXISTS get_global_stats();

CREATE OR REPLACE FUNCTION get_global_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  avg_pity NUMERIC;
  global_distribution JSON;
  limited_stats JSON;
  weapon_stats JSON;
  standard_stats JSON;
BEGIN
  -- 1. 计算全局平均出货（已排除gift）
  WITH ordered_pulls AS (
    SELECT pool_id, user_id, rarity,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM history WHERE special_type IS DISTINCT FROM 'gift'
  ),
  six_stars_with_prev AS (
    SELECT pool_id, user_id, rn,
      LAG(rn, 1, 0) OVER (PARTITION BY pool_id, user_id ORDER BY rn) as prev_rn
    FROM ordered_pulls WHERE rarity = 6
  )
  SELECT COALESCE(AVG(rn - prev_rn), 0) INTO avg_pity FROM six_stars_with_prev;

  -- 2. 计算全局6星出货分布
  WITH ordered_pulls AS (
    SELECT h.pool_id, h.user_id, h.rarity, h.is_standard,
      ROW_NUMBER() OVER (PARTITION BY h.pool_id, h.user_id ORDER BY h.record_id) as rn
    FROM history h WHERE h.special_type IS DISTINCT FROM 'gift'
  ),
  six_stars_pity AS (
    SELECT is_standard,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM ordered_pulls WHERE rarity = 6
  ),
  pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label, is_standard
    FROM six_stars_pity
  ),
  grouped_ranges AS (
    SELECT range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM pity_ranges GROUP BY range_label
  )
  SELECT COALESCE(json_agg(json_build_object(
    'range', REPLACE(range_label, '01-10', '1-10'),
    'limited', limited_count, 'standard', standard_count
  ) ORDER BY range_label), '[]'::json) INTO global_distribution FROM grouped_ranges;

  -- 3. 限定池统计
  WITH limited_pulls AS (
    SELECT h.* FROM history h
    JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
    WHERE p.type = 'limited'
  ),
  limited_valid AS (SELECT * FROM limited_pulls WHERE special_type IS DISTINCT FROM 'gift'),
  limited_ordered AS (
    SELECT pool_id, user_id, rarity, is_standard,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM limited_valid
  ),
  limited_six_pity AS (
    SELECT pool_id, user_id, is_standard,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM limited_ordered WHERE rarity = 6
  ),
  limited_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label, is_standard
    FROM limited_six_pity
  ),
  limited_grouped AS (
    SELECT range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM limited_pity_ranges GROUP BY range_label
  )
  SELECT json_build_object(
    'total', (SELECT COUNT(*) FROM limited_valid),
    'six', (SELECT COUNT(*) FROM limited_valid WHERE rarity = 6),
    'sixStarLimited', (SELECT COUNT(*) FROM limited_valid WHERE rarity = 6 AND is_standard = false),
    'sixStarStandard', (SELECT COUNT(*) FROM limited_valid WHERE rarity = 6 AND is_standard = true),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM limited_six_pity), 1), 0),
    'counts', json_build_object(
      '6', (SELECT COUNT(*) FROM limited_valid WHERE rarity = 6 AND is_standard = false),
      '6_std', (SELECT COUNT(*) FROM limited_valid WHERE rarity = 6 AND is_standard = true),
      '5', (SELECT COUNT(*) FROM limited_valid WHERE rarity = 5),
      '4', (SELECT COUNT(*) FROM limited_valid WHERE rarity <= 4)
    ),
    'distribution', COALESCE((SELECT json_agg(json_build_object(
      'range', REPLACE(range_label, '01-10', '1-10'),
      'limited', limited_count, 'standard', standard_count
    ) ORDER BY range_label) FROM limited_grouped), '[]'::json)
  ) INTO limited_stats;

  -- 4. 武器池统计
  WITH weapon_pulls AS (
    SELECT h.* FROM history h
    JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
    WHERE p.type = 'weapon'
  ),
  weapon_valid AS (SELECT * FROM weapon_pulls WHERE special_type IS DISTINCT FROM 'gift'),
  weapon_ordered AS (
    SELECT pool_id, user_id, rarity, is_standard,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM weapon_valid
  ),
  weapon_six_pity AS (
    SELECT pool_id, user_id, is_standard,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM weapon_ordered WHERE rarity = 6
  ),
  weapon_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label, is_standard
    FROM weapon_six_pity
  ),
  weapon_grouped AS (
    SELECT range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM weapon_pity_ranges GROUP BY range_label
  )
  SELECT json_build_object(
    'total', (SELECT COUNT(*) FROM weapon_valid),
    'six', (SELECT COUNT(*) FROM weapon_valid WHERE rarity = 6),
    'sixStarLimited', (SELECT COUNT(*) FROM weapon_valid WHERE rarity = 6 AND is_standard = false),
    'sixStarStandard', (SELECT COUNT(*) FROM weapon_valid WHERE rarity = 6 AND is_standard = true),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM weapon_six_pity), 1), 0),
    'counts', json_build_object(
      '6', (SELECT COUNT(*) FROM weapon_valid WHERE rarity = 6 AND is_standard = false),
      '6_std', (SELECT COUNT(*) FROM weapon_valid WHERE rarity = 6 AND is_standard = true),
      '5', (SELECT COUNT(*) FROM weapon_valid WHERE rarity = 5),
      '4', (SELECT COUNT(*) FROM weapon_valid WHERE rarity <= 4)
    ),
    'distribution', COALESCE((SELECT json_agg(json_build_object(
      'range', REPLACE(range_label, '01-10', '1-10'),
      'limited', limited_count, 'standard', standard_count
    ) ORDER BY range_label) FROM weapon_grouped), '[]'::json)
  ) INTO weapon_stats;

  -- 5. 常驻池统计
  WITH standard_pulls AS (
    SELECT h.* FROM history h
    JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
    WHERE p.type = 'standard'
  ),
  standard_valid AS (SELECT * FROM standard_pulls WHERE special_type IS DISTINCT FROM 'gift'),
  standard_ordered AS (
    SELECT pool_id, user_id, rarity, is_standard,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM standard_valid
  ),
  standard_six_pity AS (
    SELECT pool_id, user_id, is_standard,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM standard_ordered WHERE rarity = 6
  ),
  standard_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label, is_standard
    FROM standard_six_pity
  ),
  standard_grouped AS (
    SELECT range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM standard_pity_ranges GROUP BY range_label
  )
  SELECT json_build_object(
    'total', (SELECT COUNT(*) FROM standard_valid),
    'six', (SELECT COUNT(*) FROM standard_valid WHERE rarity = 6),
    'sixStarLimited', (SELECT COUNT(*) FROM standard_valid WHERE rarity = 6 AND is_standard = false),
    'sixStarStandard', (SELECT COUNT(*) FROM standard_valid WHERE rarity = 6 AND is_standard = true),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM standard_six_pity), 1), 0),
    'counts', json_build_object(
      '6', (SELECT COUNT(*) FROM standard_valid WHERE rarity = 6 AND is_standard = false),
      '6_std', (SELECT COUNT(*) FROM standard_valid WHERE rarity = 6 AND is_standard = true),
      '5', (SELECT COUNT(*) FROM standard_valid WHERE rarity = 5),
      '4', (SELECT COUNT(*) FROM standard_valid WHERE rarity <= 4)
    ),
    'distribution', COALESCE((SELECT json_agg(json_build_object(
      'range', REPLACE(range_label, '01-10', '1-10'),
      'limited', limited_count, 'standard', standard_count
    ) ORDER BY range_label) FROM standard_grouped), '[]'::json)
  ) INTO standard_stats;

  -- 6. 组装最终结果（全局统计也排除gift）
  WITH valid_history AS (SELECT * FROM history WHERE special_type IS DISTINCT FROM 'gift')
  SELECT json_build_object(
    'totalPulls', (SELECT COUNT(*) FROM valid_history),
    'totalUsers', (SELECT COUNT(*) FROM profiles),
    'sixStarTotal', (SELECT COUNT(*) FROM valid_history WHERE rarity = 6),
    'sixStarLimited', (SELECT COUNT(*) FROM valid_history WHERE rarity = 6 AND is_standard = false),
    'sixStarStandard', (SELECT COUNT(*) FROM valid_history WHERE rarity = 6 AND is_standard = true),
    'fiveStar', (SELECT COUNT(*) FROM valid_history WHERE rarity = 5),
    'fourStar', (SELECT COUNT(*) FROM valid_history WHERE rarity <= 4),
    'avgPity', ROUND(avg_pity, 1),
    'counts', json_build_object(
      '6', (SELECT COUNT(*) FROM valid_history WHERE rarity = 6 AND is_standard = false),
      '6_std', (SELECT COUNT(*) FROM valid_history WHERE rarity = 6 AND is_standard = true),
      '5', (SELECT COUNT(*) FROM valid_history WHERE rarity = 5),
      '4', (SELECT COUNT(*) FROM valid_history WHERE rarity <= 4)
    ),
    'distribution', global_distribution,
    'byType', json_build_object('limited', limited_stats, 'weapon', weapon_stats, 'standard', standard_stats)
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_global_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION get_global_stats() TO anon;
-- <<< END MIGRATION: archive/010_fix_gift_exclusion.sql

-- >>> BEGIN MIGRATION: archive/011_debug_gift_check.sql
-- 调试脚本：检查 gift 数据情况
-- 在 Supabase SQL Editor 中运行此脚本查看结果

-- 1. 检查 special_type 字段的所有不同值
SELECT DISTINCT special_type, COUNT(*) as count
FROM history
GROUP BY special_type;

-- 2. 检查 6 星中有多少是 gift
SELECT
  COUNT(*) as total_six_star,
  COUNT(*) FILTER (WHERE special_type = 'gift') as gift_count,
  COUNT(*) FILTER (WHERE special_type IS NULL) as null_count,
  COUNT(*) FILTER (WHERE special_type IS DISTINCT FROM 'gift') as non_gift_count
FROM history
WHERE rarity = 6;

-- 3. 检查当前 RPC 函数是否存在
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_name = 'get_global_stats';
-- <<< END MIGRATION: archive/011_debug_gift_check.sql

-- >>> BEGIN MIGRATION: archive/012_add_gift_calculation.sql
-- 修复全服统计RPC函数：添加赠送6星计算
-- 赠送规则：
-- 限定池：每240抽赠送1个限定
-- 武器池：100抽送常驻，180抽送限定，之后每80抽交替

DROP FUNCTION IF EXISTS get_global_stats();

CREATE OR REPLACE FUNCTION get_global_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  avg_pity NUMERIC;
  global_distribution JSON;
  limited_stats JSON;
  weapon_stats JSON;
  standard_stats JSON;
  char_gift INT := 0;
  weapon_gift_limited INT := 0;
  weapon_gift_standard INT := 0;
BEGIN
  -- 0. 计算赠送数量（分开角色池和武器池）
  WITH pool_totals AS (
    SELECT p.pool_id, p.user_id, p.type, COUNT(*) as total
    FROM pools p
    JOIN history h ON h.pool_id = p.pool_id AND h.user_id = p.user_id
    WHERE h.special_type IS DISTINCT FROM 'gift'
    GROUP BY p.pool_id, p.user_id, p.type
  )
  SELECT
    COALESCE(SUM(CASE WHEN type = 'limited' THEN FLOOR(total / 240) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type = 'weapon' AND total >= 180 THEN 1 + FLOOR((total - 180) / 160) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type = 'weapon' AND total >= 100 THEN 1 + FLOOR((total - 100) / 160) ELSE 0 END), 0)
  INTO char_gift, weapon_gift_limited, weapon_gift_standard
  FROM pool_totals;

  -- 1. 计算全局平均出货（已排除gift）
  WITH ordered_pulls AS (
    SELECT pool_id, user_id, rarity,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM history WHERE special_type IS DISTINCT FROM 'gift'
  ),
  six_stars_with_prev AS (
    SELECT pool_id, user_id, rn,
      LAG(rn, 1, 0) OVER (PARTITION BY pool_id, user_id ORDER BY rn) as prev_rn
    FROM ordered_pulls WHERE rarity = 6
  )
  SELECT COALESCE(AVG(rn - prev_rn), 0) INTO avg_pity FROM six_stars_with_prev;

  -- 2. 计算全局6星出货分布
  WITH ordered_pulls AS (
    SELECT h.pool_id, h.user_id, h.rarity, h.is_standard,
      ROW_NUMBER() OVER (PARTITION BY h.pool_id, h.user_id ORDER BY h.record_id) as rn
    FROM history h WHERE h.special_type IS DISTINCT FROM 'gift'
  ),
  six_stars_pity AS (
    SELECT is_standard,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM ordered_pulls WHERE rarity = 6
  ),
  pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label, is_standard
    FROM six_stars_pity
  ),
  grouped_ranges AS (
    SELECT range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM pity_ranges GROUP BY range_label
  )
  SELECT COALESCE(json_agg(json_build_object(
    'range', REPLACE(range_label, '01-10', '1-10'),
    'limited', limited_count, 'standard', standard_count
  ) ORDER BY range_label), '[]'::json) INTO global_distribution FROM grouped_ranges;

  -- 3. 限定池统计
  WITH limited_pulls AS (
    SELECT h.* FROM history h
    JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
    WHERE p.type = 'limited'
  ),
  limited_valid AS (SELECT * FROM limited_pulls WHERE special_type IS DISTINCT FROM 'gift'),
  limited_ordered AS (
    SELECT pool_id, user_id, rarity, is_standard,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM limited_valid
  ),
  limited_six_pity AS (
    SELECT pool_id, user_id, is_standard,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM limited_ordered WHERE rarity = 6
  ),
  limited_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label, is_standard
    FROM limited_six_pity
  ),
  limited_grouped AS (
    SELECT range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM limited_pity_ranges GROUP BY range_label
  )
  SELECT json_build_object(
    'total', (SELECT COUNT(*) FROM limited_valid),
    'six', (SELECT COUNT(*) FROM limited_valid WHERE rarity = 6),
    'sixStarLimited', (SELECT COUNT(*) FROM limited_valid WHERE rarity = 6 AND is_standard = false),
    'sixStarStandard', (SELECT COUNT(*) FROM limited_valid WHERE rarity = 6 AND is_standard = true),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM limited_six_pity), 1), 0),
    'counts', json_build_object(
      '6', (SELECT COUNT(*) FROM limited_valid WHERE rarity = 6 AND is_standard = false),
      '6_std', (SELECT COUNT(*) FROM limited_valid WHERE rarity = 6 AND is_standard = true),
      '5', (SELECT COUNT(*) FROM limited_valid WHERE rarity = 5),
      '4', (SELECT COUNT(*) FROM limited_valid WHERE rarity <= 4)
    ),
    'distribution', COALESCE((SELECT json_agg(json_build_object(
      'range', REPLACE(range_label, '01-10', '1-10'),
      'limited', limited_count, 'standard', standard_count
    ) ORDER BY range_label) FROM limited_grouped), '[]'::json)
  ) INTO limited_stats;

  -- 4. 武器池统计
  WITH weapon_pulls AS (
    SELECT h.* FROM history h
    JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
    WHERE p.type = 'weapon'
  ),
  weapon_valid AS (SELECT * FROM weapon_pulls WHERE special_type IS DISTINCT FROM 'gift'),
  weapon_ordered AS (
    SELECT pool_id, user_id, rarity, is_standard,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM weapon_valid
  ),
  weapon_six_pity AS (
    SELECT pool_id, user_id, is_standard,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM weapon_ordered WHERE rarity = 6
  ),
  weapon_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label, is_standard
    FROM weapon_six_pity
  ),
  weapon_grouped AS (
    SELECT range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM weapon_pity_ranges GROUP BY range_label
  )
  SELECT json_build_object(
    'total', (SELECT COUNT(*) FROM weapon_valid),
    'six', (SELECT COUNT(*) FROM weapon_valid WHERE rarity = 6),
    'sixStarLimited', (SELECT COUNT(*) FROM weapon_valid WHERE rarity = 6 AND is_standard = false),
    'sixStarStandard', (SELECT COUNT(*) FROM weapon_valid WHERE rarity = 6 AND is_standard = true),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM weapon_six_pity), 1), 0),
    'counts', json_build_object(
      '6', (SELECT COUNT(*) FROM weapon_valid WHERE rarity = 6 AND is_standard = false),
      '6_std', (SELECT COUNT(*) FROM weapon_valid WHERE rarity = 6 AND is_standard = true),
      '5', (SELECT COUNT(*) FROM weapon_valid WHERE rarity = 5),
      '4', (SELECT COUNT(*) FROM weapon_valid WHERE rarity <= 4)
    ),
    'distribution', COALESCE((SELECT json_agg(json_build_object(
      'range', REPLACE(range_label, '01-10', '1-10'),
      'limited', limited_count, 'standard', standard_count
    ) ORDER BY range_label) FROM weapon_grouped), '[]'::json)
  ) INTO weapon_stats;

  -- 5. 常驻池统计
  WITH standard_pulls AS (
    SELECT h.* FROM history h
    JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
    WHERE p.type = 'standard'
  ),
  standard_valid AS (SELECT * FROM standard_pulls WHERE special_type IS DISTINCT FROM 'gift'),
  standard_ordered AS (
    SELECT pool_id, user_id, rarity, is_standard,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM standard_valid
  ),
  standard_six_pity AS (
    SELECT pool_id, user_id, is_standard,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM standard_ordered WHERE rarity = 6
  ),
  standard_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label, is_standard
    FROM standard_six_pity
  ),
  standard_grouped AS (
    SELECT range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM standard_pity_ranges GROUP BY range_label
  )
  SELECT json_build_object(
    'total', (SELECT COUNT(*) FROM standard_valid),
    'six', (SELECT COUNT(*) FROM standard_valid WHERE rarity = 6),
    'sixStarLimited', (SELECT COUNT(*) FROM standard_valid WHERE rarity = 6 AND is_standard = false),
    'sixStarStandard', (SELECT COUNT(*) FROM standard_valid WHERE rarity = 6 AND is_standard = true),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM standard_six_pity), 1), 0),
    'counts', json_build_object(
      '6', (SELECT COUNT(*) FROM standard_valid WHERE rarity = 6 AND is_standard = false),
      '6_std', (SELECT COUNT(*) FROM standard_valid WHERE rarity = 6 AND is_standard = true),
      '5', (SELECT COUNT(*) FROM standard_valid WHERE rarity = 5),
      '4', (SELECT COUNT(*) FROM standard_valid WHERE rarity <= 4)
    ),
    'distribution', COALESCE((SELECT json_agg(json_build_object(
      'range', REPLACE(range_label, '01-10', '1-10'),
      'limited', limited_count, 'standard', standard_count
    ) ORDER BY range_label) FROM standard_grouped), '[]'::json)
  ) INTO standard_stats;

  -- 6. 组装最终结果
  WITH valid_history AS (SELECT * FROM history WHERE special_type IS DISTINCT FROM 'gift')
  SELECT json_build_object(
    'totalPulls', (SELECT COUNT(*) FROM valid_history),
    'totalUsers', (SELECT COUNT(*) FROM profiles),
    'sixStarTotal', (SELECT COUNT(*) FROM valid_history WHERE rarity = 6),
    'sixStarLimited', (SELECT COUNT(*) FROM valid_history WHERE rarity = 6 AND is_standard = false),
    'sixStarStandard', (SELECT COUNT(*) FROM valid_history WHERE rarity = 6 AND is_standard = true),
    'fiveStar', (SELECT COUNT(*) FROM valid_history WHERE rarity = 5),
    'fourStar', (SELECT COUNT(*) FROM valid_history WHERE rarity <= 4),
    'avgPity', ROUND(avg_pity, 1),
    'charGift', char_gift,
    'weaponGiftLimited', weapon_gift_limited,
    'weaponGiftStandard', weapon_gift_standard,
    'giftTotal', char_gift + weapon_gift_limited + weapon_gift_standard,
    'counts', json_build_object(
      '6', (SELECT COUNT(*) FROM valid_history WHERE rarity = 6 AND is_standard = false),
      '6_std', (SELECT COUNT(*) FROM valid_history WHERE rarity = 6 AND is_standard = true),
      '5', (SELECT COUNT(*) FROM valid_history WHERE rarity = 5),
      '4', (SELECT COUNT(*) FROM valid_history WHERE rarity <= 4)
    ),
    'distribution', global_distribution,
    'byType', json_build_object('limited', limited_stats, 'weapon', weapon_stats, 'standard', standard_stats)
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_global_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION get_global_stats() TO anon;
-- <<< END MIGRATION: archive/012_add_gift_calculation.sql

-- >>> BEGIN MIGRATION: archive/013_debug_limited_six.sql
-- 调试：检查限定池6星数量
-- 在 Supabase SQL Editor 中运行

-- 1. 查看限定池的所有6星记录
SELECT h.record_id, h.rarity, h.is_standard, h.special_type, p.type as pool_type, p.pool_id
FROM history h
JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
WHERE p.type = 'limited' AND h.rarity = 6
ORDER BY h.record_id;

-- 2. 统计限定池6星数量（排除gift）
SELECT
  COUNT(*) as total_six,
  COUNT(*) FILTER (WHERE special_type IS DISTINCT FROM 'gift') as six_excluding_gift,
  COUNT(*) FILTER (WHERE special_type = 'gift') as gift_six
FROM history h
JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
WHERE p.type = 'limited' AND h.rarity = 6;

-- 3. 查看限定池总抽数
SELECT p.pool_id, p.type, COUNT(*) as total_pulls
FROM history h
JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
WHERE p.type = 'limited'
GROUP BY p.pool_id, p.type;
-- <<< END MIGRATION: archive/013_debug_limited_six.sql

-- >>> BEGIN MIGRATION: archive/014_analyze_six_star_pulls.sql
-- 详细分析限定池6星出货情况
-- 在 Supabase SQL Editor 中运行

-- 1. 查看每个6星的出货位置和垫刀数
WITH ordered_pulls AS (
  SELECT 
    h.record_id,
    h.rarity,
    h.is_standard,
    h.special_type,
    ROW_NUMBER() OVER (ORDER BY h.record_id) as pull_number
  FROM history h
  JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
  WHERE p.type = 'limited'
),
six_stars_with_pity AS (
  SELECT 
    record_id,
    is_standard,
    special_type,
    pull_number,
    pull_number - COALESCE(LAG(pull_number) OVER (ORDER BY pull_number), 0) as pity_count
  FROM ordered_pulls
  WHERE rarity = 6
)
SELECT 
  ROW_NUMBER() OVER (ORDER BY pull_number) as "第几个6星",
  record_id as "记录ID",
  CASE WHEN is_standard THEN '常驻(歪)' ELSE '限定UP' END as "类型",
  COALESCE(special_type, '普通抽取') as "特殊标记",
  pull_number as "第几抽出的",
  pity_count as "垫刀数"
FROM six_stars_with_pity
ORDER BY pull_number;

-- 2. 统计总览
SELECT 
  '总抽数' as "指标",
  COUNT(*)::text as "数值"
FROM history h
JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
WHERE p.type = 'limited'

UNION ALL

SELECT 
  '6星总数',
  COUNT(*)::text
FROM history h
JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
WHERE p.type = 'limited' AND h.rarity = 6

UNION ALL

SELECT 
  '限定UP数',
  COUNT(*)::text
FROM history h
JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
WHERE p.type = 'limited' AND h.rarity = 6 AND h.is_standard = false

UNION ALL

SELECT 
  '常驻歪数',
  COUNT(*)::text
FROM history h
JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
WHERE p.type = 'limited' AND h.rarity = 6 AND h.is_standard = true

UNION ALL

SELECT 
  '计算平均出货',
  ROUND(480.0 / NULLIF((SELECT COUNT(*) FROM history h JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id WHERE p.type = 'limited' AND h.rarity = 6), 0), 1)::text

UNION ALL

SELECT
  '理论赠送数(480/240)',
  FLOOR(480 / 240)::text;

-- 3. 检查是否有异常的垫刀数（比如 0 或 1，可能是赠送误录入）
-- 正常抽卡至少需要 1 抽，赠送的如果误录入可能垫刀数为 0 或很小
-- <<< END MIGRATION: archive/014_analyze_six_star_pulls.sql

-- >>> BEGIN MIGRATION: archive/015_superadmin_user_management.sql
-- ============================================
-- 超级管理员用户管理权限配置
-- 允许超级管理员完整管理用户（增删改）
--
-- 执行时间: 2025-12-04
-- 说明: 为超管的用户增删改功能添加必要的权限
-- ============================================

-- 1. 确保 profiles 表有超管删除权限
DROP POLICY IF EXISTS "Enable delete for super_admin" ON public.profiles;

CREATE POLICY "Enable delete for super_admin" ON public.profiles
  FOR DELETE USING (
    -- 超管可以删除任何 profile（但不能删除自己）
    EXISTS (
      SELECT 1 FROM public.profiles as p
      WHERE p.id = auth.uid()
      AND p.role = 'super_admin'
    )
    AND id != auth.uid() -- 防止超管删除自己
  );

-- 2. 确保 profiles 表有超管更新权限
DROP POLICY IF EXISTS "Enable update for super_admin" ON public.profiles;

CREATE POLICY "Enable update for super_admin" ON public.profiles
  FOR UPDATE USING (
    -- 超管可以更新任何 profile
    EXISTS (
      SELECT 1 FROM public.profiles as p
      WHERE p.id = auth.uid()
      AND p.role = 'super_admin'
    )
    OR
    -- 用户可以更新自己的 profile
    id = auth.uid()
  );

-- 3. 确保 profiles 表有插入权限（注册新用户时需要）
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.profiles;

CREATE POLICY "Enable insert for authenticated users" ON public.profiles
  FOR INSERT WITH CHECK (true);

-- 4. 确保 admin_applications 表有超管删除权限
DROP POLICY IF EXISTS "Enable delete for super_admin on applications" ON public.admin_applications;

CREATE POLICY "Enable delete for super_admin on applications" ON public.admin_applications
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- 5. 创建一个函数来检查当前用户是否为超管（方便前端调用）
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role = 'super_admin'
  );
END;
$$;

-- ============================================
-- 重要提示：
--
-- 1. ⚠️ Auth Admin API 限制
--    - supabase.auth.admin.createUser() 需要 service_role key
--    - supabase.auth.admin.deleteUser() 需要 service_role key
--    - 前端无法直接使用这些 API（安全风险）
--
-- 2. 🔒 推荐方案：创建 Supabase Edge Functions
--    - 在服务端使用 service_role key
--    - 前端通过安全的 API 调用这些函数
--    - 参考：https://supabase.com/docs/guides/functions
--
-- 3. 📝 如果必须在前端使用（仅开发环境）：
--    - 需要在 .env 中添加 VITE_SUPABASE_SERVICE_ROLE_KEY
--    - 修改 supabaseClient.js 创建管理员客户端
--    - ⚠️ 切勿在生产环境暴露 service_role key！
--
-- ============================================
-- <<< END MIGRATION: archive/015_superadmin_user_management.sql

-- >>> BEGIN MIGRATION: archive/016_blacklist_table.sql
-- 黑名单表
-- 用于阻止特定邮箱或域名注册

CREATE TABLE IF NOT EXISTS public.blacklist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,  -- 邮箱地址或域名
  type TEXT NOT NULL DEFAULT 'email' CHECK (type IN ('email', 'domain')),  -- 类型：email=邮箱地址, domain=域名
  reason TEXT,  -- 拉黑原因
  created_by UUID REFERENCES auth.users(id),  -- 操作者
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_blacklist_email ON public.blacklist(email);
CREATE INDEX IF NOT EXISTS idx_blacklist_type ON public.blacklist(type);

-- RLS 策略
ALTER TABLE public.blacklist ENABLE ROW LEVEL SECURITY;

-- 只有超级管理员可以查看和管理黑名单
CREATE POLICY "超管可查看黑名单" ON public.blacklist
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

CREATE POLICY "超管可添加黑名单" ON public.blacklist
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

CREATE POLICY "超管可删除黑名单" ON public.blacklist
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- 创建函数：检查邮箱是否在黑名单中
CREATE OR REPLACE FUNCTION public.is_email_blacklisted(check_email TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  email_domain TEXT;
BEGIN
  -- 提取域名
  email_domain := split_part(check_email, '@', 2);
  
  -- 检查完整邮箱或域名是否在黑名单中
  RETURN EXISTS (
    SELECT 1 FROM public.blacklist
    WHERE 
      (type = 'email' AND LOWER(email) = LOWER(check_email))
      OR 
      (type = 'domain' AND LOWER(email) = LOWER(email_domain))
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 授权
GRANT EXECUTE ON FUNCTION public.is_email_blacklisted(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_email_blacklisted(TEXT) TO anon;

COMMENT ON TABLE public.blacklist IS '邮箱/域名黑名单表，用于阻止刷号行为';
COMMENT ON COLUMN public.blacklist.type IS '类型：email=完整邮箱地址, domain=邮箱域名';
-- <<< END MIGRATION: archive/016_blacklist_table.sql

-- >>> BEGIN MIGRATION: archive/017_email_domain_validation.sql
-- ============================================
-- 017: 邮箱域名白名单验证 (后端实现)
-- 修复 SEC-001: 将前端验证移至后端
-- ============================================

-- 创建邮箱白名单表
CREATE TABLE IF NOT EXISTS email_whitelist (
    id SERIAL PRIMARY KEY,
    domain TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('mainstream', 'community', 'corporate')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 插入主流邮箱服务商
INSERT INTO email_whitelist (domain, type) VALUES
    -- 国际
    ('gmail.com', 'mainstream'),
    ('googlemail.com', 'mainstream'),
    ('outlook.com', 'mainstream'),
    ('hotmail.com', 'mainstream'),
    ('live.com', 'mainstream'),
    ('msn.com', 'mainstream'),
    ('yahoo.com', 'mainstream'),
    ('yahoo.co.jp', 'mainstream'),
    ('yahoo.co.uk', 'mainstream'),
    ('icloud.com', 'mainstream'),
    ('me.com', 'mainstream'),
    ('mac.com', 'mainstream'),
    ('protonmail.com', 'mainstream'),
    ('proton.me', 'mainstream'),
    ('zoho.com', 'mainstream'),
    ('aol.com', 'mainstream'),
    ('mail.com', 'mainstream'),
    ('gmx.com', 'mainstream'),
    ('gmx.net', 'mainstream'),
    ('yandex.com', 'mainstream'),
    ('yandex.ru', 'mainstream'),
    -- 国内
    ('qq.com', 'mainstream'),
    ('foxmail.com', 'mainstream'),
    ('163.com', 'mainstream'),
    ('126.com', 'mainstream'),
    ('yeah.net', 'mainstream'),
    ('netease.com', 'mainstream'),
    ('sina.com', 'mainstream'),
    ('sina.cn', 'mainstream'),
    ('sohu.com', 'mainstream'),
    ('aliyun.com', 'mainstream'),
    ('alibaba-inc.com', 'mainstream'),
    ('189.cn', 'mainstream'),
    ('21cn.com', 'mainstream'),
    ('tom.com', 'mainstream')
ON CONFLICT (domain) DO NOTHING;

-- 插入知名社区邮箱
INSERT INTO email_whitelist (domain, type) VALUES
    ('linux.do', 'community'),
    ('v2ex.com', 'community'),
    ('github.com', 'community'),
    ('gitlab.com', 'community'),
    ('bitbucket.org', 'community'),
    ('sourcehut.org', 'community')
ON CONFLICT (domain) DO NOTHING;

-- 插入知名企业邮箱
INSERT INTO email_whitelist (domain, type) VALUES
    ('microsoft.com', 'corporate'),
    ('apple.com', 'corporate'),
    ('google.com', 'corporate'),
    ('amazon.com', 'corporate'),
    ('meta.com', 'corporate'),
    ('facebook.com', 'corporate'),
    ('tencent.com', 'corporate'),
    ('alibaba.com', 'corporate'),
    ('bytedance.com', 'corporate'),
    ('baidu.com', 'corporate'),
    ('bilibili.com', 'corporate'),
    ('mihoyo.com', 'corporate'),
    ('hypergryph.com', 'corporate'),
    ('gryphline.com', 'corporate')
ON CONFLICT (domain) DO NOTHING;

-- 创建邮箱域名验证函数 (RPC)
CREATE OR REPLACE FUNCTION validate_email_domain(check_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    email_domain TEXT;
    is_valid BOOLEAN := FALSE;
    reject_reason TEXT := '';
BEGIN
    -- 检查邮箱格式
    IF check_email IS NULL OR check_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RETURN jsonb_build_object('valid', false, 'reason', '邮箱格式不正确');
    END IF;

    -- 提取域名
    email_domain := LOWER(SPLIT_PART(check_email, '@', 2));

    -- 1. 检查是否在黑名单中
    IF EXISTS (SELECT 1 FROM email_blacklist WHERE 
        (type = 'email' AND LOWER(email) = LOWER(check_email)) OR
        (type = 'domain' AND LOWER(email) = email_domain)
    ) THEN
        RETURN jsonb_build_object('valid', false, 'reason', '该邮箱已被禁止注册');
    END IF;

    -- 2. 检查精确匹配的域名
    IF EXISTS (SELECT 1 FROM email_whitelist WHERE domain = email_domain) THEN
        is_valid := TRUE;
    END IF;

    -- 返回结果
    IF is_valid THEN
        RETURN jsonb_build_object('valid', true);
    ELSE
        RETURN jsonb_build_object(
            'valid', false, 
            'reason', '请使用主流邮箱服务商（如 Gmail、Outlook、QQ邮箱、163邮箱等）、知名论坛/社区邮箱或企业邮箱注册'
        );
    END IF;
END;
$$;

-- 授权匿名用户可以调用此函数
GRANT EXECUTE ON FUNCTION validate_email_domain(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION validate_email_domain(TEXT) TO authenticated;

-- 允许读取白名单表（用于调试）
-- GRANT SELECT ON email_whitelist TO authenticated;

COMMENT ON FUNCTION validate_email_domain IS '验证邮箱域名是否在白名单中，防止临时邮箱注册';
COMMENT ON TABLE email_whitelist IS '邮箱域名白名单，用于注册验证';
-- <<< END MIGRATION: archive/017_email_domain_validation.sql

-- >>> BEGIN MIGRATION: archive/018_rate_limiting.sql
-- ============================================
-- 018: API 请求频率限制
-- 修复 SEC-002: 防止暴力破解和滥用
-- ============================================

-- 创建请求记录表
CREATE TABLE IF NOT EXISTS rate_limit_logs (
    id SERIAL PRIMARY KEY,
    identifier TEXT NOT NULL,           -- IP地址或用户ID
    action TEXT NOT NULL,               -- 操作类型: 'login', 'register', 'password_reset'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建索引加速查询
CREATE INDEX IF NOT EXISTS idx_rate_limit_logs_lookup 
ON rate_limit_logs (identifier, action, created_at DESC);

-- 自动清理过期记录（保留24小时）
CREATE OR REPLACE FUNCTION cleanup_rate_limit_logs()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM rate_limit_logs WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$;

-- 频率限制配置
CREATE TABLE IF NOT EXISTS rate_limit_config (
    action TEXT PRIMARY KEY,
    max_attempts INT NOT NULL,          -- 最大尝试次数
    window_minutes INT NOT NULL,        -- 时间窗口（分钟）
    lockout_minutes INT DEFAULT 30      -- 锁定时间（分钟）
);

-- 插入默认配置
INSERT INTO rate_limit_config (action, max_attempts, window_minutes, lockout_minutes) VALUES
    ('login', 5, 15, 30),               -- 15分钟内最多5次登录尝试，超过后锁定30分钟
    ('register', 3, 60, 60),            -- 60分钟内最多3次注册尝试
    ('password_reset', 3, 60, 60),      -- 60分钟内最多3次密码重置
    ('email_verify', 3, 60, 60)         -- 60分钟内最多3次发送验证邮件
ON CONFLICT (action) DO NOTHING;

-- 检查是否超过频率限制
CREATE OR REPLACE FUNCTION check_rate_limit(
    p_identifier TEXT,
    p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    config_row rate_limit_config%ROWTYPE;
    attempt_count INT;
    oldest_attempt TIMESTAMPTZ;
    lockout_until TIMESTAMPTZ;
BEGIN
    -- 获取配置
    SELECT * INTO config_row FROM rate_limit_config WHERE action = p_action;
    
    IF config_row IS NULL THEN
        -- 如果没有配置，默认允许
        RETURN jsonb_build_object('allowed', true);
    END IF;

    -- 计算时间窗口内的尝试次数
    SELECT COUNT(*), MIN(created_at)
    INTO attempt_count, oldest_attempt
    FROM rate_limit_logs
    WHERE identifier = p_identifier
      AND action = p_action
      AND created_at > NOW() - (config_row.window_minutes || ' minutes')::INTERVAL;

    -- 检查是否超过限制
    IF attempt_count >= config_row.max_attempts THEN
        lockout_until := oldest_attempt + (config_row.window_minutes + config_row.lockout_minutes || ' minutes')::INTERVAL;
        
        IF lockout_until > NOW() THEN
            RETURN jsonb_build_object(
                'allowed', false,
                'reason', '操作过于频繁，请稍后再试',
                'retry_after', EXTRACT(EPOCH FROM (lockout_until - NOW()))::INT,
                'lockout_until', lockout_until
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'allowed', true,
        'remaining', config_row.max_attempts - attempt_count,
        'reset_at', NOW() + (config_row.window_minutes || ' minutes')::INTERVAL
    );
END;
$$;

-- 记录请求
CREATE OR REPLACE FUNCTION log_rate_limit(
    p_identifier TEXT,
    p_action TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO rate_limit_logs (identifier, action) VALUES (p_identifier, p_action);
END;
$$;

-- 组合函数：检查并记录
CREATE OR REPLACE FUNCTION check_and_log_rate_limit(
    p_identifier TEXT,
    p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    check_result JSONB;
BEGIN
    -- 先检查
    check_result := check_rate_limit(p_identifier, p_action);
    
    -- 如果允许，记录这次请求
    IF (check_result->>'allowed')::BOOLEAN THEN
        PERFORM log_rate_limit(p_identifier, p_action);
    END IF;
    
    RETURN check_result;
END;
$$;

-- 授权
GRANT EXECUTE ON FUNCTION check_rate_limit(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION check_rate_limit(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION log_rate_limit(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION log_rate_limit(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION check_and_log_rate_limit(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION check_and_log_rate_limit(TEXT, TEXT) TO authenticated;

-- 定期清理任务（需要 pg_cron 扩展，如果可用）
-- SELECT cron.schedule('cleanup-rate-limits', '0 * * * *', 'SELECT cleanup_rate_limit_logs()');

COMMENT ON TABLE rate_limit_logs IS '请求频率限制日志表';
COMMENT ON TABLE rate_limit_config IS '频率限制配置表';
COMMENT ON FUNCTION check_rate_limit IS '检查是否超过频率限制';
COMMENT ON FUNCTION check_and_log_rate_limit IS '检查频率限制并记录请求';
-- <<< END MIGRATION: archive/018_rate_limiting.sql

-- >>> BEGIN MIGRATION: archive/019_enable_rls_security_fix.sql
-- ============================================
-- 019: 启用 RLS 安全修复
-- 修复 Supabase Linter 检测到的安全问题
-- ============================================

-- ============================================
-- 1. email_whitelist 表 RLS
-- ============================================
ALTER TABLE public.email_whitelist ENABLE ROW LEVEL SECURITY;

-- 删除可能存在的旧策略
DROP POLICY IF EXISTS "email_whitelist_select_all" ON public.email_whitelist;
DROP POLICY IF EXISTS "email_whitelist_admin_insert" ON public.email_whitelist;
DROP POLICY IF EXISTS "email_whitelist_admin_update" ON public.email_whitelist;
DROP POLICY IF EXISTS "email_whitelist_admin_delete" ON public.email_whitelist;

-- 策略：所有人可以读取（用于 validate_email_domain RPC 函数）
CREATE POLICY "email_whitelist_select_all" ON public.email_whitelist
  FOR SELECT USING (true);

-- 策略：只有超级管理员可以增删改
CREATE POLICY "email_whitelist_admin_insert" ON public.email_whitelist
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

CREATE POLICY "email_whitelist_admin_update" ON public.email_whitelist
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

CREATE POLICY "email_whitelist_admin_delete" ON public.email_whitelist
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- ============================================
-- 2. rate_limit_logs 表 RLS
-- ============================================
ALTER TABLE public.rate_limit_logs ENABLE ROW LEVEL SECURITY;

-- 删除可能存在的旧策略
DROP POLICY IF EXISTS "rate_limit_logs_no_direct_access" ON public.rate_limit_logs;

-- 策略：不允许直接访问（通过 SECURITY DEFINER 函数访问）
-- 这样用户无法直接查询或操作日志，只能通过 RPC 函数
CREATE POLICY "rate_limit_logs_no_direct_access" ON public.rate_limit_logs
  FOR ALL USING (false);

-- 注意：SECURITY DEFINER 函数会以函数创建者的权限执行，
-- 绕过 RLS 策略，所以 RPC 函数仍然可以正常工作

-- ============================================
-- 3. rate_limit_config 表 RLS
-- ============================================
ALTER TABLE public.rate_limit_config ENABLE ROW LEVEL SECURITY;

-- 删除可能存在的旧策略
DROP POLICY IF EXISTS "rate_limit_config_select_all" ON public.rate_limit_config;
DROP POLICY IF EXISTS "rate_limit_config_admin_insert" ON public.rate_limit_config;
DROP POLICY IF EXISTS "rate_limit_config_admin_update" ON public.rate_limit_config;
DROP POLICY IF EXISTS "rate_limit_config_admin_delete" ON public.rate_limit_config;

-- 策略：所有人可以读取配置（用于 check_rate_limit RPC 函数）
CREATE POLICY "rate_limit_config_select_all" ON public.rate_limit_config
  FOR SELECT USING (true);

-- 策略：只有超级管理员可以修改配置
CREATE POLICY "rate_limit_config_admin_insert" ON public.rate_limit_config
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

CREATE POLICY "rate_limit_config_admin_update" ON public.rate_limit_config
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

CREATE POLICY "rate_limit_config_admin_delete" ON public.rate_limit_config
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- ============================================
-- 注释
-- ============================================
COMMENT ON POLICY "email_whitelist_select_all" ON public.email_whitelist 
  IS '允许所有用户读取邮箱白名单，用于注册验证';

COMMENT ON POLICY "rate_limit_logs_no_direct_access" ON public.rate_limit_logs 
  IS '禁止直接访问频率限制日志，只能通过 SECURITY DEFINER 函数访问';

COMMENT ON POLICY "rate_limit_config_select_all" ON public.rate_limit_config 
  IS '允许所有用户读取频率限制配置';
-- <<< END MIGRATION: archive/019_enable_rls_security_fix.sql

-- >>> BEGIN MIGRATION: archive/020_fix_function_search_path.sql
-- ============================================
-- 020: 修复函数 search_path 安全警告
-- 为所有 SECURITY DEFINER 函数添加 SET search_path = public
-- ============================================

-- ============================================
-- 1. validate_email_domain
-- ============================================
CREATE OR REPLACE FUNCTION public.validate_email_domain(check_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    email_domain TEXT;
    is_valid BOOLEAN := FALSE;
BEGIN
    -- 检查邮箱格式
    IF check_email IS NULL OR check_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RETURN jsonb_build_object('valid', false, 'reason', '邮箱格式不正确');
    END IF;

    -- 提取域名
    email_domain := LOWER(SPLIT_PART(check_email, '@', 2));

    -- 1. 检查是否在黑名单中
    IF EXISTS (SELECT 1 FROM public.email_blacklist WHERE 
        (type = 'email' AND LOWER(email) = LOWER(check_email)) OR
        (type = 'domain' AND LOWER(email) = email_domain)
    ) THEN
        RETURN jsonb_build_object('valid', false, 'reason', '该邮箱已被禁止注册');
    END IF;

    -- 2. 检查精确匹配的域名
    IF EXISTS (SELECT 1 FROM public.email_whitelist WHERE domain = email_domain) THEN
        is_valid := TRUE;
    END IF;

    -- 返回结果
    IF is_valid THEN
        RETURN jsonb_build_object('valid', true);
    ELSE
        RETURN jsonb_build_object(
            'valid', false, 
            'reason', '请使用主流邮箱服务商（如 Gmail、Outlook、QQ邮箱、163邮箱等）、知名论坛/社区邮箱或企业邮箱注册'
        );
    END IF;
END;
$$;

-- ============================================
-- 2. is_email_blacklisted (如果存在)
-- ============================================
CREATE OR REPLACE FUNCTION public.is_email_blacklisted(check_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    email_domain TEXT;
BEGIN
    IF check_email IS NULL THEN
        RETURN FALSE;
    END IF;
    
    email_domain := LOWER(SPLIT_PART(check_email, '@', 2));
    
    RETURN EXISTS (
        SELECT 1 FROM public.email_blacklist 
        WHERE (type = 'email' AND LOWER(email) = LOWER(check_email))
           OR (type = 'domain' AND LOWER(email) = email_domain)
    );
END;
$$;

-- ============================================
-- 3. cleanup_rate_limit_logs
-- ============================================
CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.rate_limit_logs WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$;

-- ============================================
-- 4. check_rate_limit
-- ============================================
CREATE OR REPLACE FUNCTION public.check_rate_limit(
    p_identifier TEXT,
    p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    config_row public.rate_limit_config%ROWTYPE;
    attempt_count INT;
    oldest_attempt TIMESTAMPTZ;
    lockout_until TIMESTAMPTZ;
BEGIN
    -- 获取配置
    SELECT * INTO config_row FROM public.rate_limit_config WHERE action = p_action;
    
    IF config_row IS NULL THEN
        RETURN jsonb_build_object('allowed', true);
    END IF;

    -- 计算时间窗口内的尝试次数
    SELECT COUNT(*), MIN(created_at)
    INTO attempt_count, oldest_attempt
    FROM public.rate_limit_logs
    WHERE identifier = p_identifier
      AND action = p_action
      AND created_at > NOW() - (config_row.window_minutes || ' minutes')::INTERVAL;

    -- 检查是否超过限制
    IF attempt_count >= config_row.max_attempts THEN
        lockout_until := oldest_attempt + (config_row.window_minutes + config_row.lockout_minutes || ' minutes')::INTERVAL;
        
        IF lockout_until > NOW() THEN
            RETURN jsonb_build_object(
                'allowed', false,
                'reason', '操作过于频繁，请稍后再试',
                'retry_after', EXTRACT(EPOCH FROM (lockout_until - NOW()))::INT,
                'lockout_until', lockout_until
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'allowed', true,
        'remaining', config_row.max_attempts - attempt_count,
        'reset_at', NOW() + (config_row.window_minutes || ' minutes')::INTERVAL
    );
END;
$$;

-- ============================================
-- 5. log_rate_limit
-- ============================================
CREATE OR REPLACE FUNCTION public.log_rate_limit(
    p_identifier TEXT,
    p_action TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.rate_limit_logs (identifier, action) VALUES (p_identifier, p_action);
END;
$$;

-- ============================================
-- 6. check_and_log_rate_limit
-- ============================================
CREATE OR REPLACE FUNCTION public.check_and_log_rate_limit(
    p_identifier TEXT,
    p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    check_result JSONB;
BEGIN
    check_result := public.check_rate_limit(p_identifier, p_action);
    
    IF (check_result->>'allowed')::BOOLEAN THEN
        PERFORM public.log_rate_limit(p_identifier, p_action);
    END IF;
    
    RETURN check_result;
END;
$$;

-- ============================================
-- 7. is_super_admin
-- ============================================
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role = 'super_admin'
    );
END;
$$;

-- ============================================
-- 8. handle_new_user
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, username, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'username', SPLIT_PART(NEW.email, '@', 1)),
        'user'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

-- ============================================
-- 9. update_tickets_updated_at
-- ============================================
CREATE OR REPLACE FUNCTION public.update_tickets_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- ============================================
-- 重新授权
-- ============================================
GRANT EXECUTE ON FUNCTION public.validate_email_domain(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.validate_email_domain(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_email_blacklisted(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.is_email_blacklisted(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_rate_limit(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.log_rate_limit(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_log_rate_limit(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.check_and_log_rate_limit(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
-- <<< END MIGRATION: archive/020_fix_function_search_path.sql

-- >>> BEGIN MIGRATION: archive/021_fix_locked_pool_protection.sql
-- ============================================
-- 修复 locked 卡池权限保护漏洞
-- 日期: 2025-12-16
-- 问题: DB-NEW-001 & SEC-NEW-003
-- 描述:
--   1. 普通管理员可以修改 pools.locked 字段,绕过超管锁定
--   2. 前端验证可被绕过,恶意用户可在locked卡池中插入数据
-- ============================================

-- ============================================
-- 1. 修复 pools 表 UPDATE 策略
-- ============================================

-- 删除旧的 UPDATE 策略
DROP POLICY IF EXISTS "pools_update_policy" ON public.pools;

-- 创建新的 UPDATE 策略,保护 locked 字段
-- 注意: PostgreSQL RLS 不支持在 WITH CHECK 中直接使用 OLD
-- 因此我们需要使用触发器来保护 locked 字段
CREATE POLICY "pools_update_policy" ON public.pools
  FOR UPDATE
  USING (
    auth.uid() = user_id
  );

COMMENT ON POLICY "pools_update_policy" ON public.pools IS
  '用户可以更新自己的卡池';

-- 创建触发器函数来保护 locked 字段
CREATE OR REPLACE FUNCTION protect_locked_field()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_role TEXT;
BEGIN
  -- 如果 locked 字段没有变化,允许更新
  IF OLD.locked = NEW.locked THEN
    RETURN NEW;
  END IF;

  -- 如果 locked 字段发生变化,检查用户角色
  SELECT role INTO user_role
  FROM public.profiles
  WHERE id = auth.uid();

  -- 只有超管可以修改 locked 字段
  IF user_role = 'super_admin' THEN
    RETURN NEW;
  ELSE
    RAISE EXCEPTION 'Only super admin can modify locked field';
  END IF;
END;
$$;

-- 创建触发器
DROP TRIGGER IF EXISTS protect_locked_field_trigger ON public.pools;
CREATE TRIGGER protect_locked_field_trigger
  BEFORE UPDATE ON public.pools
  FOR EACH ROW
  EXECUTE FUNCTION protect_locked_field();

COMMENT ON FUNCTION protect_locked_field() IS
  '保护 locked 字段只能由超管修改';
COMMENT ON TRIGGER protect_locked_field_trigger ON public.pools IS
  '触发器: 保护 locked 字段';

-- ============================================
-- 2. 修复 history 表 INSERT 策略
-- ============================================

-- 删除旧的 INSERT 策略
DROP POLICY IF EXISTS "history_insert_policy" ON public.history;

-- 创建新的 INSERT 策略,检查卡池是否被锁定
CREATE POLICY "history_insert_policy" ON public.history
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND (
      -- 如果卡池未锁定,允许插入
      -- 如果卡池已锁定,只有超管可以插入
      NOT EXISTS (
        SELECT 1 FROM public.pools
        WHERE pools.pool_id = history.pool_id
          AND pools.user_id = history.user_id
          AND pools.locked = true
      )
      OR
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND role = 'super_admin'
      )
    )
  );

COMMENT ON POLICY "history_insert_policy" ON public.history IS
  '用户可以插入抽卡记录,但不能在已锁定的卡池中插入(超管除外)';

-- ============================================
-- 3. 安全验证测试 (可选,用于验证修复)
-- ============================================

-- 测试用例说明:
-- 1. 普通用户尝试修改 locked 字段应该失败
-- 2. 普通管理员尝试在 locked 卡池中插入记录应该失败
-- 3. 超管可以修改 locked 字段
-- 4. 超管可以在 locked 卡池中插入记录

-- 创建测试函数 (可选)
CREATE OR REPLACE FUNCTION test_locked_pool_protection()
RETURNS TABLE (
  test_name TEXT,
  passed BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 测试1: 验证 pools UPDATE 策略是否正确设置
  RETURN QUERY
  SELECT
    'pools_update_policy_exists'::TEXT,
    EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'pools'
        AND policyname = 'pools_update_policy'
    ),
    'pools UPDATE 策略已创建'::TEXT;

  -- 测试2: 验证 history INSERT 策略是否正确设置
  RETURN QUERY
  SELECT
    'history_insert_policy_exists'::TEXT,
    EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'history'
        AND policyname = 'history_insert_policy'
    ),
    'history INSERT 策略已创建'::TEXT;

  RETURN;
END;
$$;

COMMENT ON FUNCTION test_locked_pool_protection() IS
  '测试 locked 卡池保护功能是否正确配置';

-- ============================================
-- 迁移完成
-- ============================================

-- 记录迁移日志
DO $$
BEGIN
  RAISE NOTICE '===========================================';
  RAISE NOTICE '迁移 021: locked 卡池权限保护修复完成';
  RAISE NOTICE '修复问题: DB-NEW-001, SEC-NEW-003';
  RAISE NOTICE '执行时间: %', NOW();
  RAISE NOTICE '===========================================';
END $$;
-- <<< END MIGRATION: archive/021_fix_locked_pool_protection.sql

-- >>> BEGIN MIGRATION: archive/022_add_performance_indexes.sql
-- ============================================
-- 022: 添加性能优化索引
-- 创建日期: 2025-12-17
-- 目的: 优化频繁查询的性能
-- ============================================

-- ============================================
-- 1. profiles.role 索引 (优化权限检查)
-- ============================================

-- profiles.role 频繁用于权限检查
-- 例如: SELECT * FROM profiles WHERE role = 'admin'
CREATE INDEX IF NOT EXISTS idx_profiles_role
  ON public.profiles(role);

COMMENT ON INDEX idx_profiles_role
  IS '优化权限检查查询性能';

-- ============================================
-- 2. pools 复合索引 (优化locked卡池查询)
-- ============================================

-- 优化查询locked卡池
-- 例如: SELECT * FROM pools WHERE locked = true AND user_id = ?
CREATE INDEX IF NOT EXISTS idx_pools_locked_user
  ON public.pools(locked, user_id)
  WHERE locked = true;

COMMENT ON INDEX idx_pools_locked_user
  IS '优化locked卡池查询（部分索引）';

-- ============================================
-- 3. history 复合索引 (优化统计查询)
-- ============================================

-- 优化用户+卡池的历史记录查询（最常用）
-- 例如: SELECT * FROM history WHERE user_id = ? AND pool_id = ? ORDER BY timestamp DESC
CREATE INDEX IF NOT EXISTS idx_history_user_pool_time
  ON public.history(user_id, pool_id, timestamp DESC);

COMMENT ON INDEX idx_history_user_pool_time
  IS '优化用户卡池历史记录查询';

-- 优化稀有度统计查询（部分索引）
-- 例如: SELECT * FROM history WHERE pool_id = ? AND rarity >= 5
CREATE INDEX IF NOT EXISTS idx_history_pool_high_rarity
  ON public.history(pool_id, rarity)
  WHERE rarity >= 5;

COMMENT ON INDEX idx_history_pool_high_rarity
  IS '优化高稀有度统计查询（仅索引5星和6星）';

-- ============================================
-- 验证索引创建
-- ============================================

-- 查看所有新创建的索引
DO $$
DECLARE
  idx_count INT;
BEGIN
  SELECT COUNT(*) INTO idx_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname IN (
      'idx_profiles_role',
      'idx_pools_locked_user',
      'idx_history_user_pool_time',
      'idx_history_pool_high_rarity'
    );

  RAISE NOTICE '成功创建 % 个性能优化索引', idx_count;
END $$;
-- <<< END MIGRATION: archive/022_add_performance_indexes.sql

-- >>> BEGIN MIGRATION: archive/023_add_data_integrity_constraints.sql
-- ============================================
-- 023: 添加数据完整性约束
-- 创建日期: 2025-12-17
-- 目的: 增强数据完整性验证，防止异常数据插入
-- 注意:
--   1. 使用 NOT VALID 避免检查现有数据，仅对新数据生效
--   2. 跳过已存在的约束（001 中已定义的 CHECK 约束）
--   3. 添加列存在性检查，兼容不同版本的 schema
-- ============================================

-- ============================================
-- 1. history 表数据完整性约束
-- ============================================

-- timestamp 不能为未来时间
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'history'
      AND constraint_name = 'check_timestamp_not_future'
  ) THEN
    ALTER TABLE public.history
      ADD CONSTRAINT check_timestamp_not_future
        CHECK (timestamp <= NOW())
        NOT VALID;
    RAISE NOTICE '已添加约束: check_timestamp_not_future';
  END IF;
END $$;

-- rarity 约束已在 001_init_tables.sql 中定义，跳过

-- ============================================
-- 2. pools 表数据完整性约束
-- ============================================

-- name 长度限制（1-100字符）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'pools'
      AND constraint_name = 'check_pool_name_length'
  ) THEN
    ALTER TABLE public.pools
      ADD CONSTRAINT check_pool_name_length
        CHECK (LENGTH(name) BETWEEN 1 AND 100)
        NOT VALID;
    RAISE NOTICE '已添加约束: check_pool_name_length';
  END IF;
END $$;

-- type 约束已在 001_init_tables.sql 中定义，跳过

-- ============================================
-- 3. profiles 表数据完整性约束
-- ============================================

-- username 长度限制（2-50字符，可为空）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'profiles'
      AND constraint_name = 'check_username_length'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT check_username_length
        CHECK (username IS NULL OR LENGTH(username) BETWEEN 2 AND 50)
        NOT VALID;
    RAISE NOTICE '已添加约束: check_username_length';
  END IF;
END $$;

-- role 约束已在 001_init_tables.sql 中定义，跳过

-- ============================================
-- 4. admin_applications 表数据完整性约束
-- ============================================

-- reason 长度限制（10-500字符）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'admin_applications'
      AND constraint_name = 'check_application_reason_length'
  ) THEN
    ALTER TABLE public.admin_applications
      ADD CONSTRAINT check_application_reason_length
        CHECK (LENGTH(reason) BETWEEN 10 AND 500)
        NOT VALID;
    RAISE NOTICE '已添加约束: check_application_reason_length';
  END IF;
END $$;

-- status 约束已在 001_init_tables.sql 中定义，跳过

-- ============================================
-- 5. announcements 表数据完整性约束
-- ============================================

-- 检查 announcements 表是否存在
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'announcements'
  ) THEN
    -- title 长度限制
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_schema = 'public'
        AND table_name = 'announcements'
        AND constraint_name = 'check_announcement_title_length'
    ) THEN
      EXECUTE 'ALTER TABLE public.announcements
        ADD CONSTRAINT check_announcement_title_length
          CHECK (LENGTH(title) BETWEEN 1 AND 100)
          NOT VALID';
      RAISE NOTICE '已添加约束: check_announcement_title_length';
    END IF;

    -- content 长度限制
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_schema = 'public'
        AND table_name = 'announcements'
        AND constraint_name = 'check_announcement_content_length'
    ) THEN
      EXECUTE 'ALTER TABLE public.announcements
        ADD CONSTRAINT check_announcement_content_length
          CHECK (LENGTH(content) BETWEEN 1 AND 5000)
          NOT VALID';
      RAISE NOTICE '已添加约束: check_announcement_content_length';
    END IF;

    -- priority 优先级范围
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_schema = 'public'
        AND table_name = 'announcements'
        AND constraint_name = 'check_announcement_priority'
    ) THEN
      EXECUTE 'ALTER TABLE public.announcements
        ADD CONSTRAINT check_announcement_priority
          CHECK (priority BETWEEN 0 AND 100)
          NOT VALID';
      RAISE NOTICE '已添加约束: check_announcement_priority';
    END IF;
  ELSE
    RAISE NOTICE 'announcements 表不存在，跳过相关约束';
  END IF;
END $$;

-- ============================================
-- 验证约束创建
-- ============================================

DO $$
DECLARE
  constraint_count INT;
BEGIN
  SELECT COUNT(*) INTO constraint_count
  FROM information_schema.table_constraints
  WHERE constraint_schema = 'public'
    AND constraint_name IN (
      'check_timestamp_not_future',
      'check_pool_name_length',
      'check_username_length',
      'check_application_reason_length',
      'check_announcement_title_length',
      'check_announcement_content_length',
      'check_announcement_priority'
    );

  RAISE NOTICE '=====================================';
  RAISE NOTICE '数据完整性约束部署完成';
  RAISE NOTICE '已创建/验证 % 个约束', constraint_count;
  RAISE NOTICE '使用 NOT VALID 选项，仅对新数据生效';
  RAISE NOTICE '=====================================';
END $$;
-- <<< END MIGRATION: archive/023_add_data_integrity_constraints.sql

-- >>> BEGIN MIGRATION: archive/024_user_management_enhancement.sql
-- ============================================
-- 024: 用户管理增强
-- 添加 email 和 last_seen_at 字段到 profiles 表
-- 修复 AdminPanel 无法显示用户邮箱的问题
-- ============================================

-- 1. 添加 email 字段（用于在管理面板显示用户邮箱）
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS email TEXT;

-- 2. 添加 last_seen_at 字段（记录用户最后在线时间）
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- 3. 为现有用户填充 email（从 auth.users 获取）
-- 注意：这需要 SECURITY DEFINER 权限来访问 auth.users
CREATE OR REPLACE FUNCTION public.sync_existing_emails()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  UPDATE public.profiles p
  SET email = u.email
  FROM auth.users u
  WHERE p.id = u.id AND p.email IS NULL;
END;
$$;

-- 执行同步
SELECT public.sync_existing_emails();

-- 删除临时函数
DROP FUNCTION IF EXISTS public.sync_existing_emails();

-- 4. 修改 handle_new_user 触发器函数，保存 email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', SPLIT_PART(NEW.email, '@', 1)),
    NEW.email,
    'user'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 5. 创建更新 last_seen_at 的函数（前端登录时调用）
CREATE OR REPLACE FUNCTION public.update_last_seen()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET last_seen_at = NOW()
  WHERE id = auth.uid();
END;
$$;

-- 6. 为 email 和 last_seen_at 创建索引（提升查询性能）
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_last_seen ON public.profiles(last_seen_at);

-- 7. 添加注释
COMMENT ON COLUMN public.profiles.email IS '用户邮箱（从 auth.users 同步）';
COMMENT ON COLUMN public.profiles.last_seen_at IS '用户最后在线时间';
COMMENT ON FUNCTION public.update_last_seen() IS '更新当前用户的最后在线时间';
-- <<< END MIGRATION: archive/024_user_management_enhancement.sql

-- >>> BEGIN MIGRATION: archive/025_page_content.sql
-- ============================================
-- 025: 页面内容管理
-- 支持超管编辑首页使用指南等内容
-- ============================================

-- 1. 创建页面内容表
CREATE TABLE IF NOT EXISTS public.page_content (
  id TEXT PRIMARY KEY,  -- 页面标识，如 'home_guide', 'home_welcome'
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  updated_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 启用 RLS
ALTER TABLE public.page_content ENABLE ROW LEVEL SECURITY;

-- 3. RLS 策略：所有人可读取激活的内容
CREATE POLICY "page_content_select_active" ON public.page_content
  FOR SELECT USING (is_active = true);

-- 4. RLS 策略：超管可读取所有内容（包括未激活）
CREATE POLICY "page_content_select_super" ON public.page_content
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- 5. RLS 策略：仅超管可插入、更新、删除
CREATE POLICY "page_content_insert_super" ON public.page_content
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

CREATE POLICY "page_content_update_super" ON public.page_content
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

CREATE POLICY "page_content_delete_super" ON public.page_content
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- 6. 添加 updated_at 触发器
DROP TRIGGER IF EXISTS update_page_content_updated_at ON public.page_content;
CREATE TRIGGER update_page_content_updated_at
  BEFORE UPDATE ON public.page_content
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. 插入默认内容（首页使用指南）
INSERT INTO public.page_content (id, title, content, is_active)
VALUES (
  'home_guide',
  '使用指南',
  '## 快速开始

### 第一步：登录账号
点击右上角「登录」按钮注册或登录您的账号。

### 第二步：申请管理员权限
如需录入数据，请点击右上角「申请」按钮申请成为管理员。

### 第三步：选择或创建卡池
点击顶部卡池切换器选择现有卡池或创建新卡池。

### 第四步：录入抽卡数据
在「卡池详情」页面使用单抽、十连或文本录入数据。

---

## 文本录入格式

连续输入数字代表星级，无需空格分隔：
- `4` - 4星
- `5` - 5星
- `6` - 6星限定
- `6s` 或 `6歪` - 6星常驻(歪)

用逗号、分号或斜杠分隔多组十连。

**示例**: `4454464444,4445444454`
',
  true
)
ON CONFLICT (id) DO NOTHING;

-- 8. 添加注释
COMMENT ON TABLE public.page_content IS '页面内容表，存储可编辑的静态页面内容';
COMMENT ON COLUMN public.page_content.id IS '页面标识符，如 home_guide';
COMMENT ON COLUMN public.page_content.title IS '内容标题';
COMMENT ON COLUMN public.page_content.content IS '内容正文（支持 Markdown）';
COMMENT ON COLUMN public.page_content.is_active IS '是否激活显示';
COMMENT ON COLUMN public.page_content.updated_by IS '最后更新者';
-- <<< END MIGRATION: archive/025_page_content.sql

-- >>> BEGIN MIGRATION: archive/026_global_stats.sql
-- =====================================================
-- 迁移文件: 026_global_stats.sql
-- 创建日期: 2026-01-06
-- 描述: "急"按钮全局点击统计功能 (v2.8.0)
-- =====================================================
--
-- 功能说明:
-- 1. 创建 global_stats 表用于存储全局统计数据
-- 2. 创建 RPC 函数支持单次和批量增加点击次数
-- 3. 配置 RLS 策略确保数据安全
-- 4. 添加自动更新时间戳的触发器
--
-- 部署后操作:
-- 1. 在 Supabase Dashboard -> Database -> Replication 中启用 global_stats 表的 Realtime
-- 2. 或执行: ALTER PUBLICATION supabase_realtime ADD TABLE global_stats;
-- 3. 验证 Realtime: 在前端订阅 global_stats 表的变化
--
-- =====================================================

-- 1. 创建全局统计表
CREATE TABLE IF NOT EXISTS public.global_stats (
  id BIGSERIAL PRIMARY KEY,
  stat_key TEXT UNIQUE NOT NULL,  -- 使用 stat_key 避免与 SQL 关键字冲突
  stat_value TEXT NOT NULL DEFAULT '0',  -- 使用 stat_value 避免与 SQL 关键字冲突
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 添加表注释
COMMENT ON TABLE public.global_stats IS '全局统计数据表，用于存储跨用户的统计信息';
COMMENT ON COLUMN public.global_stats.stat_key IS '统计项的唯一键，如 urgent_button_clicks';
COMMENT ON COLUMN public.global_stats.stat_value IS '统计值，使用 TEXT 类型支持大数字';

-- 2. 添加索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_global_stats_key ON public.global_stats(stat_key);

-- 3. 插入"急"按钮点击统计的初始记录
INSERT INTO public.global_stats (stat_key, stat_value)
VALUES ('urgent_button_clicks', '0')
ON CONFLICT (stat_key) DO NOTHING;

-- 4. 创建 RPC 函数来原子性地增加点击次数（单次）
-- 这个函数确保并发点击时数据的一致性
CREATE OR REPLACE FUNCTION public.increment_urgent_clicks()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count TEXT;
BEGIN
  -- 使用 FOR UPDATE 锁定行，防止并发更新问题
  UPDATE public.global_stats
  SET
    stat_value = (CAST(stat_value AS BIGINT) + 1)::TEXT,
    updated_at = NOW()
  WHERE stat_key = 'urgent_button_clicks'
  RETURNING stat_value INTO new_count;

  -- 如果记录不存在，则创建
  IF new_count IS NULL THEN
    INSERT INTO public.global_stats (stat_key, stat_value)
    VALUES ('urgent_button_clicks', '1')
    RETURNING stat_value INTO new_count;
  END IF;

  RETURN new_count;
END;
$$;

COMMENT ON FUNCTION public.increment_urgent_clicks() IS '原子性地增加"急"按钮点击次数（单次+1）';

-- 5. 创建批量增加的 RPC 函数（优化版）
-- 用于批量上传点击次数，减少数据库请求
CREATE OR REPLACE FUNCTION public.increment_urgent_clicks_batch(increment_by BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count TEXT;
BEGIN
  -- 验证输入参数
  IF increment_by <= 0 THEN
    RAISE EXCEPTION 'increment_by must be positive';
  END IF;

  -- 使用 FOR UPDATE 锁定行，防止并发更新问题
  UPDATE public.global_stats
  SET
    stat_value = (CAST(stat_value AS BIGINT) + increment_by)::TEXT,
    updated_at = NOW()
  WHERE stat_key = 'urgent_button_clicks'
  RETURNING stat_value INTO new_count;

  -- 如果记录不存在，则创建
  IF new_count IS NULL THEN
    INSERT INTO public.global_stats (stat_key, stat_value)
    VALUES ('urgent_button_clicks', increment_by::TEXT)
    RETURNING stat_value INTO new_count;
  END IF;

  RETURN new_count;
END;
$$;

COMMENT ON FUNCTION public.increment_urgent_clicks_batch(BIGINT) IS '原子性地批量增加"急"按钮点击次数';

-- 6. 设置权限 - 允许所有人读取统计数据
-- 注意：根据你的需求调整权限策略

-- 启用行级安全（RLS）
ALTER TABLE public.global_stats ENABLE ROW LEVEL SECURITY;

-- 策略1：允许所有人（包括匿名用户）读取统计数据
DROP POLICY IF EXISTS "Anyone can read global stats" ON public.global_stats;
CREATE POLICY "Anyone can read global stats"
  ON public.global_stats
  FOR SELECT
  TO public
  USING (true);

-- 策略2：禁止直接更新表（只能通过 RPC 函数更新）
-- 这样可以确保数据一致性
DROP POLICY IF EXISTS "No direct updates" ON public.global_stats;
CREATE POLICY "No direct updates"
  ON public.global_stats
  FOR UPDATE
  TO public
  USING (false);

-- 策略3：禁止直接插入
DROP POLICY IF EXISTS "No direct inserts" ON public.global_stats;
CREATE POLICY "No direct inserts"
  ON public.global_stats
  FOR INSERT
  TO public
  WITH CHECK (false);

-- 策略4：禁止删除
DROP POLICY IF EXISTS "No deletes" ON public.global_stats;
CREATE POLICY "No deletes"
  ON public.global_stats
  FOR DELETE
  TO public
  USING (false);

-- 7. 授予 RPC 函数执行权限给所有人
GRANT EXECUTE ON FUNCTION public.increment_urgent_clicks() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_urgent_clicks_batch(BIGINT) TO anon, authenticated;

-- 8. 创建更新时间触发器
CREATE OR REPLACE FUNCTION public.update_global_stats_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_global_stats_updated_at ON public.global_stats;
CREATE TRIGGER update_global_stats_updated_at
  BEFORE UPDATE ON public.global_stats
  FOR EACH ROW
  EXECUTE FUNCTION public.update_global_stats_timestamp();

COMMENT ON FUNCTION public.update_global_stats_timestamp() IS '自动更新 global_stats 表的 updated_at 字段';

-- =====================================================
-- 迁移完成！
-- =====================================================
--
-- 下一步操作（重要）:
-- 1. 在 Supabase Dashboard 中启用 Realtime:
--    - 导航到: Database -> Replication
--    - 找到 global_stats 表
--    - 启用 Realtime 开关
--    - 或执行: ALTER PUBLICATION supabase_realtime ADD TABLE global_stats;
--
-- 2. 验证设置:
--    运行以下查询来测试：
--    SELECT * FROM public.global_stats WHERE stat_key = 'urgent_button_clicks';
--    SELECT public.increment_urgent_clicks();
--    SELECT public.increment_urgent_clicks_batch(5);
--
-- 3. 故障排查:
--    - 如果 RPC 调用失败，检查函数权限
--    - 如果 Realtime 不工作，确认已启用表的实时复制
--    - 检查前端 statsService.js 的配置
--
-- =====================================================
-- <<< END MIGRATION: archive/026_global_stats.sql

-- >>> BEGIN MIGRATION: archive/027_add_character_info.sql
-- Migration: 027_add_character_info
-- Description: 为 history 表添加角色信息字段（角色名称、角色ID、头像URL）
-- Date: 2026-01-11
-- FEAT-007: 卡池详情系统重构 - 角色信息支持

-- 1. 新增字段
ALTER TABLE public.history
  ADD COLUMN IF NOT EXISTS character_name VARCHAR(100),    -- 角色/武器显示名称
  ADD COLUMN IF NOT EXISTS character_id VARCHAR(50),       -- 关联characters表的外键
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;                -- 角色头像URL（可空，预留CDN）

-- 2. 创建索引（加速按角色查询）
CREATE INDEX IF NOT EXISTS idx_history_character_id ON public.history(character_id);
CREATE INDEX IF NOT EXISTS idx_history_character_name ON public.history(character_name);

-- 3. 添加字段注释
COMMENT ON COLUMN public.history.character_name IS '角色/武器显示名称，用于界面展示';
COMMENT ON COLUMN public.history.character_id IS '关联characters表的ID，用于查询角色详细信息';
COMMENT ON COLUMN public.history.avatar_url IS '角色头像URL，可为空，优先使用此字段，否则从characters表获取';

-- 4. 验证迁移
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'history'
    AND column_name = 'character_name'
  ) THEN
    RAISE NOTICE '✅ Migration 027: character_name 字段添加成功';
  ELSE
    RAISE EXCEPTION '❌ Migration 027: character_name 字段添加失败';
  END IF;
END $$;
-- <<< END MIGRATION: archive/027_add_character_info.sql

-- >>> BEGIN MIGRATION: archive/028_create_characters_table.sql
-- Migration: 028_create_characters_table
-- Description: 创建角色映射表，存储角色/武器基础信息
-- Date: 2026-01-11
-- FEAT-007: 卡池详情系统重构 - 角色映射系统

-- 1. 创建角色映射表
CREATE TABLE IF NOT EXISTS public.characters (
  id VARCHAR(50) PRIMARY KEY,                   -- 角色唯一ID，如 'char_levantin'
  name VARCHAR(100) NOT NULL,                   -- 角色显示名称，如 '莱万汀'
  avatar_url TEXT,                              -- CDN头像地址（可空，预留公测后补充）
  rarity INTEGER NOT NULL CHECK (rarity BETWEEN 3 AND 6),  -- 稀有度：3-6星
  type TEXT NOT NULL CHECK (type IN ('character', 'weapon')),  -- 类型：角色/武器
  aliases TEXT[],                               -- 别名数组（用于模糊搜索），如 ['莱万丁', 'Levantin']
  is_limited BOOLEAN DEFAULT FALSE,             -- 是否限定角色/武器
  release_date DATE,                            -- 首次上线日期（可空）
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 创建索引
CREATE INDEX IF NOT EXISTS idx_characters_name ON public.characters(name);
CREATE INDEX IF NOT EXISTS idx_characters_type_rarity ON public.characters(type, rarity);
CREATE INDEX IF NOT EXISTS idx_characters_aliases ON public.characters USING GIN(aliases);

-- 3. 启用 RLS 策略（行级安全）
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;

-- 3.1 所有人可读
CREATE POLICY "characters_select_all" ON public.characters
  FOR SELECT USING (true);

-- 3.2 仅超级管理员可管理
CREATE POLICY "characters_manage_super_admin" ON public.characters
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- 4. 创建触发器（自动更新 updated_at）
CREATE TRIGGER update_characters_updated_at
  BEFORE UPDATE ON public.characters
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 5. 插入初始角色数据（三测角色）
INSERT INTO public.characters (id, name, rarity, type, is_limited, aliases) VALUES
  -- 限定6星角色
  ('char_levantin', '莱万汀', 6, 'character', true, ARRAY['莱万丁', 'Levantin', 'LWT']),
  ('char_yangyan', '杨颜', 6, 'character', true, ARRAY['Yang Yan', '阳炎', 'YY']),
  ('char_yiwen', '伊冯', 6, 'character', true, ARRAY['Yiwen', 'Ivan', '伊文', 'YW']),
  ('char_jerpeta', '洁尔佩塔', 6, 'character', true, ARRAY['Jerpeta', 'Gerpeta', 'JEPT']),

  -- 常驻6星角色（示例，根据实际游戏数据补充）
  ('char_standard_1', '常驻角色1', 6, 'character', false, ARRAY['Standard1']),
  ('char_standard_2', '常驻角色2', 6, 'character', false, ARRAY['Standard2']),

  -- 5星角色（示例）
  ('char_5star_1', '5星角色1', 5, 'character', false, ARRAY['5Star1']),

  -- 武器（示例）
  ('weapon_6star_1', '6星武器1', 6, 'weapon', true, ARRAY['Weapon1'])
ON CONFLICT (id) DO NOTHING;

-- 6. 添加表注释
COMMENT ON TABLE public.characters IS '角色/武器基础信息映射表，用于展示角色名称和头像';
COMMENT ON COLUMN public.characters.id IS '角色唯一标识符，格式：char_xxx 或 weapon_xxx';
COMMENT ON COLUMN public.characters.aliases IS '别名数组，用于模糊搜索和多语言支持';
COMMENT ON COLUMN public.characters.is_limited IS '是否为限定角色/武器（UP池专属）';

-- 7. 验证迁移
DO $$
DECLARE
  character_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO character_count FROM public.characters;

  IF character_count > 0 THEN
    RAISE NOTICE '✅ Migration 028: characters 表创建成功，已插入 % 个初始角色', character_count;
  ELSE
    RAISE WARNING '⚠️ Migration 028: characters 表已创建，但初始数据为空';
  END IF;
END $$;
-- <<< END MIGRATION: archive/028_create_characters_table.sql

-- >>> BEGIN MIGRATION: archive/029_enhance_pools_metadata.sql
-- Migration: 029_enhance_pools_metadata
-- Description: 扩展 pools 表，添加卡池元数据字段（描述、时间、Banner图等）
-- Date: 2026-01-11
-- FEAT-007: 卡池详情系统重构 - 卡池元数据增强

-- 1. 新增字段
ALTER TABLE public.pools
  ADD COLUMN IF NOT EXISTS description TEXT,                -- 卡池描述，如"杨颜UP池 - 三测第一期"
  ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ,          -- 卡池开始时间
  ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ,            -- 卡池结束时间
  ADD COLUMN IF NOT EXISTS banner_url TEXT,                 -- 卡池Banner图片URL（预留）
  ADD COLUMN IF NOT EXISTS featured_characters TEXT[];      -- UP角色ID数组，关联characters表

-- 2. 创建索引（加速按时间范围查询当前UP池）
CREATE INDEX IF NOT EXISTS idx_pools_time_range ON public.pools(start_time, end_time);

-- 3. 添加字段注释
COMMENT ON COLUMN public.pools.description IS '卡池描述信息，用于详情页展示';
COMMENT ON COLUMN public.pools.start_time IS '卡池开始时间（可空，手动录入池可不填）';
COMMENT ON COLUMN public.pools.end_time IS '卡池结束时间（可空）';
COMMENT ON COLUMN public.pools.banner_url IS 'Banner图片URL，预留给公测后的官方图片';
COMMENT ON COLUMN public.pools.featured_characters IS 'UP角色ID列表，如 [''char_levantin'', ''char_yangyan'']，关联characters表';

-- 4. 验证迁移
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pools'
    AND column_name = 'featured_characters'
  ) THEN
    RAISE NOTICE '✅ Migration 029: pools 表元数据字段添加成功';
  ELSE
    RAISE EXCEPTION '❌ Migration 029: pools 表元数据字段添加失败';
  END IF;
END $$;
-- <<< END MIGRATION: archive/029_enhance_pools_metadata.sql

-- >>> BEGIN MIGRATION: archive/030_migrate_pool_ids.sql
-- Migration: 030_migrate_pool_ids
-- Description: 为卡池ID迁移准备兼容字段，保留旧ID用于平滑过渡
-- Date: 2026-01-11
-- FEAT-007: 卡池详情系统重构 - ID迁移准备

-- 1. 为 pools 表添加旧ID兼容字段
ALTER TABLE public.pools
  ADD COLUMN IF NOT EXISTS legacy_pool_id TEXT;

-- 2. 为 history 表添加旧ID兼容字段
ALTER TABLE public.history
  ADD COLUMN IF NOT EXISTS legacy_pool_id TEXT;

-- 3. 创建索引（加速旧ID查询，兼容期间需要）
CREATE INDEX IF NOT EXISTS idx_pools_legacy_id ON public.pools(legacy_pool_id);
CREATE INDEX IF NOT EXISTS idx_history_legacy_pool_id ON public.history(legacy_pool_id);

-- 4. 添加字段注释
COMMENT ON COLUMN public.pools.legacy_pool_id IS '迁移前的旧ID（时间戳格式），用于兼容旧数据，保留6个月后可删除';
COMMENT ON COLUMN public.history.legacy_pool_id IS '关联的旧卡池ID，用于ID迁移期间的数据查询兼容';

-- 5. 创建ID迁移辅助函数（可选）
-- 用于在应用层迁移时，批量更新 pool_id 并保留 legacy_pool_id

CREATE OR REPLACE FUNCTION migrate_pool_id(
  old_id TEXT,
  new_id TEXT,
  user_uuid UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected_rows INTEGER;
BEGIN
  -- 1. 更新 pools 表
  UPDATE public.pools
  SET
    pool_id = new_id,
    legacy_pool_id = old_id,
    updated_at = NOW()
  WHERE user_id = user_uuid AND pool_id = old_id;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;

  -- 2. 更新 history 表中的关联
  UPDATE public.history
  SET
    pool_id = new_id,
    legacy_pool_id = old_id,
    updated_at = NOW()
  WHERE user_id = user_uuid AND pool_id = old_id;

  -- 3. 返回是否成功
  IF affected_rows > 0 THEN
    RETURN TRUE;
  ELSE
    RETURN FALSE;
  END IF;
END;
$$;

COMMENT ON FUNCTION migrate_pool_id IS 'ID迁移辅助函数：批量更新卡池ID并保留旧ID，供前端调用';

-- 6. 验证迁移
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pools'
    AND column_name = 'legacy_pool_id'
  ) THEN
    RAISE NOTICE '✅ Migration 030: 旧ID兼容字段添加成功';
  ELSE
    RAISE EXCEPTION '❌ Migration 030: 旧ID兼容字段添加失败';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'migrate_pool_id'
  ) THEN
    RAISE NOTICE '✅ Migration 030: ID迁移辅助函数创建成功';
  END IF;
END $$;
-- <<< END MIGRATION: archive/030_migrate_pool_ids.sql

-- >>> BEGIN MIGRATION: archive/032_add_up_character_to_pools.sql
-- Migration: 032_add_up_character_to_pools
-- Description: 添加 up_character 字段到 pools 表（单个UP角色名称，与 featured_characters 互补）
-- Date: 2026-01-17
-- Fix: FEAT-007 卡池管理界面字段不匹配问题

-- 1. 添加 up_character 字段（单个 UP 角色名称，用于显示）
ALTER TABLE public.pools
  ADD COLUMN IF NOT EXISTS up_character TEXT;

-- 2. 添加字段注释
COMMENT ON COLUMN public.pools.up_character IS '单个UP角色显示名称，用于简化显示（与 featured_characters 互补）';

-- 3. 验证迁移
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pools'
    AND column_name = 'up_character'
  ) THEN
    RAISE NOTICE '✅ Migration 032: pools.up_character 字段添加成功';
  ELSE
    RAISE EXCEPTION '❌ Migration 032: pools.up_character 字段添加失败';
  END IF;
END $$;
-- <<< END MIGRATION: archive/032_add_up_character_to_pools.sql

-- >>> BEGIN MIGRATION: archive/033_restore_pools_metadata.sql
-- Migration: 033_restore_pools_metadata
-- Description: 恢复 pools 表的元数据字段（被 031 删除，现在需要恢复）
-- Date: 2026-01-17
-- Fix: FEAT-007 数据导入失败 - 缺少 description/banner_url/start_time/end_time 字段

-- ============================================
-- 1. 恢复元数据字段
-- ============================================
ALTER TABLE public.pools
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS banner_url TEXT,
  ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS featured_characters TEXT[];

-- ============================================
-- 2. 创建索引（加速按时间范围查询）
-- ============================================
CREATE INDEX IF NOT EXISTS idx_pools_time_range ON public.pools(start_time, end_time);

-- ============================================
-- 3. 添加字段注释
-- ============================================
COMMENT ON COLUMN public.pools.description IS '卡池描述信息，用于详情页展示';
COMMENT ON COLUMN public.pools.banner_url IS 'Banner 图片 URL，支持外部图床链接';
COMMENT ON COLUMN public.pools.start_time IS '卡池开始时间（可空）';
COMMENT ON COLUMN public.pools.end_time IS '卡池结束时间（可空）';
COMMENT ON COLUMN public.pools.featured_characters IS 'UP角色ID数组，如 ARRAY[''char_levantin'']';

-- ============================================
-- 4. 验证迁移
-- ============================================
DO $$
DECLARE
  missing_columns TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- 检查 description
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pools' AND column_name = 'description'
  ) THEN
    missing_columns := array_append(missing_columns, 'description');
  END IF;

  -- 检查 banner_url
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pools' AND column_name = 'banner_url'
  ) THEN
    missing_columns := array_append(missing_columns, 'banner_url');
  END IF;

  -- 检查 start_time
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pools' AND column_name = 'start_time'
  ) THEN
    missing_columns := array_append(missing_columns, 'start_time');
  END IF;

  -- 检查 end_time
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pools' AND column_name = 'end_time'
  ) THEN
    missing_columns := array_append(missing_columns, 'end_time');
  END IF;

  -- 检查 featured_characters
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pools' AND column_name = 'featured_characters'
  ) THEN
    missing_columns := array_append(missing_columns, 'featured_characters');
  END IF;

  -- 报告结果
  IF array_length(missing_columns, 1) IS NULL THEN
    RAISE NOTICE '✅ Migration 033: pools 表元数据字段恢复成功';
    RAISE NOTICE '   - description ✓';
    RAISE NOTICE '   - banner_url ✓';
    RAISE NOTICE '   - start_time ✓';
    RAISE NOTICE '   - end_time ✓';
    RAISE NOTICE '   - featured_characters ✓';
  ELSE
    RAISE EXCEPTION '❌ Migration 033: 以下字段添加失败: %', array_to_string(missing_columns, ', ');
  END IF;
END $$;
-- <<< END MIGRATION: archive/033_restore_pools_metadata.sql

-- >>> BEGIN MIGRATION: archive/034_add_is_simulated_field.sql
-- 添加 is_simulated 字段用于标识模拟数据
-- 创建时间: 2026-01-18
-- 用途: 区分真实抽卡数据和模拟器生成的数据

-- 1. 添加 is_simulated 字段到 history 表
ALTER TABLE public.history
ADD COLUMN IF NOT EXISTS is_simulated BOOLEAN DEFAULT FALSE;

-- 2. 添加注释说明
COMMENT ON COLUMN public.history.is_simulated IS '是否为模拟器数据（true=模拟数据，false=真实数据）';

-- 3. 创建索引以优化查询性能
CREATE INDEX IF NOT EXISTS idx_history_is_simulated
  ON public.history(user_id, is_simulated);

-- 4. 创建复合索引（用户+卡池+是否模拟）
CREATE INDEX IF NOT EXISTS idx_history_user_pool_simulated
  ON public.history(user_id, pool_id, is_simulated);

-- 5. 更新 RLS 策略（保持现有策略不变，但确保模拟数据也受保护）
-- 现有的 RLS 策略已经通过 user_id 限制访问权限，无需额外修改

-- 验证迁移
DO $$
BEGIN
  -- 检查字段是否添加成功
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'history'
      AND column_name = 'is_simulated'
  ) THEN
    RAISE EXCEPTION 'is_simulated 字段添加失败';
  END IF;

  RAISE NOTICE 'is_simulated 字段添加成功';
END $$;
-- <<< END MIGRATION: archive/034_add_is_simulated_field.sql

-- >>> BEGIN MIGRATION: archive/035_add_pool_config_to_characters.sql
-- Migration: 添加 pool_config 字段到 characters 表
-- 用于存储角色的卡池归属配置和轮换信息

-- 添加 pool_config JSONB 字段
ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS pool_config JSONB DEFAULT '{}'::jsonb;

-- 添加注释说明字段用途
COMMENT ON COLUMN public.characters.pool_config IS '卡池配置：
{
  "pools": ["limited", "standard"],  -- 可出现的卡池类型
  "limited_rotation_count": 0,       -- 当前已轮换次数（仅限定角色）
  "removes_after": 3,                -- 多少次轮换后移出（null=永不移出）
  "is_active_in_limited": true       -- 当前是否在限定池中
}';

-- 创建 GIN 索引以支持 JSONB 查询
CREATE INDEX IF NOT EXISTS idx_characters_pool_config
  ON public.characters USING GIN(pool_config);

-- 创建索引以支持按卡池类型查询
CREATE INDEX IF NOT EXISTS idx_characters_pool_config_pools
  ON public.characters USING GIN((pool_config->'pools'));
-- <<< END MIGRATION: archive/035_add_pool_config_to_characters.sql

-- >>> BEGIN MIGRATION: archive/036_initialize_characters_data.sql
-- Migration: 初始化角色数据
-- 插入所有角色的完整数据，包括卡池配置

-- ============================================
-- 限定6星角色（3个）
-- ============================================

-- 莱万汀 (3次轮换后移出)
INSERT INTO public.characters (id, name, rarity, type, is_limited, pool_config, aliases, created_at, updated_at)
VALUES (
  'char_levantin',
  '莱万汀',
  6,
  'character',
  true,
  jsonb_build_object(
    'pools', ARRAY['limited', 'standard']::text[],
    'limited_rotation_count', 0,
    'removes_after', 3,
    'is_active_in_limited', true
  ),
  ARRAY['莱万丁', 'Levantin', 'LWT']::text[],
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  pool_config = EXCLUDED.pool_config,
  updated_at = NOW();

-- 伊冯 (4次轮换后移出)
INSERT INTO public.characters (id, name, rarity, type, is_limited, pool_config, aliases, created_at, updated_at)
VALUES (
  'char_yiwen',
  '伊冯',
  6,
  'character',
  true,
  jsonb_build_object(
    'pools', ARRAY['limited', 'standard']::text[],
    'limited_rotation_count', 0,
    'removes_after', 4,
    'is_active_in_limited', true
  ),
  ARRAY['Yvonne', 'YW']::text[],
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  pool_config = EXCLUDED.pool_config,
  updated_at = NOW();

-- 洁尔佩塔 (5次轮换后移出)
INSERT INTO public.characters (id, name, rarity, type, is_limited, pool_config, aliases, created_at, updated_at)
VALUES (
  'char_jerpeta',
  '洁尔佩塔',
  6,
  'character',
  true,
  jsonb_build_object(
    'pools', ARRAY['limited', 'standard']::text[],
    'limited_rotation_count', 0,
    'removes_after', 5,
    'is_active_in_limited', true
  ),
  ARRAY['Gerpetta', 'JEPT']::text[],
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  pool_config = EXCLUDED.pool_config,
  updated_at = NOW();

-- ============================================
-- 常驻6星角色（5个，永不移出）
-- ============================================

-- 艾尔黛拉
INSERT INTO public.characters (id, name, rarity, type, is_limited, pool_config, aliases, created_at, updated_at)
VALUES (
  'char_eldela',
  '艾尔黛拉',
  6,
  'character',
  false,
  jsonb_build_object(
    'pools', ARRAY['limited', 'standard']::text[],
    'removes_after', NULL,
    'is_active_in_limited', true
  ),
  ARRAY['小羊', 'Eldela', 'AEDL']::text[],
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  pool_config = EXCLUDED.pool_config,
  updated_at = NOW();

-- 骏卫
INSERT INTO public.characters (id, name, rarity, type, is_limited, pool_config, aliases, created_at, updated_at)
VALUES (
  'char_junwei',
  '骏卫',
  6,
  'character',
  false,
  jsonb_build_object(
    'pools', ARRAY['limited', 'standard']::text[],
    'removes_after', NULL,
    'is_active_in_limited', true
  ),
  ARRAY['Junwei', 'JW']::text[],
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  pool_config = EXCLUDED.pool_config,
  updated_at = NOW();

-- 别礼
INSERT INTO public.characters (id, name, rarity, type, is_limited, pool_config, aliases, created_at, updated_at)
VALUES (
  'char_bieli',
  '别礼',
  6,
  'character',
  false,
  jsonb_build_object(
    'pools', ARRAY['limited', 'standard']::text[],
    'removes_after', NULL,
    'is_active_in_limited', true
  ),
  ARRAY['Bieli', 'BL']::text[],
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  pool_config = EXCLUDED.pool_config,
  updated_at = NOW();

-- 余烬
INSERT INTO public.characters (id, name, rarity, type, is_limited, pool_config, aliases, created_at, updated_at)
VALUES (
  'char_yujin',
  '余烬',
  6,
  'character',
  false,
  jsonb_build_object(
    'pools', ARRAY['limited', 'standard']::text[],
    'removes_after', NULL,
    'is_active_in_limited', true
  ),
  ARRAY['Ember', 'YJ']::text[],
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  pool_config = EXCLUDED.pool_config,
  updated_at = NOW();

-- 黎风
INSERT INTO public.characters (id, name, rarity, type, is_limited, pool_config, aliases, created_at, updated_at)
VALUES (
  'char_lifeng',
  '黎风',
  6,
  'character',
  false,
  jsonb_build_object(
    'pools', ARRAY['limited', 'standard']::text[],
    'removes_after', NULL,
    'is_active_in_limited', true
  ),
  ARRAY['Lifeng', 'LF']::text[],
  NOW(),
  NOW()
) ON CONFLICT (id) DO UPDATE SET
  pool_config = EXCLUDED.pool_config,
  updated_at = NOW();

-- ============================================
-- 5星角色（9个）
-- ============================================

INSERT INTO public.characters (id, name, rarity, type, is_limited, pool_config, created_at, updated_at)
VALUES
  ('char_peilika', '佩丽卡', 5, 'character', false, jsonb_build_object('pools', ARRAY['limited', 'standard']::text[]), NOW(), NOW()),
  ('char_huguang', '弧光', 5, 'character', false, jsonb_build_object('pools', ARRAY['limited', 'standard']::text[]), NOW(), NOW()),
  ('char_aiweiwen', '艾维文娜', 5, 'character', false, jsonb_build_object('pools', ARRAY['limited', 'standard']::text[]), NOW(), NOW()),
  ('char_dapan', '大潘', 5, 'character', false, jsonb_build_object('pools', ARRAY['limited', 'standard']::text[]), NOW(), NOW()),
  ('char_chenqianyu', '陈千语', 5, 'character', false, jsonb_build_object('pools', ARRAY['limited', 'standard']::text[]), NOW(), NOW()),
  ('char_langwei', '狼卫', 5, 'character', false, jsonb_build_object('pools', ARRAY['limited', 'standard']::text[]), NOW(), NOW()),
  ('char_saixi', '赛希', 5, 'character', false, jsonb_build_object('pools', ARRAY['limited', 'standard']::text[]), NOW(), NOW()),
  ('char_zhouxue', '昼雪', 5, 'character', false, jsonb_build_object('pools', ARRAY['limited', 'standard']::text[]), NOW(), NOW()),
  ('char_alieshen', '阿列什', 5, 'character', false, jsonb_build_object('pools', ARRAY['limited', 'standard']::text[]), NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  pool_config = EXCLUDED.pool_config,
  updated_at = NOW();

-- ============================================
-- 4星角色（5个）
-- ============================================

INSERT INTO public.characters (id, name, rarity, type, is_limited, pool_config, created_at, updated_at)
VALUES
  ('char_qiuli', '秋栗', 4, 'character', false, jsonb_build_object('pools', ARRAY['limited', 'standard']::text[]), NOW(), NOW()),
  ('char_kaqier', '卡契尔', 4, 'character', false, jsonb_build_object('pools', ARRAY['limited', 'standard']::text[]), NOW(), NOW()),
  ('char_aitela', '埃特拉', 4, 'character', false, jsonb_build_object('pools', ARRAY['limited', 'standard']::text[]), NOW(), NOW()),
  ('char_yingshi', '萤石', 4, 'character', false, jsonb_build_object('pools', ARRAY['limited', 'standard']::text[]), NOW(), NOW()),
  ('char_antaer', '安塔尔', 4, 'character', false, jsonb_build_object('pools', ARRAY['limited', 'standard']::text[]), NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  pool_config = EXCLUDED.pool_config,
  updated_at = NOW();

-- ============================================
-- 武器（占位符）
-- ============================================

-- 6星限定武器
INSERT INTO public.characters (id, name, rarity, type, is_limited, pool_config, created_at, updated_at)
VALUES
  ('weapon_6star_limited', '6星限定武器', 6, 'weapon', true, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  pool_config = EXCLUDED.pool_config,
  updated_at = NOW();

-- 6星常驻武器（6把）
INSERT INTO public.characters (id, name, rarity, type, is_limited, pool_config, created_at, updated_at)
VALUES
  ('weapon_6star_std_1', '6星常驻武器-1', 6, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW()),
  ('weapon_6star_std_2', '6星常驻武器-2', 6, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW()),
  ('weapon_6star_std_3', '6星常驻武器-3', 6, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW()),
  ('weapon_6star_std_4', '6星常驻武器-4', 6, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW()),
  ('weapon_6star_std_5', '6星常驻武器-5', 6, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW()),
  ('weapon_6star_std_6', '6星常驻武器-6', 6, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  pool_config = EXCLUDED.pool_config,
  updated_at = NOW();

-- 5星武器（9把）
INSERT INTO public.characters (id, name, rarity, type, is_limited, pool_config, created_at, updated_at)
VALUES
  ('weapon_5star_1', '5星武器-1', 5, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW()),
  ('weapon_5star_2', '5星武器-2', 5, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW()),
  ('weapon_5star_3', '5星武器-3', 5, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW()),
  ('weapon_5star_4', '5星武器-4', 5, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW()),
  ('weapon_5star_5', '5星武器-5', 5, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW()),
  ('weapon_5star_6', '5星武器-6', 5, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW()),
  ('weapon_5star_7', '5星武器-7', 5, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW()),
  ('weapon_5star_8', '5星武器-8', 5, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW()),
  ('weapon_5star_9', '5星武器-9', 5, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  pool_config = EXCLUDED.pool_config,
  updated_at = NOW();

-- 4星武器（5把）
INSERT INTO public.characters (id, name, rarity, type, is_limited, pool_config, created_at, updated_at)
VALUES
  ('weapon_4star_1', '4星武器-1', 4, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW()),
  ('weapon_4star_2', '4星武器-2', 4, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW()),
  ('weapon_4star_3', '4星武器-3', 4, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW()),
  ('weapon_4star_4', '4星武器-4', 4, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW()),
  ('weapon_4star_5', '4星武器-5', 4, 'weapon', false, jsonb_build_object('pools', ARRAY['weapon']::text[]), NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  pool_config = EXCLUDED.pool_config,
  updated_at = NOW();
-- <<< END MIGRATION: archive/036_initialize_characters_data.sql

-- >>> BEGIN MIGRATION: archive/037_add_rotation_processed_to_pools.sql
-- =====================================================
-- 037: 为卡池添加轮换处理标记
-- 用于追踪卡池结束后是否已自动处理轮换
-- =====================================================

-- 添加 rotation_processed 字段
ALTER TABLE pools
ADD COLUMN IF NOT EXISTS rotation_processed BOOLEAN DEFAULT FALSE;

-- 添加注释
COMMENT ON COLUMN pools.rotation_processed IS '是否已处理轮换（卡池结束后自动为限定池角色增加轮换次数）';

-- 为已结束的卡池设置为已处理（历史数据兼容）
-- 避免重复处理已有的历史卡池
UPDATE pools
SET rotation_processed = TRUE
WHERE end_time IS NOT NULL AND end_time < NOW();

-- 创建索引，用于快速查询需要处理轮换的卡池
CREATE INDEX IF NOT EXISTS idx_pools_pending_rotation
ON pools (type, end_time, rotation_processed)
WHERE rotation_processed = FALSE AND end_time IS NOT NULL;
-- <<< END MIGRATION: archive/037_add_rotation_processed_to_pools.sql

-- >>> BEGIN MIGRATION: archive/038_add_introduced_at_to_characters.sql
-- =====================================================
-- 038: 为角色 pool_config 添加 introduced_at 字段
-- 用于追踪角色首次出现的时间，确保新角色不会出现在之前的池子中
-- =====================================================

-- 为现有角色设置 introduced_at 为一个早期时间（游戏公测开始时间）
-- 这样现有角色会出现在所有池子中
UPDATE characters
SET pool_config = pool_config || jsonb_build_object('introduced_at', '2026-01-22T11:00:00+08:00')
WHERE pool_config IS NOT NULL 
  AND pool_config->>'introduced_at' IS NULL;

-- 添加注释说明
COMMENT ON COLUMN characters.pool_config IS '卡池配置JSON，包含：
- pools: 角色可出现的卡池类型数组 ["limited", "standard", "weapon"]
- limited_rotation_count: 当前轮换次数
- removes_after: 几次轮换后从限定池移出
- is_active_in_limited: 是否在限定池中激活
- introduced_at: 角色首次引入时间，新角色只出现在此时间之后的池子中';
-- <<< END MIGRATION: archive/038_add_introduced_at_to_characters.sql

-- >>> BEGIN MIGRATION: archive/039_create_pool_characters_table.sql
-- =====================================================
-- 039: 创建池子-角色关联表
-- 实现每个池子独立管理角色列表
-- =====================================================

-- 首先确保 pools 表的 pool_id 列有唯一约束
DO $$
BEGIN
  -- 检查是否已存在唯一约束
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'pools_pool_id_key' 
    AND conrelid = 'pools'::regclass
  ) THEN
    -- 添加唯一约束
    ALTER TABLE pools ADD CONSTRAINT pools_pool_id_key UNIQUE (pool_id);
  END IF;
END $$;

-- 创建关联表
CREATE TABLE IF NOT EXISTS pool_characters (
  id SERIAL PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES pools(pool_id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  is_up BOOLEAN DEFAULT FALSE,  -- 是否为该池子的UP角色
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- 确保同一个池子不会重复添加同一个角色
  UNIQUE(pool_id, character_id)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_pool_characters_pool_id ON pool_characters(pool_id);
CREATE INDEX IF NOT EXISTS idx_pool_characters_character_id ON pool_characters(character_id);

-- 添加注释
COMMENT ON TABLE pool_characters IS '池子-角色关联表，每个池子独立管理自己的角色列表';
COMMENT ON COLUMN pool_characters.pool_id IS '池子ID，关联到 pools 表';
COMMENT ON COLUMN pool_characters.character_id IS '角色ID，关联到 characters 表';
COMMENT ON COLUMN pool_characters.is_up IS '是否为该池子的UP角色';

-- RLS 策略（简化版 - 允许已认证用户操作）
ALTER TABLE pool_characters ENABLE ROW LEVEL SECURITY;

-- 所有人可读
CREATE POLICY "pool_characters_select_policy" ON pool_characters
  FOR SELECT USING (true);

-- 已认证用户可以增删改（实际权限由前端控制）
CREATE POLICY "pool_characters_insert_policy" ON pool_characters
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "pool_characters_update_policy" ON pool_characters
  FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "pool_characters_delete_policy" ON pool_characters
  FOR DELETE USING (auth.uid() IS NOT NULL);
-- <<< END MIGRATION: archive/039_create_pool_characters_table.sql

-- >>> BEGIN MIGRATION: archive/041_fix_character_pool_config.sql
-- =====================================================
-- 041: 修复角色的 pool_config.pools 数据
-- 角色(type='character')不应该在武器池中
-- 武器(type='weapon')不应该在限定角色池和常驻池中
-- =====================================================

-- 从角色的 pools 数组中移除 'weapon'
UPDATE characters
SET pool_config = jsonb_set(
  pool_config,
  '{pools}',
  (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements_text(pool_config->'pools') AS elem
    WHERE elem != 'weapon'
  )
),
updated_at = NOW()
WHERE type = 'character'
  AND pool_config->'pools' ? 'weapon';

-- 确保武器只在 weapon 池中
UPDATE characters
SET pool_config = jsonb_set(
  pool_config,
  '{pools}',
  '["weapon"]'::jsonb
),
updated_at = NOW()
WHERE type = 'weapon'
  AND (
    pool_config->'pools' ? 'limited'
    OR pool_config->'pools' ? 'standard'
  );

-- 验证：显示修复结果
-- SELECT id, name, type, pool_config->'pools' as pools FROM characters ORDER BY type, rarity DESC;
-- <<< END MIGRATION: archive/041_fix_character_pool_config.sql

-- >>> BEGIN MIGRATION: archive/042_add_multi_account_support.sql
-- Migration: 042_add_multi_account_support
-- Description: 添加多账号支持字段到 pools 表
-- Date: 2026-01-28
-- Feature: 支持同一用户管理多个游戏账号（官服/B服）

-- ============================================
-- 1. 添加多账号支持字段到 pools 表
-- ============================================
ALTER TABLE public.pools
  ADD COLUMN IF NOT EXISTS game_uid TEXT,
  ADD COLUMN IF NOT EXISTS nick_name TEXT;

-- ============================================
-- 2. 添加字段注释
-- ============================================
COMMENT ON COLUMN public.pools.game_uid IS '游戏账号 UID（用于区分官服/B服等不同账号）';
COMMENT ON COLUMN public.pools.nick_name IS '游戏账号昵称';

-- ============================================
-- 3. 创建索引（加速按游戏账号查询）
-- ============================================
CREATE INDEX IF NOT EXISTS idx_pools_game_uid ON public.pools(user_id, game_uid);

-- ============================================
-- 4. 验证迁移
-- ============================================
DO $$
DECLARE
  missing_columns TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- 检查 game_uid
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pools' AND column_name = 'game_uid'
  ) THEN
    missing_columns := array_append(missing_columns, 'game_uid');
  END IF;

  -- 检查 nick_name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pools' AND column_name = 'nick_name'
  ) THEN
    missing_columns := array_append(missing_columns, 'nick_name');
  END IF;

  -- 报告结果
  IF array_length(missing_columns, 1) IS NULL THEN
    RAISE NOTICE '✅ Migration 042: pools 表多账号支持字段添加成功';
    RAISE NOTICE '   - game_uid ✓';
    RAISE NOTICE '   - nick_name ✓';
    RAISE NOTICE '   - idx_pools_game_uid ✓';
  ELSE
    RAISE EXCEPTION '❌ Migration 042: 以下字段添加失败: %', array_to_string(missing_columns, ', ');
  END IF;
END $$;
-- <<< END MIGRATION: archive/042_add_multi_account_support.sql

-- >>> BEGIN MIGRATION: archive/043_add_avg_pity_excluding_free.sql
-- =====================================================
-- 迁移文件: 043_add_avg_pity_excluding_free.sql
-- 创建日期: 2026-01-27
-- 描述: 为全服统计添加不含免费十连的平均出货计算
-- =====================================================

DROP FUNCTION IF EXISTS get_global_stats();

CREATE OR REPLACE FUNCTION get_global_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  avg_pity NUMERIC;
  avg_pity_excl_free NUMERIC;
  global_distribution JSON;
  limited_stats JSON;
  weapon_stats JSON;
  standard_stats JSON;
BEGIN
  -- ============================================
  -- 1. 计算全局平均出货（包含免费十连）
  -- ============================================
  WITH ordered_pulls AS (
    SELECT
      pool_id,
      user_id,
      rarity,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM history
    WHERE special_type IS DISTINCT FROM 'gift'
  ),
  six_stars_with_prev AS (
    SELECT
      pool_id,
      user_id,
      rn,
      LAG(rn, 1, 0) OVER (PARTITION BY pool_id, user_id ORDER BY rn) as prev_rn
    FROM ordered_pulls
    WHERE rarity = 6
  )
  SELECT COALESCE(AVG(rn - prev_rn), 0) INTO avg_pity FROM six_stars_with_prev;

  -- ============================================
  -- 1b. 计算全局平均出货（不含免费十连）
  -- ============================================
  WITH ordered_pulls_excl_free AS (
    SELECT
      pool_id,
      user_id,
      rarity,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM history
    WHERE special_type IS DISTINCT FROM 'gift'
      AND (is_free IS NULL OR is_free = false)
  ),
  six_stars_excl_free AS (
    SELECT
      pool_id,
      user_id,
      rn,
      LAG(rn, 1, 0) OVER (PARTITION BY pool_id, user_id ORDER BY rn) as prev_rn
    FROM ordered_pulls_excl_free
    WHERE rarity = 6
  )
  SELECT COALESCE(AVG(rn - prev_rn), 0) INTO avg_pity_excl_free FROM six_stars_excl_free;

  -- ============================================
  -- 2. 计算全局6星出货分布
  -- ============================================
  WITH ordered_pulls AS (
    SELECT
      h.pool_id,
      h.user_id,
      h.rarity,
      h.is_standard,
      ROW_NUMBER() OVER (PARTITION BY h.pool_id, h.user_id ORDER BY h.record_id) as rn
    FROM history h
    WHERE h.special_type IS DISTINCT FROM 'gift'
  ),
  six_stars_pity AS (
    SELECT
      is_standard,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM ordered_pulls
    WHERE rarity = 6
  ),
  pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard
    FROM six_stars_pity
  ),
  grouped_ranges AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM pity_ranges
    GROUP BY range_label
  )
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'range', REPLACE(range_label, '01-10', '1-10'),
        'limited', limited_count,
        'standard', standard_count
      ) ORDER BY range_label
    ),
    '[]'::json
  ) INTO global_distribution FROM grouped_ranges;

  -- ============================================
  -- 3. 计算限定池统计（包含 avgPityExcludingFree）
  -- ============================================
  WITH limited_pulls AS (
    SELECT h.*
    FROM history h
    JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
    WHERE p.type = 'limited'
  ),
  limited_ordered AS (
    SELECT
      pool_id,
      user_id,
      rarity,
      is_standard,
      is_free,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM limited_pulls
    WHERE special_type IS DISTINCT FROM 'gift'
  ),
  limited_six_pity AS (
    SELECT
      pool_id,
      user_id,
      is_standard,
      is_free,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM limited_ordered
    WHERE rarity = 6
  ),
  -- 不含免费十连的统计
  limited_ordered_excl_free AS (
    SELECT
      pool_id,
      user_id,
      rarity,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM limited_pulls
    WHERE special_type IS DISTINCT FROM 'gift'
      AND (is_free IS NULL OR is_free = false)
  ),
  limited_six_pity_excl_free AS (
    SELECT
      pool_id,
      user_id,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM limited_ordered_excl_free
    WHERE rarity = 6
  ),
  limited_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard
    FROM limited_six_pity
  ),
  limited_grouped AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM limited_pity_ranges
    GROUP BY range_label
  )
  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE special_type IS DISTINCT FROM 'gift'), 0),
    'six', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard = true), 0),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM limited_six_pity), 1), 0),
    'avgPityExcludingFree', COALESCE(ROUND((SELECT AVG(pity) FROM limited_six_pity_excl_free), 1), 0),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity <= 4), 0)
    ),
    'distribution', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        ) ORDER BY range_label
      ) FROM limited_grouped),
      '[]'::json
    )
  ) INTO limited_stats;

  -- ============================================
  -- 4. 计算武器池统计
  -- ============================================
  WITH weapon_pulls AS (
    SELECT h.*
    FROM history h
    JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
    WHERE p.type = 'weapon'
  ),
  weapon_ordered AS (
    SELECT
      pool_id,
      user_id,
      rarity,
      is_standard,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM weapon_pulls
    WHERE special_type IS DISTINCT FROM 'gift'
  ),
  weapon_six_pity AS (
    SELECT
      pool_id,
      user_id,
      is_standard,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM weapon_ordered
    WHERE rarity = 6
  ),
  weapon_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard
    FROM weapon_six_pity
  ),
  weapon_grouped AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM weapon_pity_ranges
    GROUP BY range_label
  )
  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE special_type IS DISTINCT FROM 'gift'), 0),
    'six', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard = true), 0),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM weapon_six_pity), 1), 0),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity <= 4), 0)
    ),
    'distribution', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        ) ORDER BY range_label
      ) FROM weapon_grouped),
      '[]'::json
    )
  ) INTO weapon_stats;

  -- ============================================
  -- 5. 计算常驻池统计
  -- ============================================
  WITH standard_pulls AS (
    SELECT h.*
    FROM history h
    JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
    WHERE p.type = 'standard'
  ),
  standard_ordered AS (
    SELECT
      pool_id,
      user_id,
      rarity,
      is_standard,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM standard_pulls
    WHERE special_type IS DISTINCT FROM 'gift'
  ),
  standard_six_pity AS (
    SELECT
      pool_id,
      user_id,
      is_standard,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM standard_ordered
    WHERE rarity = 6
  ),
  standard_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard
    FROM standard_six_pity
  ),
  standard_grouped AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM standard_pity_ranges
    GROUP BY range_label
  )
  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE special_type IS DISTINCT FROM 'gift'), 0),
    'six', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6 AND is_standard = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6 AND is_standard = true), 0),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM standard_six_pity), 1), 0),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6 AND is_standard = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6 AND is_standard = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity <= 4), 0)
    ),
    'distribution', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        ) ORDER BY range_label
      ) FROM standard_grouped),
      '[]'::json
    )
  ) INTO standard_stats;

  -- ============================================
  -- 6. 组装最终结果
  -- ============================================
  SELECT json_build_object(
    'totalPulls', COALESCE((SELECT COUNT(*) FROM history WHERE special_type IS DISTINCT FROM 'gift'), 0),
    'totalUsers', COALESCE((SELECT COUNT(*) FROM profiles), 0),
    'sixStarTotal', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 6 AND is_standard = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 6 AND is_standard = true), 0),
    'fiveStar', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 5), 0),
    'fourStar', COALESCE((SELECT COUNT(*) FROM history WHERE rarity <= 4), 0),
    'avgPity', ROUND(avg_pity, 1),
    'avgPityExcludingFree', ROUND(avg_pity_excl_free, 1),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 6 AND is_standard = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 6 AND is_standard = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM history WHERE rarity <= 4), 0)
    ),
    'distribution', global_distribution,
    'byType', json_build_object(
      'limited', limited_stats,
      'weapon', weapon_stats,
      'standard', standard_stats
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- 授权所有认证用户调用此函数
GRANT EXECUTE ON FUNCTION get_global_stats() TO authenticated;
-- 也授权匿名用户（如果需要未登录也能看到统计）
GRANT EXECUTE ON FUNCTION get_global_stats() TO anon;

-- =====================================================
-- 迁移完成！
-- =====================================================
--
-- 新增字段：
-- 1. 全局: avgPityExcludingFree - 不含免费十连的全局平均出货
-- 2. 限定池: avgPityExcludingFree - 不含免费十连的限定池平均出货
--
-- 部署步骤：
-- 1. 在 Supabase SQL Editor 中执行此脚本
-- 2. 刷新前端页面验证数据
-- =====================================================
-- <<< END MIGRATION: archive/043_add_avg_pity_excluding_free.sql

-- >>> BEGIN MIGRATION: archive/044_avatar_storage_policies.sql
-- =====================================================
-- 044: Avatar Storage RLS Policies
-- 头像存储桶的行级安全策略
--
-- 功能：
-- - 所有人可读取头像（公开访问）
-- - 仅超级管理员可上传/更新/删除头像
-- =====================================================

-- 注意：需要先在 Supabase Dashboard -> Storage 中创建名为 "avatars" 的 Public bucket
-- 1. 进入 Supabase Dashboard -> Storage
-- 2. 点击 "New bucket"
-- 3. 名称填写 "avatars"，勾选 "Public bucket"

-- =====================================================
-- 1. 删除已存在的策略（如果有）
-- =====================================================
DROP POLICY IF EXISTS "Public can read avatars" ON storage.objects;
DROP POLICY IF EXISTS "Only super_admin can upload avatars" ON storage.objects;
DROP POLICY IF EXISTS "Only super_admin can update avatars" ON storage.objects;
DROP POLICY IF EXISTS "Only super_admin can delete avatars" ON storage.objects;
DROP POLICY IF EXISTS "Allow all for avatars bucket" ON storage.objects;

-- =====================================================
-- 2. 创建读取策略 - 所有人可读取头像
-- =====================================================
CREATE POLICY "Public can read avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

-- =====================================================
-- 3. 创建上传策略 - 仅超级管理员可上传
-- =====================================================
CREATE POLICY "Only super_admin can upload avatars"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'avatars'
  AND auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'super_admin'
  )
);

-- =====================================================
-- 4. 创建更新策略 - 仅超级管理员可更新（覆盖上传）
-- =====================================================
CREATE POLICY "Only super_admin can update avatars"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'avatars'
  AND auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'super_admin'
  )
);

-- =====================================================
-- 5. 创建删除策略 - 仅超级管理员可删除
-- =====================================================
CREATE POLICY "Only super_admin can delete avatars"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'avatars'
  AND auth.role() = 'authenticated'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'super_admin'
  )
);

-- =====================================================
-- 权限说明：
-- =====================================================
-- | 操作   | 匿名用户 | 普通用户 | 管理员 | 超级管理员 |
-- |--------|----------|----------|--------|------------|
-- | SELECT | ✅       | ✅       | ✅     | ✅         |
-- | INSERT | ❌       | ❌       | ❌     | ✅         |
-- | UPDATE | ❌       | ❌       | ❌     | ✅         |
-- | DELETE | ❌       | ❌       | ❌     | ✅         |
-- =====================================================
-- <<< END MIGRATION: archive/044_avatar_storage_policies.sql

-- >>> BEGIN MIGRATION: archive/045_character_ranking_stats.sql
-- =====================================================
-- 045: 角色出货排名统计函数
-- 用于统计各卡池类型中出货最多的角色
--
-- 功能：
-- - 统计限定池、常驻池中6★和5★角色的出货排名
-- - 返回前3名角色及其出货数量
-- - 同时提供6★含免费和不含免费的统计
-- =====================================================

-- 删除旧函数（如果存在）
DROP FUNCTION IF EXISTS public.get_character_ranking_stats();

-- 创建角色排名统计函数
CREATE OR REPLACE FUNCTION public.get_character_ranking_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  WITH
  -- 关联卡池类型（安全处理 pool_id：仅当 pool_id 是有效 UUID 时才 JOIN）
  history_with_pool AS (
    SELECT
      h.rarity,
      h.item_name,
      h.is_standard,
      h.is_free,
      h.special_type,
      CASE
        -- 如果 pool_id 不是有效 UUID 格式，根据 pool_id 值判断类型
        WHEN h.pool_id = 'standard' THEN 'standard'
        WHEN h.pool_id = 'limited' THEN 'limited'
        WHEN h.pool_id = 'weapon' THEN 'weapon'
        -- 如果是有效 UUID，从 pools 表获取类型
        WHEN h.pool_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          COALESCE(
            (SELECT
              CASE
                WHEN p.type IN ('limited', 'limited_character') THEN 'limited'
                WHEN p.type IN ('weapon', 'limited_weapon') THEN 'weapon'
                ELSE 'standard'
              END
            FROM public.pools p
            WHERE p.id = h.pool_id::uuid
            ),
            'standard'
          )
        ELSE 'standard'
      END as pool_type
    FROM public.history h
    WHERE h.special_type IS DISTINCT FROM 'gift'
      AND h.item_name IS NOT NULL
      AND h.item_name != ''
  ),

  -- 限定池6★排名（不区分免费）
  limited_six_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_pool
    WHERE pool_type = 'limited' AND rarity = 6
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- 限定池5★排名
  limited_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_pool
    WHERE pool_type = 'limited' AND rarity = 5
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- 常驻池6★排名
  standard_six_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_pool
    WHERE pool_type = 'standard' AND rarity = 6
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- 常驻池5★排名
  standard_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_pool
    WHERE pool_type = 'standard' AND rarity = 5
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- 限定池6★数量统计（区分免费）
  limited_six_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE is_free = false OR is_free IS NULL) as excluding_free
    FROM history_with_pool
    WHERE pool_type = 'limited' AND rarity = 6
  ),

  -- 常驻池6★数量统计
  standard_six_counts AS (
    SELECT COUNT(*) as total
    FROM history_with_pool
    WHERE pool_type = 'standard' AND rarity = 6
  )

  SELECT json_build_object(
    'limited', json_build_object(
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_five_star),
      'sixStarTotal', (SELECT total FROM limited_six_counts),
      'sixStarExcludingFree', (SELECT excluding_free FROM limited_six_counts)
    ),
    'standard', json_build_object(
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_six_star),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_five_star),
      'sixStarTotal', (SELECT total FROM standard_six_counts)
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- 添加函数注释
COMMENT ON FUNCTION public.get_character_ranking_stats() IS '获取各卡池类型中角色出货排名前3的统计数据';

-- 授予执行权限
GRANT EXECUTE ON FUNCTION public.get_character_ranking_stats() TO anon, authenticated;

-- =====================================================
-- 使用示例：
-- SELECT public.get_character_ranking_stats();
--
-- 返回格式：
-- {
--   "limited": {
--     "sixStar": [{"name": "莱万汀", "count": 150}, ...],
--     "fiveStar": [{"name": "某5星", "count": 500}, ...],
--     "sixStarTotal": 1200,
--     "sixStarExcludingFree": 1100
--   },
--   "standard": {
--     "sixStar": [{"name": "某常驻6星", "count": 80}, ...],
--     "fiveStar": [{"name": "某5星", "count": 300}, ...],
--     "sixStarTotal": 500
--   }
-- }
-- =====================================================
-- <<< END MIGRATION: archive/045_character_ranking_stats.sql

-- >>> BEGIN MIGRATION: archive/046_fix_character_ranking_stats.sql
-- =====================================================
-- 046: 修复角色出货排名统计函数
--
-- 修复问题：
-- 1. 武器与角色被混在一起统计 - 通过 JOIN characters 表区分类型
-- 2. pool_id 映射逻辑错误 - 根据实际 pool_id 格式修复：
--    - 限定池: special_* 开头
--    - 常驻池: standard, beginner
--    - 武器池: weapon* 开头
-- =====================================================

-- 删除旧函数
DROP FUNCTION IF EXISTS public.get_character_ranking_stats();

-- 创建修复后的角色排名统计函数
CREATE OR REPLACE FUNCTION public.get_character_ranking_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  WITH
  -- 关联卡池类型和角色/武器类型
  history_with_info AS (
    SELECT
      h.rarity,
      h.item_name,
      h.is_standard,
      h.is_free,
      h.special_type,
      h.pool_id,
      -- 从 characters 表获取物品类型（角色/武器）
      COALESCE(c.type, 'character') as item_type,
      -- 根据 pool_id 前缀判断卡池类型
      CASE
        -- 限定池：以 special_ 开头
        WHEN h.pool_id LIKE 'special_%' THEN 'limited'
        -- 武器池：以 weapon 开头（包括 weaponbox_、weponbox_ 等）
        WHEN h.pool_id LIKE 'weapon%' OR h.pool_id LIKE 'wepon%' THEN 'weapon'
        -- 常驻池：standard 或 beginner
        WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
        -- UUID 格式的 pool_id，从 pools 表获取类型
        WHEN h.pool_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          COALESCE(
            (SELECT
              CASE
                WHEN p.type IN ('limited', 'limited_character') THEN 'limited'
                WHEN p.type IN ('weapon', 'limited_weapon') THEN 'weapon'
                ELSE 'standard'
              END
            FROM public.pools p
            WHERE p.id = h.pool_id::uuid
            ),
            'standard'
          )
        ELSE 'standard'
      END as pool_type
    FROM public.history h
    -- LEFT JOIN characters 表获取物品类型
    LEFT JOIN public.characters c ON c.name = h.item_name
    WHERE h.special_type IS DISTINCT FROM 'gift'
      AND h.item_name IS NOT NULL
      AND h.item_name != ''
  ),

  -- ========== 限定池统计（仅角色） ==========
  -- 限定池6★角色排名
  limited_six_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'limited'
      AND rarity = 6
      AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- 限定池5★角色排名
  limited_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'limited'
      AND rarity = 5
      AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- ========== 常驻池统计（仅角色） ==========
  -- 常驻池6★角色排名
  standard_six_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'standard'
      AND rarity = 6
      AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- 常驻池5★角色排名
  standard_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'standard'
      AND rarity = 5
      AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- ========== 武器池统计（仅武器） ==========
  -- 武器池6★武器排名
  weapon_six_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'weapon'
      AND rarity = 6
      AND item_type = 'weapon'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- 武器池5★武器排名
  weapon_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'weapon'
      AND rarity = 5
      AND item_type = 'weapon'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- ========== 数量统计 ==========
  -- 限定池6★角色数量统计（区分免费）
  limited_six_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE is_free = false OR is_free IS NULL) as excluding_free
    FROM history_with_info
    WHERE pool_type = 'limited'
      AND rarity = 6
      AND item_type = 'character'
  ),

  -- 常驻池6★角色数量统计
  standard_six_counts AS (
    SELECT COUNT(*) as total
    FROM history_with_info
    WHERE pool_type = 'standard'
      AND rarity = 6
      AND item_type = 'character'
  ),

  -- 武器池6★武器数量统计
  weapon_six_counts AS (
    SELECT COUNT(*) as total
    FROM history_with_info
    WHERE pool_type = 'weapon'
      AND rarity = 6
      AND item_type = 'weapon'
  )

  SELECT json_build_object(
    'limited', json_build_object(
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_five_star),
      'sixStarTotal', (SELECT COALESCE(total, 0) FROM limited_six_counts),
      'sixStarExcludingFree', (SELECT COALESCE(excluding_free, 0) FROM limited_six_counts)
    ),
    'standard', json_build_object(
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_six_star),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_five_star),
      'sixStarTotal', (SELECT COALESCE(total, 0) FROM standard_six_counts)
    ),
    'weapon', json_build_object(
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_five_star),
      'sixStarTotal', (SELECT COALESCE(total, 0) FROM weapon_six_counts)
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- 添加函数注释
COMMENT ON FUNCTION public.get_character_ranking_stats() IS '获取各卡池类型中角色/武器出货排名前3的统计数据（修复版：正确识别 pool_id 格式）';

-- 授予执行权限
GRANT EXECUTE ON FUNCTION public.get_character_ranking_stats() TO anon, authenticated;

-- =====================================================
-- pool_id 格式说明：
-- - 限定池: special_1_0_1, special_2_0_1 等（以 special_ 开头）
-- - 常驻池: standard, beginner
-- - 武器池: weaponbox_constant_4, weponbox_1_0_1 等（以 weapon/wepon 开头）
--
-- 返回格式：
-- {
--   "limited": {
--     "sixStar": [{"name": "莱万汀", "count": 5}, ...],
--     "fiveStar": [{"name": "狼卫", "count": 10}, ...],
--     "sixStarTotal": 5,
--     "sixStarExcludingFree": 5
--   },
--   "standard": { ... },
--   "weapon": { ... }
-- }
-- =====================================================
-- <<< END MIGRATION: archive/046_fix_character_ranking_stats.sql

-- >>> BEGIN MIGRATION: archive/047_user_ranking_stats.sql
-- =====================================================
-- 047: 用户个人出货排名统计函数
--
-- 功能：获取指定用户的各卡池类型中角色/武器出货排名
-- =====================================================

-- 删除旧函数（如果存在）
DROP FUNCTION IF EXISTS public.get_user_ranking_stats(uuid);

-- 创建用户个人排名统计函数
CREATE OR REPLACE FUNCTION public.get_user_ranking_stats(p_user_id uuid)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  WITH
  -- 关联卡池类型和角色/武器类型
  history_with_info AS (
    SELECT
      h.rarity,
      h.item_name,
      h.is_standard,
      h.is_free,
      h.special_type,
      h.pool_id,
      -- 从 characters 表获取物品类型（角色/武器）
      COALESCE(c.type, 'character') as item_type,
      -- 根据 pool_id 前缀判断卡池类型
      CASE
        -- 限定池：以 special_ 开头
        WHEN h.pool_id LIKE 'special_%' THEN 'limited'
        -- 武器池：以 weapon 开头（包括 weaponbox_、weponbox_ 等）
        WHEN h.pool_id LIKE 'weapon%' OR h.pool_id LIKE 'wepon%' THEN 'weapon'
        -- 常驻池：standard 或 beginner
        WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
        -- UUID 格式的 pool_id，从 pools 表获取类型
        WHEN h.pool_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          COALESCE(
            (SELECT
              CASE
                WHEN p.type IN ('limited', 'limited_character') THEN 'limited'
                WHEN p.type IN ('weapon', 'limited_weapon') THEN 'weapon'
                ELSE 'standard'
              END
            FROM public.pools p
            WHERE p.id = h.pool_id::uuid
            ),
            'standard'
          )
        ELSE 'standard'
      END as pool_type
    FROM public.history h
    -- LEFT JOIN characters 表获取物品类型
    LEFT JOIN public.characters c ON c.name = h.item_name
    WHERE h.user_id = p_user_id
      AND h.special_type IS DISTINCT FROM 'gift'
      AND h.item_name IS NOT NULL
      AND h.item_name != ''
  ),

  -- ========== 限定池统计（仅角色） ==========
  limited_six_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'limited' AND rarity = 6 AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  limited_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'limited' AND rarity = 5 AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- ========== 常驻池统计（仅角色） ==========
  standard_six_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'standard' AND rarity = 6 AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  standard_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'standard' AND rarity = 5 AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- ========== 武器池统计（仅武器） ==========
  weapon_six_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'weapon' AND rarity = 6 AND item_type = 'weapon'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  weapon_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'weapon' AND rarity = 5 AND item_type = 'weapon'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  )

  SELECT json_build_object(
    'limited', json_build_object(
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_five_star)
    ),
    'standard', json_build_object(
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_six_star),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_five_star)
    ),
    'weapon', json_build_object(
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_five_star)
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- 添加函数注释
COMMENT ON FUNCTION public.get_user_ranking_stats(uuid) IS '获取指定用户的各卡池类型中角色/武器出货排名前3的统计数据';

-- 授予执行权限
GRANT EXECUTE ON FUNCTION public.get_user_ranking_stats(uuid) TO anon, authenticated;
-- <<< END MIGRATION: archive/047_user_ranking_stats.sql

-- >>> BEGIN MIGRATION: archive/049_add_nick_name_to_history.sql
-- Migration: 049_add_nick_name_to_history
-- Description: 添加 nick_name 字段到 history 表，用于账号切换器显示友好名称
-- Date: 2026-01-29

-- ============================================
-- 1. 添加 nick_name 字段到 history 表
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'history' AND column_name = 'nick_name'
  ) THEN
    ALTER TABLE public.history ADD COLUMN nick_name TEXT;
    COMMENT ON COLUMN public.history.nick_name IS '游戏账号昵称（用于账号切换器显示）';
    RAISE NOTICE '✅ 已添加 nick_name 字段到 history 表';
  ELSE
    RAISE NOTICE '⚠️  nick_name 字段已存在，跳过';
  END IF;
END $$;

-- ============================================
-- 2. 验证迁移
-- ============================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'history' AND column_name = 'nick_name'
  ) THEN
    RAISE NOTICE '✅ Migration 049: nick_name 字段添加成功';
  ELSE
    RAISE EXCEPTION '❌ Migration 049: nick_name 字段添加失败';
  END IF;
END $$;
-- <<< END MIGRATION: archive/049_add_nick_name_to_history.sql

-- >>> BEGIN MIGRATION: archive/050_fix_global_stats_pool_types.sql
-- =====================================================
-- 迁移文件: 050_fix_global_stats_pool_types.sql
-- 描述: 修复 get_global_stats 函数的 pool type 匹配问题
-- =====================================================
--
-- 问题原因：
-- 原函数只匹配 'limited'、'weapon'、'standard'
-- 但实际数据库中存储的是：
--   - 'limited_character' (限定角色池)
--   - 'limited_weapon' (武器池)
--   - 'standard' (常驻池)
--   - 'beginner' (新手池)
--
-- 修复方案：
--   - 限定池: p.type IN ('limited', 'limited_character')
--   - 武器池: p.type IN ('weapon', 'limited_weapon')
--   - 常驻池: p.type IN ('standard', 'beginner')
--
-- =====================================================

CREATE OR REPLACE FUNCTION get_global_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  avg_pity NUMERIC;
  global_distribution JSON;
  limited_stats JSON;
  weapon_stats JSON;
  standard_stats JSON;
BEGIN
  -- ============================================
  -- 1. 计算全局平均出货
  -- ============================================
  WITH ordered_pulls AS (
    SELECT
      pool_id,
      user_id,
      rarity,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM history
    WHERE special_type IS DISTINCT FROM 'gift'
  ),
  six_stars_with_prev AS (
    SELECT
      pool_id,
      user_id,
      rn,
      LAG(rn, 1, 0) OVER (PARTITION BY pool_id, user_id ORDER BY rn) as prev_rn
    FROM ordered_pulls
    WHERE rarity = 6
  )
  SELECT COALESCE(AVG(rn - prev_rn), 0) INTO avg_pity FROM six_stars_with_prev;

  -- ============================================
  -- 2. 计算全局6星出货分布
  -- ============================================
  WITH ordered_pulls AS (
    SELECT
      h.pool_id,
      h.user_id,
      h.rarity,
      h.is_standard,
      ROW_NUMBER() OVER (PARTITION BY h.pool_id, h.user_id ORDER BY h.record_id) as rn
    FROM history h
    WHERE h.special_type IS DISTINCT FROM 'gift'
  ),
  six_stars_pity AS (
    SELECT
      is_standard,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM ordered_pulls
    WHERE rarity = 6
  ),
  pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard
    FROM six_stars_pity
  ),
  grouped_ranges AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM pity_ranges
    GROUP BY range_label
  )
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'range', REPLACE(range_label, '01-10', '1-10'),
        'limited', limited_count,
        'standard', standard_count
      ) ORDER BY range_label
    ),
    '[]'::json
  ) INTO global_distribution FROM grouped_ranges;

  -- ============================================
  -- 3. 计算限定池统计（含 pool_type 预处理）
  -- ============================================
  WITH base_pulls AS (
    SELECT
      h.*,
      COALESCE(
        CASE
          WHEN p.type IN ('limited', 'limited_character') THEN 'limited'
          WHEN p.type IN ('weapon', 'limited_weapon') THEN 'weapon'
          WHEN p.type IN ('standard', 'beginner') THEN 'standard'
          ELSE NULL
        END,
        CASE
          WHEN split_part(h.pool_id, '_', 2) IN ('limited', 'limited-character', 'limitedcharacter', 'limited_character') THEN 'limited'
          WHEN split_part(h.pool_id, '_', 2) IN ('weapon', 'limited-weapon', 'limitedweapon', 'limited_weapon') THEN 'weapon'
          WHEN split_part(h.pool_id, '_', 2) IN ('standard', 'beginner') THEN 'standard'
          WHEN h.is_standard = true THEN 'standard'
          ELSE 'limited'
        END
      ) AS pool_type
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
    WHERE h.special_type IS DISTINCT FROM 'gift'
  ),
  limited_pulls AS (
    SELECT * FROM base_pulls WHERE pool_type = 'limited'
  ),
  limited_ordered AS (
    SELECT pool_id, user_id, rarity, is_standard,
           ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM limited_pulls
  ),
  limited_six_pity AS (
    SELECT pool_id, user_id, is_standard,
           rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM limited_ordered
    WHERE rarity = 6
  ),
  limited_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard
    FROM limited_six_pity
  ),
  limited_grouped AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM limited_pity_ranges
    GROUP BY range_label
  )
  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM limited_pulls), 0),
    'six', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard = true), 0),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM limited_six_pity), 1), 0),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity <= 4), 0)
    ),
    'distribution', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        ) ORDER BY range_label
      ) FROM limited_grouped),
      '[]'::json
    )
  ) INTO limited_stats;

  -- ============================================
  -- 4. 计算武器池统计（含 pool_type 预处理）
  -- ============================================
  WITH base_pulls AS (
    SELECT
      h.*,
      COALESCE(
        CASE
          WHEN p.type IN ('limited', 'limited_character') THEN 'limited'
          WHEN p.type IN ('weapon', 'limited_weapon') THEN 'weapon'
          WHEN p.type IN ('standard', 'beginner') THEN 'standard'
          ELSE NULL
        END,
        CASE
          WHEN split_part(h.pool_id, '_', 2) IN ('limited', 'limited-character', 'limitedcharacter', 'limited_character') THEN 'limited'
          WHEN split_part(h.pool_id, '_', 2) IN ('weapon', 'limited-weapon', 'limitedweapon', 'limited_weapon') THEN 'weapon'
          WHEN split_part(h.pool_id, '_', 2) IN ('standard', 'beginner') THEN 'standard'
          WHEN h.is_standard = true THEN 'standard'
          ELSE 'limited'
        END
      ) AS pool_type
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
    WHERE h.special_type IS DISTINCT FROM 'gift'
  ),
  weapon_pulls AS (
    SELECT * FROM base_pulls WHERE pool_type = 'weapon'
  ),
  weapon_ordered AS (
    SELECT pool_id, user_id, rarity, is_standard,
           ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM weapon_pulls
  ),
  weapon_six_pity AS (
    SELECT pool_id, user_id, is_standard,
           rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM weapon_ordered
    WHERE rarity = 6
  ),
  weapon_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard
    FROM weapon_six_pity
  ),
  weapon_grouped AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM weapon_pity_ranges
    GROUP BY range_label
  )
  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM weapon_pulls), 0),
    'six', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard = true), 0),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM weapon_six_pity), 1), 0),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity <= 4), 0)
    ),
    'distribution', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        ) ORDER BY range_label
      ) FROM weapon_grouped),
      '[]'::json
    )
  ) INTO weapon_stats;

  -- ============================================
  -- 5. 计算常驻池统计（含 pool_type 预处理）
  -- ============================================
  WITH base_pulls AS (
    SELECT
      h.*,
      COALESCE(
        CASE
          WHEN p.type IN ('limited', 'limited_character') THEN 'limited'
          WHEN p.type IN ('weapon', 'limited_weapon') THEN 'weapon'
          WHEN p.type IN ('standard', 'beginner') THEN 'standard'
          ELSE NULL
        END,
        CASE
          WHEN split_part(h.pool_id, '_', 2) IN ('limited', 'limited-character', 'limitedcharacter', 'limited_character') THEN 'limited'
          WHEN split_part(h.pool_id, '_', 2) IN ('weapon', 'limited-weapon', 'limitedweapon', 'limited_weapon') THEN 'weapon'
          WHEN split_part(h.pool_id, '_', 2) IN ('standard', 'beginner') THEN 'standard'
          WHEN h.is_standard = true THEN 'standard'
          ELSE 'limited'
        END
      ) AS pool_type
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
    WHERE h.special_type IS DISTINCT FROM 'gift'
  ),
  standard_pulls AS (
    SELECT * FROM base_pulls WHERE pool_type = 'standard'
  ),
  standard_ordered AS (
    SELECT pool_id, user_id, rarity, is_standard,
           ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM standard_pulls
  ),
  standard_six_pity AS (
    SELECT pool_id, user_id, is_standard,
           rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM standard_ordered
    WHERE rarity = 6
  ),
  standard_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard
    FROM standard_six_pity
  ),
  standard_grouped AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard THEN 1 ELSE 0 END) as standard_count
    FROM standard_pity_ranges
    GROUP BY range_label
  )
  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM standard_pulls), 0),
    'six', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6 AND is_standard = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6 AND is_standard = true), 0),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM standard_six_pity), 1), 0),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6 AND is_standard = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6 AND is_standard = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity <= 4), 0)
    ),
    'distribution', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        ) ORDER BY range_label
      ) FROM standard_grouped),
      '[]'::json
    )
  ) INTO standard_stats;

  -- ============================================
  -- 7. 组装最终结果
  -- ============================================
  SELECT json_build_object(
    'totalPulls', COALESCE((SELECT COUNT(*) FROM history WHERE special_type IS DISTINCT FROM 'gift'), 0),
    'totalUsers', COALESCE((SELECT COUNT(*) FROM profiles), 0),
    'sixStarTotal', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 6 AND is_standard = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 6 AND is_standard = true), 0),
    'fiveStar', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 5), 0),
    'fourStar', COALESCE((SELECT COUNT(*) FROM history WHERE rarity <= 4), 0),
    'avgPity', ROUND(avg_pity, 1),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 6 AND is_standard = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 6 AND is_standard = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM history WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM history WHERE rarity <= 4), 0)
    ),
    'distribution', global_distribution,
    'byType', json_build_object(
      'limited', limited_stats,
      'weapon', weapon_stats,
      'standard', standard_stats
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- 授权所有认证用户调用此函数
GRANT EXECUTE ON FUNCTION get_global_stats() TO authenticated;
-- 也授权匿名用户（如果需要未登录也能看到统计）
GRANT EXECUTE ON FUNCTION get_global_stats() TO anon;
-- <<< END MIGRATION: archive/050_fix_global_stats_pool_types.sql

-- >>> BEGIN MIGRATION: archive/051_fix_is_standard_calculation.sql
-- =====================================================
-- 迁移文件: 051_fix_is_standard_calculation.sql
-- 描述: 修复 get_global_stats 函数中的 is_standard 计算逻辑
-- =====================================================
--
-- 问题原因：
-- 数据库中的 is_standard 字段几乎全是 false（错误的）
-- 需要基于 UP 角色匹配动态重新计算
--
-- 修复方案：
-- 1. 创建 history_with_correct_is_standard CTE
-- 2. 在所有统计中使用重新计算的 is_standard_calc
--
-- =====================================================

CREATE OR REPLACE FUNCTION get_global_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  avg_pity NUMERIC;
  global_distribution JSON;
  limited_stats JSON;
  weapon_stats JSON;
  standard_stats JSON;
BEGIN
  -- ============================================
  -- 核心CTE: 重新计算所有记录的 is_standard
  -- ============================================
  WITH history_with_correct_is_standard AS (
    SELECT
      h.*,
      p.type as pool_type,
      p.up_character,
      -- 动态计算正确的 is_standard
      CASE
        -- 常驻池/新手池：全是常驻
        WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN true
        -- 限定/武器池的6星：检查是否匹配UP
        WHEN h.rarity = 6 AND p.up_character IS NOT NULL THEN
          NOT (
            COALESCE(h.character_name, '') ILIKE '%' || p.up_character || '%' OR
            COALESCE(h.item_name, '') ILIKE '%' || p.up_character || '%' OR
            p.up_character ILIKE '%' || COALESCE(h.character_name, h.item_name, '') || '%'
          )
        -- 其他情况：保持原值
        ELSE COALESCE(h.is_standard, false)
      END as is_standard_calc
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
  )

  -- ============================================
  -- 1. 计算全局平均出货
  -- ============================================
  ,ordered_pulls AS (
    SELECT
      pool_id,
      user_id,
      rarity,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM history_with_correct_is_standard
    WHERE special_type IS DISTINCT FROM 'gift'
  ),
  six_stars_with_prev AS (
    SELECT
      pool_id,
      user_id,
      rn,
      LAG(rn, 1, 0) OVER (PARTITION BY pool_id, user_id ORDER BY rn) as prev_rn
    FROM ordered_pulls
    WHERE rarity = 6
  )
  SELECT COALESCE(AVG(rn - prev_rn), 0) INTO avg_pity FROM six_stars_with_prev;

  -- ============================================
  -- 2. 计算全局6星出货分布
  -- ============================================
  WITH history_with_correct_is_standard AS (
    SELECT
      h.*,
      p.type as pool_type,
      p.up_character,
      CASE
        WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN true
        WHEN h.rarity = 6 AND p.up_character IS NOT NULL THEN
          NOT (
            COALESCE(h.character_name, '') ILIKE '%' || p.up_character || '%' OR
            COALESCE(h.item_name, '') ILIKE '%' || p.up_character || '%' OR
            p.up_character ILIKE '%' || COALESCE(h.character_name, h.item_name, '') || '%'
          )
        ELSE COALESCE(h.is_standard, false)
      END as is_standard_calc
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
  ),
  ordered_pulls AS (
    SELECT
      h.pool_id,
      h.user_id,
      h.rarity,
      h.is_standard_calc,
      ROW_NUMBER() OVER (PARTITION BY h.pool_id, h.user_id ORDER BY h.record_id) as rn
    FROM history_with_correct_is_standard h
    WHERE h.special_type IS DISTINCT FROM 'gift'
  ),
  six_stars_pity AS (
    SELECT
      is_standard_calc,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM ordered_pulls
    WHERE rarity = 6
  ),
  pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard_calc
    FROM six_stars_pity
  ),
  grouped_ranges AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard_calc THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard_calc THEN 1 ELSE 0 END) as standard_count
    FROM pity_ranges
    GROUP BY range_label
  )
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'range', REPLACE(range_label, '01-10', '1-10'),
        'limited', limited_count,
        'standard', standard_count
      ) ORDER BY range_label
    ),
    '[]'::json
  ) INTO global_distribution FROM grouped_ranges;

  -- ============================================
  -- 3. 计算限定池统计
  -- ============================================
  WITH history_with_correct_is_standard AS (
    SELECT
      h.*,
      p.type as pool_type,
      p.up_character,
      CASE
        WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN true
        WHEN h.rarity = 6 AND p.up_character IS NOT NULL THEN
          NOT (
            COALESCE(h.character_name, '') ILIKE '%' || p.up_character || '%' OR
            COALESCE(h.item_name, '') ILIKE '%' || p.up_character || '%' OR
            p.up_character ILIKE '%' || COALESCE(h.character_name, h.item_name, '') || '%'
          )
        ELSE COALESCE(h.is_standard, false)
      END as is_standard_calc
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
  ),
  base_pulls AS (
    SELECT
      h.*,
      COALESCE(
        CASE
          WHEN h.pool_type IN ('limited', 'limited_character') THEN 'limited'
          WHEN h.pool_type IN ('weapon', 'limited_weapon') THEN 'weapon'
          WHEN h.pool_type IN ('standard', 'beginner') THEN 'standard'
          ELSE NULL
        END,
        CASE
          WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
          WHEN split_part(h.pool_id, '_', 1) = 'special' THEN 'limited'
          WHEN split_part(h.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
          WHEN h.is_standard_calc = true THEN 'standard'
          ELSE 'limited'
        END
      ) AS classified_pool_type
    FROM history_with_correct_is_standard h
    WHERE h.special_type IS DISTINCT FROM 'gift'
  ),
  limited_pulls AS (
    SELECT * FROM base_pulls WHERE classified_pool_type = 'limited'
  ),
  limited_ordered AS (
    SELECT pool_id, user_id, rarity, is_standard_calc,
           ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM limited_pulls
  ),
  limited_six_pity AS (
    SELECT pool_id, user_id, is_standard_calc,
           rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM limited_ordered
    WHERE rarity = 6
  ),
  limited_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard_calc
    FROM limited_six_pity
  ),
  limited_grouped AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard_calc THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard_calc THEN 1 ELSE 0 END) as standard_count
    FROM limited_pity_ranges
    GROUP BY range_label
  )
  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM limited_pulls), 0),
    'six', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard_calc = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard_calc = true), 0),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM limited_six_pity), 1), 0),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard_calc = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard_calc = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity <= 4), 0)
    ),
    'distribution', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        ) ORDER BY range_label
      ) FROM limited_grouped),
      '[]'::json
    )
  ) INTO limited_stats;

  -- ============================================
  -- 4. 计算武器池统计
  -- ============================================
  WITH history_with_correct_is_standard AS (
    SELECT
      h.*,
      p.type as pool_type,
      p.up_character,
      CASE
        WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN true
        WHEN h.rarity = 6 AND p.up_character IS NOT NULL THEN
          NOT (
            COALESCE(h.character_name, '') ILIKE '%' || p.up_character || '%' OR
            COALESCE(h.item_name, '') ILIKE '%' || p.up_character || '%' OR
            p.up_character ILIKE '%' || COALESCE(h.character_name, h.item_name, '') || '%'
          )
        ELSE COALESCE(h.is_standard, false)
      END as is_standard_calc
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
  ),
  base_pulls AS (
    SELECT
      h.*,
      COALESCE(
        CASE
          WHEN h.pool_type IN ('limited', 'limited_character') THEN 'limited'
          WHEN h.pool_type IN ('weapon', 'limited_weapon') THEN 'weapon'
          WHEN h.pool_type IN ('standard', 'beginner') THEN 'standard'
          ELSE NULL
        END,
        CASE
          WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
          WHEN split_part(h.pool_id, '_', 1) = 'special' THEN 'limited'
          WHEN split_part(h.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
          WHEN h.is_standard_calc = true THEN 'standard'
          ELSE 'limited'
        END
      ) AS classified_pool_type
    FROM history_with_correct_is_standard h
    WHERE h.special_type IS DISTINCT FROM 'gift'
  ),
  weapon_pulls AS (
    SELECT * FROM base_pulls WHERE classified_pool_type = 'weapon'
  ),
  weapon_ordered AS (
    SELECT pool_id, user_id, rarity, is_standard_calc,
           ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM weapon_pulls
  ),
  weapon_six_pity AS (
    SELECT pool_id, user_id, is_standard_calc,
           rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM weapon_ordered
    WHERE rarity = 6
  ),
  weapon_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard_calc
    FROM weapon_six_pity
  ),
  weapon_grouped AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard_calc THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard_calc THEN 1 ELSE 0 END) as standard_count
    FROM weapon_pity_ranges
    GROUP BY range_label
  )
  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM weapon_pulls), 0),
    'six', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard_calc = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard_calc = true), 0),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM weapon_six_pity), 1), 0),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard_calc = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard_calc = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity <= 4), 0)
    ),
    'distribution', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        ) ORDER BY range_label
      ) FROM weapon_grouped),
      '[]'::json
    )
  ) INTO weapon_stats;

  -- ============================================
  -- 5. 计算常驻池统计
  -- ============================================
  WITH history_with_correct_is_standard AS (
    SELECT
      h.*,
      p.type as pool_type,
      p.up_character,
      CASE
        WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN true
        WHEN h.rarity = 6 AND p.up_character IS NOT NULL THEN
          NOT (
            COALESCE(h.character_name, '') ILIKE '%' || p.up_character || '%' OR
            COALESCE(h.item_name, '') ILIKE '%' || p.up_character || '%' OR
            p.up_character ILIKE '%' || COALESCE(h.character_name, h.item_name, '') || '%'
          )
        ELSE COALESCE(h.is_standard, false)
      END as is_standard_calc
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
  ),
  base_pulls AS (
    SELECT
      h.*,
      COALESCE(
        CASE
          WHEN h.pool_type IN ('limited', 'limited_character') THEN 'limited'
          WHEN h.pool_type IN ('weapon', 'limited_weapon') THEN 'weapon'
          WHEN h.pool_type IN ('standard', 'beginner') THEN 'standard'
          ELSE NULL
        END,
        CASE
          WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
          WHEN split_part(h.pool_id, '_', 1) = 'special' THEN 'limited'
          WHEN split_part(h.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
          WHEN h.is_standard_calc = true THEN 'standard'
          ELSE 'limited'
        END
      ) AS classified_pool_type
    FROM history_with_correct_is_standard h
    WHERE h.special_type IS DISTINCT FROM 'gift'
  ),
  standard_pulls AS (
    SELECT * FROM base_pulls WHERE classified_pool_type = 'standard'
  ),
  standard_ordered AS (
    SELECT pool_id, user_id, rarity,
           ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM standard_pulls
  ),
  standard_six_pity AS (
    SELECT pool_id, user_id,
           rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM standard_ordered
    WHERE rarity = 6
  ),
  standard_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label
    FROM standard_six_pity
  ),
  standard_grouped AS (
    SELECT
      range_label,
      0 as limited_count,
      COUNT(*) as standard_count
    FROM standard_pity_ranges
    GROUP BY range_label
  )
  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM standard_pulls), 0),
    'six', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6), 0),
    'sixStarLimited', 0,
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6), 0),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM standard_six_pity), 1), 0),
    'counts', json_build_object(
      '6', 0,
      '6_std', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6), 0),
      '5', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity <= 4), 0)
    ),
    'distribution', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        ) ORDER BY range_label
      ) FROM standard_grouped),
      '[]'::json
    )
  ) INTO standard_stats;

  -- ============================================
  -- 6. 组装最终结果（使用重新计算的 is_standard）
  -- ============================================
  WITH history_with_correct_is_standard AS (
    SELECT
      h.*,
      p.type as pool_type,
      p.up_character,
      CASE
        WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN true
        WHEN h.rarity = 6 AND p.up_character IS NOT NULL THEN
          NOT (
            COALESCE(h.character_name, '') ILIKE '%' || p.up_character || '%' OR
            COALESCE(h.item_name, '') ILIKE '%' || p.up_character || '%' OR
            p.up_character ILIKE '%' || COALESCE(h.character_name, h.item_name, '') || '%'
          )
        ELSE COALESCE(h.is_standard, false)
      END as is_standard_calc
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
  )
  SELECT json_build_object(
    'totalPulls', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE special_type IS DISTINCT FROM 'gift'), 0),
    'totalUsers', COALESCE((SELECT COUNT(*) FROM profiles), 0),
    'sixStarTotal', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE rarity = 6 AND is_standard_calc = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE rarity = 6 AND is_standard_calc = true), 0),
    'fiveStar', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE rarity = 5), 0),
    'fourStar', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE rarity <= 4), 0),
    'avgPity', ROUND(avg_pity, 1),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE rarity = 6 AND is_standard_calc = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE rarity = 6 AND is_standard_calc = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE rarity <= 4), 0)
    ),
    'distribution', global_distribution,
    'byType', json_build_object(
      'limited', limited_stats,
      'weapon', weapon_stats,
      'standard', standard_stats
    ),
    -- 赠送数量（这些仍使用原始 is_standard，因为赠送不需要重新计算）
    'charGift', COALESCE((SELECT COUNT(*) FROM history WHERE special_type = 'gift' AND rarity = 6 AND is_standard = false), 0),
    'weaponGiftLimited', COALESCE((SELECT COUNT(*) FROM history WHERE special_type = 'gift' AND rarity = 6 AND is_standard = false), 0),
    'weaponGiftStandard', COALESCE((SELECT COUNT(*) FROM history WHERE special_type = 'gift' AND rarity = 6 AND is_standard = true), 0),
    'giftTotal', COALESCE((SELECT COUNT(*) FROM history WHERE special_type = 'gift'), 0)
  ) INTO result;

  RETURN result;
END;
$$;

-- 授权所有认证用户调用此函数
GRANT EXECUTE ON FUNCTION get_global_stats() TO authenticated;
-- 也授权匿名用户（如果需要未登录也能看到统计）
GRANT EXECUTE ON FUNCTION get_global_stats() TO anon;
-- <<< END MIGRATION: archive/051_fix_is_standard_calculation.sql

-- >>> BEGIN MIGRATION: archive/052_fix_bilibili_record_conflict.sql
-- ============================================
-- 052: 修复 B服/官服 record_id 冲突问题
--
-- 问题描述：
--   官服和 B服 的 seqId 是各自独立递增的，但 record_id 计算时
--   没有区分 game_uid，导致相同 seqId 产生相同 record_id，
--   触发 upsert 覆盖而非插入，造成 B服增量数据丢失。
--
-- 解决方案：
--   1. 添加 (user_id, game_uid, seq_id) 唯一约束
--   2. 前端 upsert 改用新约束
--   3. 现有数据无需重新导入
--
-- 执行日期: 2026-02-03
-- ============================================

-- 0. 补齐 V2 历史导入链依赖的字段（旧库可能从未执行过 manual/legacy/042）
ALTER TABLE public.history
  ADD COLUMN IF NOT EXISTS batch_id TEXT,
  ADD COLUMN IF NOT EXISTS seq_id TEXT,
  ADD COLUMN IF NOT EXISTS pity INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_new BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS game_uid TEXT;

COMMENT ON COLUMN public.history.batch_id IS '批次 ID（十连分组）';
COMMENT ON COLUMN public.history.seq_id IS '官方序列号（去重用）';
COMMENT ON COLUMN public.history.pity IS '当前保底计数';
COMMENT ON COLUMN public.history.is_new IS '是否首次获得';
COMMENT ON COLUMN public.history.is_free IS '是否免费抽取';
COMMENT ON COLUMN public.history.game_uid IS '关联的游戏账号 UID';

CREATE INDEX IF NOT EXISTS idx_history_batch_id ON public.history(batch_id);
CREATE INDEX IF NOT EXISTS idx_history_seq_id ON public.history(seq_id);
CREATE INDEX IF NOT EXISTS idx_history_game_uid ON public.history(game_uid);

-- 1~6. 仅在 seq_id / game_uid 已存在时执行去重和约束修复
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'history' AND column_name = 'seq_id'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'history' AND column_name = 'game_uid'
  ) THEN
    -- 1. 为没有 game_uid 的历史记录补充默认值（避免唯一约束冲突）
    UPDATE public.history
    SET game_uid = 'legacy_' || LEFT(user_id::text, 8)
    WHERE game_uid IS NULL AND seq_id IS NOT NULL;

    -- 2. 清理可能存在的重复数据（保留 id 更大的，即更新的记录）
    DELETE FROM public.history
    WHERE id IN (
      SELECT id
      FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY user_id, game_uid, seq_id
          ORDER BY updated_at DESC NULLS LAST, id DESC
        ) AS rn
        FROM public.history
        WHERE seq_id IS NOT NULL AND game_uid IS NOT NULL
      ) duplicates
      WHERE duplicates.rn > 1
    );

    -- 3. 添加新的唯一约束（基于 user_id + game_uid + seq_id）
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'history_user_game_seq_unique'
    ) THEN
      ALTER TABLE public.history
      ADD CONSTRAINT history_user_game_seq_unique
      UNIQUE (user_id, game_uid, seq_id);

      RAISE NOTICE 'Added unique constraint: history_user_game_seq_unique';
    ELSE
      RAISE NOTICE 'Constraint history_user_game_seq_unique already exists';
    END IF;
  ELSE
    RAISE NOTICE 'Migration 052 skipped data cleanup because history.game_uid / history.seq_id are unavailable';
  END IF;
END $$;

-- 4. 创建复合索引优化查询性能
CREATE INDEX IF NOT EXISTS idx_history_user_game_seq
ON public.history(user_id, game_uid, seq_id);

-- 5. 添加约束说明注释
COMMENT ON CONSTRAINT history_user_game_seq_unique ON public.history IS
'确保同一用户、同一游戏账号（官服/B服）、同一 seq_id 不重复';

-- 6. 输出修复统计信息
DO $$
DECLARE
  legacy_count INT;
  total_records INT;
  unique_game_uids INT;
BEGIN
  SELECT COUNT(*) INTO legacy_count FROM history WHERE game_uid LIKE 'legacy_%';
  SELECT COUNT(*) INTO total_records FROM history;
  SELECT COUNT(DISTINCT game_uid) INTO unique_game_uids FROM history WHERE game_uid IS NOT NULL;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 052 完成';
  RAISE NOTICE '总记录数: %', total_records;
  RAISE NOTICE '补充默认 game_uid 的记录数: %', legacy_count;
  RAISE NOTICE '不同 game_uid 数量: %', unique_game_uids;
  RAISE NOTICE '========================================';
END $$;
-- <<< END MIGRATION: archive/052_fix_bilibili_record_conflict.sql

-- >>> BEGIN MIGRATION: archive/053_remove_old_record_id_constraint.sql
-- ============================================
-- 053: 移除旧的 record_id 唯一约束
--
-- 问题描述：
--   052 添加了新的 (user_id, game_uid, seq_id) 唯一约束，
--   但旧的 (user_id, record_id) 约束仍然存在。
--   当 upsert 使用新约束时，如果数据同时违反旧约束就会报 409 冲突错误。
--
-- 解决方案：
--   删除旧的 history_user_record_id_unique 约束，
--   只保留新的 history_user_game_seq_unique 约束。
--
-- 执行日期: 2026-02-03
-- ============================================

-- 1. 删除旧的唯一约束（如果存在）
DO $$
BEGIN
  -- 删除 history_user_record_id_unique 约束
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'history_user_record_id_unique'
  ) THEN
    ALTER TABLE history
    DROP CONSTRAINT history_user_record_id_unique;

    RAISE NOTICE 'Dropped constraint: history_user_record_id_unique';
  ELSE
    RAISE NOTICE 'Constraint history_user_record_id_unique does not exist, skipping';
  END IF;

  -- 同时检查并删除可能存在的其他旧约束名称变体
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'history_user_id_record_id_key'
  ) THEN
    ALTER TABLE history
    DROP CONSTRAINT history_user_id_record_id_key;

    RAISE NOTICE 'Dropped constraint: history_user_id_record_id_key';
  END IF;
END $$;

-- 2. 仅在 game_uid / seq_id 已存在时确保新约束存在
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'history' AND column_name = 'game_uid'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'history' AND column_name = 'seq_id'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'history_user_game_seq_unique'
    ) THEN
      ALTER TABLE history
      ADD CONSTRAINT history_user_game_seq_unique
      UNIQUE (user_id, game_uid, seq_id);

      RAISE NOTICE 'Added unique constraint: history_user_game_seq_unique';
    ELSE
      RAISE NOTICE 'Constraint history_user_game_seq_unique already exists';
    END IF;
  ELSE
    RAISE NOTICE 'Skipping history_user_game_seq_unique because history.game_uid / history.seq_id are unavailable';
  END IF;
END $$;

-- 3. 保留 record_id 的普通索引（用于查询性能，但不是唯一约束）
CREATE INDEX IF NOT EXISTS idx_history_user_record_id
ON history(user_id, record_id);

-- 4. 输出当前约束状态
DO $$
DECLARE
  constraint_count INT;
BEGIN
  SELECT COUNT(*) INTO constraint_count
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  WHERE t.relname = 'history' AND c.contype = 'u';

  RAISE NOTICE '======================================';
  RAISE NOTICE 'Migration 053 完成';
  RAISE NOTICE 'history 表当前唯一约束数量: %', constraint_count;
  RAISE NOTICE '======================================';
END $$;
-- <<< END MIGRATION: archive/053_remove_old_record_id_constraint.sql

-- >>> BEGIN MIGRATION: archive/054_fix_pool_join_condition.sql
-- =====================================================
-- 迁移文件: 054_fix_pool_join_condition.sql
-- 描述: 修复 get_global_stats 函数中的 JOIN 条件
-- =====================================================
--
-- 问题原因：
-- 迁移 048 将 pools 表主键从 (user_id, pool_id) 改为 (pool_id)
-- 但 051 的 SQL 函数仍使用旧的 JOIN 条件：
--   LEFT JOIN pools p ON h.pool_id = p.pool_id AND h.user_id = p.user_id
--
-- 由于 pools 现在是全局共享的，user_id 是创建者而非所有者
-- 导致 history 记录无法正确关联 pool 信息，武器池数据无法显示
--
-- 修复方案：
-- 移除 JOIN 条件中的 "AND h.user_id = p.user_id"
--
-- =====================================================

CREATE OR REPLACE FUNCTION get_global_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  avg_pity NUMERIC;
  global_distribution JSON;
  limited_stats JSON;
  weapon_stats JSON;
  standard_stats JSON;
BEGIN
  -- ============================================
  -- 核心CTE: 重新计算所有记录的 is_standard
  -- 修复: 移除 JOIN 中的 user_id 条件
  -- ============================================
  WITH history_with_correct_is_standard AS (
    SELECT
      h.*,
      p.type as pool_type,
      p.up_character,
      -- 动态计算正确的 is_standard
      CASE
        -- 常驻池/新手池：全是常驻
        WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN true
        -- 限定/武器池的6星：检查是否匹配UP
        WHEN h.rarity = 6 AND p.up_character IS NOT NULL THEN
          NOT (
            COALESCE(h.character_name, '') ILIKE '%' || p.up_character || '%' OR
            COALESCE(h.item_name, '') ILIKE '%' || p.up_character || '%' OR
            p.up_character ILIKE '%' || COALESCE(h.character_name, h.item_name, '') || '%'
          )
        -- 其他情况：保持原值
        ELSE COALESCE(h.is_standard, false)
      END as is_standard_calc
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id  -- 修复: 移除 AND h.user_id = p.user_id
  )

  -- ============================================
  -- 1. 计算全局平均出货
  -- ============================================
  ,ordered_pulls AS (
    SELECT
      pool_id,
      user_id,
      rarity,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM history_with_correct_is_standard
    WHERE special_type IS DISTINCT FROM 'gift'
  ),
  six_stars_with_prev AS (
    SELECT
      pool_id,
      user_id,
      rn,
      LAG(rn, 1, 0) OVER (PARTITION BY pool_id, user_id ORDER BY rn) as prev_rn
    FROM ordered_pulls
    WHERE rarity = 6
  )
  SELECT COALESCE(AVG(rn - prev_rn), 0) INTO avg_pity FROM six_stars_with_prev;

  -- ============================================
  -- 2. 计算全局6星出货分布
  -- ============================================
  WITH history_with_correct_is_standard AS (
    SELECT
      h.*,
      p.type as pool_type,
      p.up_character,
      CASE
        WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN true
        WHEN h.rarity = 6 AND p.up_character IS NOT NULL THEN
          NOT (
            COALESCE(h.character_name, '') ILIKE '%' || p.up_character || '%' OR
            COALESCE(h.item_name, '') ILIKE '%' || p.up_character || '%' OR
            p.up_character ILIKE '%' || COALESCE(h.character_name, h.item_name, '') || '%'
          )
        ELSE COALESCE(h.is_standard, false)
      END as is_standard_calc
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id  -- 修复
  ),
  ordered_pulls AS (
    SELECT
      h.pool_id,
      h.user_id,
      h.rarity,
      h.is_standard_calc,
      ROW_NUMBER() OVER (PARTITION BY h.pool_id, h.user_id ORDER BY h.record_id) as rn
    FROM history_with_correct_is_standard h
    WHERE h.special_type IS DISTINCT FROM 'gift'
  ),
  six_stars_pity AS (
    SELECT
      is_standard_calc,
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM ordered_pulls
    WHERE rarity = 6
  ),
  pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard_calc
    FROM six_stars_pity
  ),
  grouped_ranges AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard_calc THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard_calc THEN 1 ELSE 0 END) as standard_count
    FROM pity_ranges
    GROUP BY range_label
  )
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'range', REPLACE(range_label, '01-10', '1-10'),
        'limited', limited_count,
        'standard', standard_count
      ) ORDER BY range_label
    ),
    '[]'::json
  ) INTO global_distribution FROM grouped_ranges;

  -- ============================================
  -- 3. 计算限定池统计
  -- ============================================
  WITH history_with_correct_is_standard AS (
    SELECT
      h.*,
      p.type as pool_type,
      p.up_character,
      CASE
        WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN true
        WHEN h.rarity = 6 AND p.up_character IS NOT NULL THEN
          NOT (
            COALESCE(h.character_name, '') ILIKE '%' || p.up_character || '%' OR
            COALESCE(h.item_name, '') ILIKE '%' || p.up_character || '%' OR
            p.up_character ILIKE '%' || COALESCE(h.character_name, h.item_name, '') || '%'
          )
        ELSE COALESCE(h.is_standard, false)
      END as is_standard_calc
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id  -- 修复
  ),
  base_pulls AS (
    SELECT
      h.*,
      COALESCE(
        CASE
          WHEN h.pool_type IN ('limited', 'limited_character') THEN 'limited'
          WHEN h.pool_type IN ('weapon', 'limited_weapon') THEN 'weapon'
          WHEN h.pool_type IN ('standard', 'beginner') THEN 'standard'
          ELSE NULL
        END,
        CASE
          WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
          WHEN split_part(h.pool_id, '_', 1) = 'special' THEN 'limited'
          WHEN split_part(h.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
          WHEN h.is_standard_calc = true THEN 'standard'
          ELSE 'limited'
        END
      ) AS classified_pool_type
    FROM history_with_correct_is_standard h
    WHERE h.special_type IS DISTINCT FROM 'gift'
  ),
  limited_pulls AS (
    SELECT * FROM base_pulls WHERE classified_pool_type = 'limited'
  ),
  limited_ordered AS (
    SELECT pool_id, user_id, rarity, is_standard_calc,
           ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM limited_pulls
  ),
  limited_six_pity AS (
    SELECT pool_id, user_id, is_standard_calc,
           rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM limited_ordered
    WHERE rarity = 6
  ),
  limited_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard_calc
    FROM limited_six_pity
  ),
  limited_grouped AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard_calc THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard_calc THEN 1 ELSE 0 END) as standard_count
    FROM limited_pity_ranges
    GROUP BY range_label
  )
  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM limited_pulls), 0),
    'six', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard_calc = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard_calc = true), 0),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM limited_six_pity), 1), 0),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard_calc = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard_calc = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity <= 4), 0)
    ),
    'distribution', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        ) ORDER BY range_label
      ) FROM limited_grouped),
      '[]'::json
    )
  ) INTO limited_stats;

  -- ============================================
  -- 4. 计算武器池统计
  -- ============================================
  WITH history_with_correct_is_standard AS (
    SELECT
      h.*,
      p.type as pool_type,
      p.up_character,
      CASE
        WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN true
        WHEN h.rarity = 6 AND p.up_character IS NOT NULL THEN
          NOT (
            COALESCE(h.character_name, '') ILIKE '%' || p.up_character || '%' OR
            COALESCE(h.item_name, '') ILIKE '%' || p.up_character || '%' OR
            p.up_character ILIKE '%' || COALESCE(h.character_name, h.item_name, '') || '%'
          )
        ELSE COALESCE(h.is_standard, false)
      END as is_standard_calc
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id  -- 修复
  ),
  base_pulls AS (
    SELECT
      h.*,
      COALESCE(
        CASE
          WHEN h.pool_type IN ('limited', 'limited_character') THEN 'limited'
          WHEN h.pool_type IN ('weapon', 'limited_weapon') THEN 'weapon'
          WHEN h.pool_type IN ('standard', 'beginner') THEN 'standard'
          ELSE NULL
        END,
        CASE
          WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
          WHEN split_part(h.pool_id, '_', 1) = 'special' THEN 'limited'
          WHEN split_part(h.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
          WHEN h.is_standard_calc = true THEN 'standard'
          ELSE 'limited'
        END
      ) AS classified_pool_type
    FROM history_with_correct_is_standard h
    WHERE h.special_type IS DISTINCT FROM 'gift'
  ),
  weapon_pulls AS (
    SELECT * FROM base_pulls WHERE classified_pool_type = 'weapon'
  ),
  weapon_ordered AS (
    SELECT pool_id, user_id, rarity, is_standard_calc,
           ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM weapon_pulls
  ),
  weapon_six_pity AS (
    SELECT pool_id, user_id, is_standard_calc,
           rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM weapon_ordered
    WHERE rarity = 6
  ),
  weapon_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard_calc
    FROM weapon_six_pity
  ),
  weapon_grouped AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard_calc THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard_calc THEN 1 ELSE 0 END) as standard_count
    FROM weapon_pity_ranges
    GROUP BY range_label
  )
  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM weapon_pulls), 0),
    'six', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard_calc = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard_calc = true), 0),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM weapon_six_pity), 1), 0),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard_calc = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard_calc = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity <= 4), 0)
    ),
    'distribution', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        ) ORDER BY range_label
      ) FROM weapon_grouped),
      '[]'::json
    )
  ) INTO weapon_stats;

  -- ============================================
  -- 5. 计算常驻池统计
  -- ============================================
  WITH history_with_correct_is_standard AS (
    SELECT
      h.*,
      p.type as pool_type,
      p.up_character,
      CASE
        WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN true
        WHEN h.rarity = 6 AND p.up_character IS NOT NULL THEN
          NOT (
            COALESCE(h.character_name, '') ILIKE '%' || p.up_character || '%' OR
            COALESCE(h.item_name, '') ILIKE '%' || p.up_character || '%' OR
            p.up_character ILIKE '%' || COALESCE(h.character_name, h.item_name, '') || '%'
          )
        ELSE COALESCE(h.is_standard, false)
      END as is_standard_calc
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id  -- 修复
  ),
  base_pulls AS (
    SELECT
      h.*,
      COALESCE(
        CASE
          WHEN h.pool_type IN ('limited', 'limited_character') THEN 'limited'
          WHEN h.pool_type IN ('weapon', 'limited_weapon') THEN 'weapon'
          WHEN h.pool_type IN ('standard', 'beginner') THEN 'standard'
          ELSE NULL
        END,
        CASE
          WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
          WHEN split_part(h.pool_id, '_', 1) = 'special' THEN 'limited'
          WHEN split_part(h.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
          WHEN h.is_standard_calc = true THEN 'standard'
          ELSE 'limited'
        END
      ) AS classified_pool_type
    FROM history_with_correct_is_standard h
    WHERE h.special_type IS DISTINCT FROM 'gift'
  ),
  standard_pulls AS (
    SELECT * FROM base_pulls WHERE classified_pool_type = 'standard'
  ),
  standard_ordered AS (
    SELECT pool_id, user_id, rarity,
           ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM standard_pulls
  ),
  standard_six_pity AS (
    SELECT pool_id, user_id,
           rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0) as pity
    FROM standard_ordered
    WHERE rarity = 6
  ),
  standard_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label
    FROM standard_six_pity
  ),
  standard_grouped AS (
    SELECT
      range_label,
      0 as limited_count,
      COUNT(*) as standard_count
    FROM standard_pity_ranges
    GROUP BY range_label
  )
  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM standard_pulls), 0),
    'six', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6), 0),
    'sixStarLimited', 0,
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6), 0),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM standard_six_pity), 1), 0),
    'counts', json_build_object(
      '6', 0,
      '6_std', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6), 0),
      '5', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity <= 4), 0)
    ),
    'distribution', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        ) ORDER BY range_label
      ) FROM standard_grouped),
      '[]'::json
    )
  ) INTO standard_stats;

  -- ============================================
  -- 6. 组装最终结果
  -- ============================================
  WITH history_with_correct_is_standard AS (
    SELECT
      h.*,
      p.type as pool_type,
      p.up_character,
      CASE
        WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN true
        WHEN h.rarity = 6 AND p.up_character IS NOT NULL THEN
          NOT (
            COALESCE(h.character_name, '') ILIKE '%' || p.up_character || '%' OR
            COALESCE(h.item_name, '') ILIKE '%' || p.up_character || '%' OR
            p.up_character ILIKE '%' || COALESCE(h.character_name, h.item_name, '') || '%'
          )
        ELSE COALESCE(h.is_standard, false)
      END as is_standard_calc
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id  -- 修复
  )
  SELECT json_build_object(
    'totalPulls', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE special_type IS DISTINCT FROM 'gift'), 0),
    'totalUsers', COALESCE((SELECT COUNT(*) FROM profiles), 0),
    'sixStarTotal', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE rarity = 6 AND is_standard_calc = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE rarity = 6 AND is_standard_calc = true), 0),
    'fiveStar', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE rarity = 5), 0),
    'fourStar', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE rarity <= 4), 0),
    'avgPity', ROUND(avg_pity, 1),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE rarity = 6 AND is_standard_calc = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE rarity = 6 AND is_standard_calc = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM history_with_correct_is_standard WHERE rarity <= 4), 0)
    ),
    'distribution', global_distribution,
    'byType', json_build_object(
      'limited', limited_stats,
      'weapon', weapon_stats,
      'standard', standard_stats
    ),
    'charGift', COALESCE((SELECT COUNT(*) FROM history WHERE special_type = 'gift' AND rarity = 6 AND is_standard = false), 0),
    'weaponGiftLimited', COALESCE((SELECT COUNT(*) FROM history WHERE special_type = 'gift' AND rarity = 6 AND is_standard = false), 0),
    'weaponGiftStandard', COALESCE((SELECT COUNT(*) FROM history WHERE special_type = 'gift' AND rarity = 6 AND is_standard = true), 0),
    'giftTotal', COALESCE((SELECT COUNT(*) FROM history WHERE special_type = 'gift'), 0)
  ) INTO result;

  RETURN result;
END;
$$;

-- 授权
GRANT EXECUTE ON FUNCTION get_global_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION get_global_stats() TO anon;

-- 验证修复
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 054: 修复 get_global_stats JOIN 条件完成';
  RAISE NOTICE '   - 移除了 "AND h.user_id = p.user_id" 条件';
  RAISE NOTICE '   - pools 表现在是全局共享的，不需要按 user_id 匹配';
END $$;
-- <<< END MIGRATION: archive/054_fix_pool_join_condition.sql

-- >>> BEGIN MIGRATION: archive/055_fix_pools_constraints.sql
-- =====================================================
-- 迁移文件: 055_fix_pools_constraints.sql
-- 描述: 清理 pools 表上的残留唯一约束
-- =====================================================
--
-- 问题原因：
-- 迁移 048 将 pools 表主键从 (user_id, pool_id) 改为 (pool_id)
-- 但可能遗留了旧的 UNIQUE 约束 pools_user_pool_id_unique
-- 导致不同用户导入相同卡池时触发约束冲突
--
-- =====================================================

-- 1. 检查并删除残留的唯一约束
DO $$
BEGIN
  -- 删除 pools_user_pool_id_unique 约束（如果存在）
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pools_user_pool_id_unique'
    AND conrelid = 'pools'::regclass
  ) THEN
    ALTER TABLE pools DROP CONSTRAINT pools_user_pool_id_unique;
    RAISE NOTICE '✅ 已删除约束 pools_user_pool_id_unique';
  ELSE
    RAISE NOTICE 'ℹ️ 约束 pools_user_pool_id_unique 不存在，无需删除';
  END IF;

  -- 同时检查并删除其他可能的残留约束
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pools_user_id_pool_id_key'
    AND conrelid = 'pools'::regclass
  ) THEN
    ALTER TABLE pools DROP CONSTRAINT pools_user_id_pool_id_key;
    RAISE NOTICE '✅ 已删除约束 pools_user_id_pool_id_key';
  END IF;
END $$;

-- 2. 确保 pool_id 是唯一的主键
DO $$
BEGIN
  -- 检查当前主键
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'p'
    AND c.conrelid = 'pools'::regclass
    AND a.attname = 'pool_id'
    AND array_length(c.conkey, 1) = 1  -- 只有一个列
  ) THEN
    RAISE NOTICE '⚠️ 警告：pool_id 不是单列主键，请检查 pools 表结构';
  ELSE
    RAISE NOTICE '✅ pool_id 是正确的单列主键';
  END IF;
END $$;

-- 3. 列出当前 pools 表的所有约束（供验证）
DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  RAISE NOTICE '📋 当前 pools 表的约束列表:';
  FOR constraint_record IN
    SELECT c.conname, c.contype,
           array_agg(a.attname ORDER BY array_position(c.conkey, a.attnum)) as columns
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'pools'::regclass
    GROUP BY c.conname, c.contype
  LOOP
    RAISE NOTICE '   - %: type=%, columns=%',
      constraint_record.conname,
      constraint_record.contype,
      constraint_record.columns;
  END LOOP;
END $$;

-- 验证完成
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Migration 055: pools 表约束清理完成';
  RAISE NOTICE '   请在 Supabase SQL Editor 中执行此迁移';
END $$;
-- <<< END MIGRATION: archive/055_fix_pools_constraints.sql

-- >>> BEGIN MIGRATION: archive/056_fix_history_unique_constraint.sql
-- =====================================================
-- 迁移文件: 056_fix_history_unique_constraint.sql
-- 描述: 修复 history 表的唯一约束，添加 pool_id
-- =====================================================
--
-- 问题原因：
-- seqId 是每个卡池独立的序列号，不同卡池可能有相同的 seqId
-- 例如：限定池 seqId=1 和 常驻池 seqId=1 是不同的记录
--
-- 原约束 (user_id, game_uid, seq_id) 会导致：
-- 1. 去重逻辑误判不同卡池的记录为重复
-- 2. upsert 时覆盖错误的记录
--
-- 修复方案：
-- 将约束改为 (user_id, game_uid, pool_id, seq_id)
--
-- =====================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'history' AND column_name = 'game_uid'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'history' AND column_name = 'seq_id'
  ) THEN
    -- 1. 删除旧的唯一约束
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'history_user_id_game_uid_seq_id_key'
      AND conrelid = 'history'::regclass
    ) THEN
      ALTER TABLE history DROP CONSTRAINT history_user_id_game_uid_seq_id_key;
      RAISE NOTICE '✅ 已删除旧约束 history_user_id_game_uid_seq_id_key';
    ELSE
      RAISE NOTICE 'ℹ️ 约束 history_user_id_game_uid_seq_id_key 不存在';
    END IF;

    -- 检查其他可能的命名
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'history_user_game_seq_unique'
      AND conrelid = 'history'::regclass
    ) THEN
      ALTER TABLE history DROP CONSTRAINT history_user_game_seq_unique;
      RAISE NOTICE '✅ 已删除旧约束 history_user_game_seq_unique';
    END IF;

    -- 2. 创建新的唯一约束（包含 pool_id）
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'history_user_game_pool_seq_unique'
      AND conrelid = 'history'::regclass
    ) THEN
      ALTER TABLE history
      ADD CONSTRAINT history_user_game_pool_seq_unique
      UNIQUE (user_id, game_uid, pool_id, seq_id);
      RAISE NOTICE '✅ 已创建新约束 history_user_game_pool_seq_unique';
    ELSE
      RAISE NOTICE 'ℹ️ 约束 history_user_game_pool_seq_unique 已存在';
    END IF;
  ELSE
    RAISE NOTICE 'ℹ️ 跳过 history pool 级唯一约束修复，因为 history.game_uid / history.seq_id 不存在';
  END IF;
END $$;

-- 3. 列出当前 history 表的唯一约束（供验证）
DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  RAISE NOTICE '📋 当前 history 表的唯一约束:';
  FOR constraint_record IN
    SELECT c.conname,
           array_agg(a.attname ORDER BY array_position(c.conkey, a.attnum)) as columns
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'history'::regclass
    AND c.contype = 'u'  -- 只看 UNIQUE 约束
    GROUP BY c.conname
  LOOP
    RAISE NOTICE '   - %: columns=%', constraint_record.conname, constraint_record.columns;
  END LOOP;
END $$;

-- 验证完成
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Migration 056: history 唯一约束修复完成';
  RAISE NOTICE '   新约束: (user_id, game_uid, pool_id, seq_id)';
  RAISE NOTICE '   这确保了不同卡池的相同 seqId 被正确区分';
END $$;
-- <<< END MIGRATION: archive/056_fix_history_unique_constraint.sql

-- >>> BEGIN MIGRATION: archive/057_enhance_character_ranking_stats.sql
-- =====================================================
-- 057: 增强角色出货排名统计函数
--
-- FEAT-010 需求：
-- 1. 限定池六星单独列出个数（UP六星 vs 歪出六星）
-- 2. 将"限定池六星排名"改为统计"歪出的六星"
-- 3. 为常驻池六星排名增加第四名和第五名（LIMIT 5）
--
-- 修复：使用 characters.is_limited 判断是否为限定角色
--       而不是依赖 history.is_standard（该字段数据不准确）
-- =====================================================

-- 删除旧函数
DROP FUNCTION IF EXISTS public.get_character_ranking_stats();

-- 创建增强后的角色排名统计函数
CREATE OR REPLACE FUNCTION public.get_character_ranking_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  WITH
  -- 关联卡池类型和角色/武器类型
  history_with_info AS (
    SELECT
      h.rarity,
      h.item_name,
      h.is_free,
      h.special_type,
      h.pool_id,
      -- 从 characters 表获取物品类型（角色/武器）
      COALESCE(c.type, 'character') as item_type,
      -- 🔧 修复：使用 characters.is_limited 判断是否为限定角色
      COALESCE(c.is_limited, false) as char_is_limited,
      -- 根据 pool_id 前缀判断卡池类型
      CASE
        -- 限定池：以 special_ 开头
        WHEN h.pool_id LIKE 'special_%' THEN 'limited'
        -- 武器池：以 weapon 开头（包括 weaponbox_、weponbox_ 等）
        WHEN h.pool_id LIKE 'weapon%' OR h.pool_id LIKE 'wepon%' THEN 'weapon'
        -- 常驻池：standard 或 beginner
        WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
        -- UUID 格式的 pool_id，从 pools 表获取类型
        WHEN h.pool_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          COALESCE(
            (SELECT
              CASE
                WHEN p.type IN ('limited', 'limited_character') THEN 'limited'
                WHEN p.type IN ('weapon', 'limited_weapon') THEN 'weapon'
                ELSE 'standard'
              END
            FROM public.pools p
            WHERE p.id = h.pool_id::uuid
            ),
            'standard'
          )
        ELSE 'standard'
      END as pool_type
    FROM public.history h
    -- LEFT JOIN characters 表获取物品类型和限定状态
    LEFT JOIN public.characters c ON c.name = h.item_name
    WHERE h.special_type IS DISTINCT FROM 'gift'
      AND h.item_name IS NOT NULL
      AND h.item_name != ''
  ),

  -- ========== 限定池统计（仅角色） ==========
  -- 限定池6★UP角色排名（限定角色 = char_is_limited = true）
  limited_six_star_up AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'limited'
      AND rarity = 6
      AND item_type = 'character'
      AND char_is_limited = true
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 5
  ),

  -- 限定池6★歪出角色排名（常驻角色 = char_is_limited = false）
  limited_six_star_off AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'limited'
      AND rarity = 6
      AND item_type = 'character'
      AND char_is_limited = false
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 5
  ),

  -- 限定池5★角色排名
  limited_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'limited'
      AND rarity = 5
      AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- ========== 常驻池统计（仅角色）- 增加到 TOP5 ==========
  -- 常驻池6★角色排名
  standard_six_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'standard'
      AND rarity = 6
      AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 5
  ),

  -- 常驻池5★角色排名
  standard_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'standard'
      AND rarity = 5
      AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- ========== 武器池统计（仅武器） ==========
  -- 武器池6★UP武器排名（限定武器）
  weapon_six_star_up AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'weapon'
      AND rarity = 6
      AND item_type = 'weapon'
      AND char_is_limited = true
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- 武器池6★歪出武器排名（常驻武器）
  weapon_six_star_off AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'weapon'
      AND rarity = 6
      AND item_type = 'weapon'
      AND char_is_limited = false
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- 武器池5★武器排名
  weapon_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'weapon'
      AND rarity = 5
      AND item_type = 'weapon'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- ========== 数量统计 ==========
  -- 限定池6★角色数量统计（区分UP/歪/免费）
  limited_six_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE is_free = false OR is_free IS NULL) as excluding_free,
      COUNT(*) FILTER (WHERE char_is_limited = true) as up_count,
      COUNT(*) FILTER (WHERE char_is_limited = false) as off_count,
      COUNT(*) FILTER (WHERE char_is_limited = true AND (is_free = false OR is_free IS NULL)) as up_excluding_free,
      COUNT(*) FILTER (WHERE char_is_limited = false AND (is_free = false OR is_free IS NULL)) as off_excluding_free
    FROM history_with_info
    WHERE pool_type = 'limited'
      AND rarity = 6
      AND item_type = 'character'
  ),

  -- 常驻池6★角色数量统计
  standard_six_counts AS (
    SELECT COUNT(*) as total
    FROM history_with_info
    WHERE pool_type = 'standard'
      AND rarity = 6
      AND item_type = 'character'
  ),

  -- 武器池6★武器数量统计（区分UP/歪）
  weapon_six_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE char_is_limited = true) as up_count,
      COUNT(*) FILTER (WHERE char_is_limited = false) as off_count
    FROM history_with_info
    WHERE pool_type = 'weapon'
      AND rarity = 6
      AND item_type = 'weapon'
  )

  SELECT json_build_object(
    'limited', json_build_object(
      'sixStarUp', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_up),
      'sixStarOff', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_off),
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_up),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_five_star),
      'sixStarTotal', (SELECT COALESCE(total, 0) FROM limited_six_counts),
      'sixStarExcludingFree', (SELECT COALESCE(excluding_free, 0) FROM limited_six_counts),
      'sixStarUpCount', (SELECT COALESCE(up_count, 0) FROM limited_six_counts),
      'sixStarOffCount', (SELECT COALESCE(off_count, 0) FROM limited_six_counts),
      'sixStarUpExcludingFree', (SELECT COALESCE(up_excluding_free, 0) FROM limited_six_counts),
      'sixStarOffExcludingFree', (SELECT COALESCE(off_excluding_free, 0) FROM limited_six_counts)
    ),
    'standard', json_build_object(
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_six_star),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_five_star),
      'sixStarTotal', (SELECT COALESCE(total, 0) FROM standard_six_counts)
    ),
    'weapon', json_build_object(
      'sixStarUp', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_up),
      'sixStarOff', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_off),
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_up),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_five_star),
      'sixStarTotal', (SELECT COALESCE(total, 0) FROM weapon_six_counts),
      'sixStarUpCount', (SELECT COALESCE(up_count, 0) FROM weapon_six_counts),
      'sixStarOffCount', (SELECT COALESCE(off_count, 0) FROM weapon_six_counts)
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- 添加函数注释
COMMENT ON FUNCTION public.get_character_ranking_stats() IS 'FEAT-010: 增强版角色排名统计 - 使用 characters.is_limited 判断UP/歪出';

-- 授予执行权限
GRANT EXECUTE ON FUNCTION public.get_character_ranking_stats() TO anon, authenticated;

-- =====================================================
-- 同步更新用户个人排名函数
-- =====================================================

DROP FUNCTION IF EXISTS public.get_user_ranking_stats(uuid);

CREATE OR REPLACE FUNCTION public.get_user_ranking_stats(p_user_id uuid)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  WITH
  -- 关联卡池类型和角色/武器类型
  history_with_info AS (
    SELECT
      h.rarity,
      h.item_name,
      h.is_free,
      h.special_type,
      h.pool_id,
      COALESCE(c.type, 'character') as item_type,
      -- 🔧 修复：使用 characters.is_limited 判断是否为限定角色
      COALESCE(c.is_limited, false) as char_is_limited,
      CASE
        WHEN h.pool_id LIKE 'special_%' THEN 'limited'
        WHEN h.pool_id LIKE 'weapon%' OR h.pool_id LIKE 'wepon%' THEN 'weapon'
        WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
        WHEN h.pool_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          COALESCE(
            (SELECT
              CASE
                WHEN p.type IN ('limited', 'limited_character') THEN 'limited'
                WHEN p.type IN ('weapon', 'limited_weapon') THEN 'weapon'
                ELSE 'standard'
              END
            FROM public.pools p
            WHERE p.id = h.pool_id::uuid
            ),
            'standard'
          )
        ELSE 'standard'
      END as pool_type
    FROM public.history h
    LEFT JOIN public.characters c ON c.name = h.item_name
    WHERE h.user_id = p_user_id
      AND h.special_type IS DISTINCT FROM 'gift'
      AND h.item_name IS NOT NULL
      AND h.item_name != ''
  ),

  -- 限定池6★UP角色排名（限定角色）
  limited_six_star_up AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'limited' AND rarity = 6 AND item_type = 'character'
      AND char_is_limited = true
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 5
  ),

  -- 限定池6★歪出角色排名（常驻角色）
  limited_six_star_off AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'limited' AND rarity = 6 AND item_type = 'character'
      AND char_is_limited = false
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 5
  ),

  limited_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'limited' AND rarity = 5 AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- 常驻池 TOP5
  standard_six_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'standard' AND rarity = 6 AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 5
  ),
  standard_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'standard' AND rarity = 5 AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- 武器池
  weapon_six_star_up AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'weapon' AND rarity = 6 AND item_type = 'weapon'
      AND char_is_limited = true
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  weapon_six_star_off AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'weapon' AND rarity = 6 AND item_type = 'weapon'
      AND char_is_limited = false
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  weapon_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_with_info
    WHERE pool_type = 'weapon' AND rarity = 5 AND item_type = 'weapon'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- 数量统计
  limited_six_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE char_is_limited = true) as up_count,
      COUNT(*) FILTER (WHERE char_is_limited = false) as off_count
    FROM history_with_info
    WHERE pool_type = 'limited' AND rarity = 6 AND item_type = 'character'
  )

  SELECT json_build_object(
    'limited', json_build_object(
      'sixStarUp', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_up),
      'sixStarOff', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_off),
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_up),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_five_star),
      'sixStarUpCount', (SELECT COALESCE(up_count, 0) FROM limited_six_counts),
      'sixStarOffCount', (SELECT COALESCE(off_count, 0) FROM limited_six_counts)
    ),
    'standard', json_build_object(
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_six_star),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_five_star)
    ),
    'weapon', json_build_object(
      'sixStarUp', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_up),
      'sixStarOff', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_off),
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_up),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_five_star)
    )
  ) INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.get_user_ranking_stats(uuid) IS 'FEAT-010: 增强版用户排名统计 - 使用 characters.is_limited 判断UP/歪出';
GRANT EXECUTE ON FUNCTION public.get_user_ranking_stats(uuid) TO anon, authenticated;

-- =====================================================
-- 修复说明：
--
-- 问题原因：
--   history.is_standard 字段在导入时设置不准确
--   当 poolUpCharacterMap 中没有 UP 角色信息时，所有 6★ 都被标记为 UP
--
-- 解决方案：
--   使用 characters.is_limited 字段动态判断角色是否为限定
--   - char_is_limited = true  → UP 角色（限定）
--   - char_is_limited = false → 歪出角色（常驻）
--
-- 返回格式：
-- {
--   "limited": {
--     "sixStarUp": [{"name": "莱万汀", "count": 5}, ...],   -- 限定角色（不歪）
--     "sixStarOff": [{"name": "丽芙", "count": 3}, ...],    -- 常驻角色（歪出）
--     "sixStarUpCount": 7,                                  -- 限定角色总数
--     "sixStarOffCount": 3                                  -- 歪出角色总数
--   },
--   ...
-- }
-- =====================================================
-- <<< END MIGRATION: archive/057_enhance_character_ranking_stats.sql

-- >>> BEGIN MIGRATION: archive/058_add_off_banner_breakdown.sql
-- =====================================================
-- 058: 歪出六星分类统计 - 区分歪常驻 vs 歪非当期限定
--
-- FEAT-013 需求：
-- 1. 限定池歪出六星需要区分：
--    - 歪到常驻角色 (offStandard): char_is_limited = false
--    - 歪到非当期限定角色 (offLimited): char_is_limited = true 且不匹配当期UP
-- 2. 新增"限定率"指标：歪限定数 / (歪常驻数 + 歪限定数)
--
-- 实现方式：
--    JOIN pools 表获取 up_character，判断6★是否为当期UP
--    - UP: char_is_limited=true 且 item_name 匹配 up_character
--    - 歪限定: char_is_limited=true 且 item_name 不匹配 up_character
--    - 歪常驻: char_is_limited=false
--
-- BUG修复: 使用 LEFT JOIN pools ON pool_id 替代 UUID 子查询
--    pools 表主键是 pool_id (TEXT)，不是 id (SERIAL)
--    history.pool_id 格式为 special_xxx / weapon_xxx / standard 等字符串
-- =====================================================

-- 删除旧函数
DROP FUNCTION IF EXISTS public.get_character_ranking_stats();
DROP FUNCTION IF EXISTS public.get_user_ranking_stats(uuid);

-- ==================== 全服排名统计函数 ====================
CREATE OR REPLACE FUNCTION public.get_character_ranking_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  WITH
  -- 关联卡池类型、角色类型、UP角色信息
  history_with_info AS (
    SELECT
      h.rarity,
      h.item_name,
      h.is_free,
      h.special_type,
      h.pool_id,
      COALESCE(c.type, 'character') as item_type,
      COALESCE(c.is_limited, false) as char_is_limited,
      -- 直接从 JOIN 获取卡池UP角色
      p.up_character as pool_up_character,
      -- 判断卡池类型
      CASE
        WHEN h.pool_id LIKE 'special_%' THEN 'limited'
        WHEN h.pool_id LIKE 'weapon%' OR h.pool_id LIKE 'wepon%' THEN 'weapon'
        WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
        WHEN p.type IS NOT NULL THEN
          CASE
            WHEN p.type IN ('limited', 'limited_character') THEN 'limited'
            WHEN p.type IN ('weapon', 'limited_weapon') THEN 'weapon'
            ELSE 'standard'
          END
        ELSE 'standard'
      END as pool_type
    FROM public.history h
    LEFT JOIN public.characters c ON c.name = h.item_name
    LEFT JOIN public.pools p ON p.pool_id = h.pool_id
    WHERE h.special_type IS DISTINCT FROM 'gift'
      AND h.item_name IS NOT NULL
      AND h.item_name != ''
  ),

  -- 判断是否为当期UP（用于区分歪限定 vs 真UP）
  history_classified AS (
    SELECT *,
      CASE
        WHEN rarity = 6 AND char_is_limited = true THEN
          CASE
            WHEN pool_up_character IS NOT NULL
              AND (
                LOWER(item_name) = LOWER(pool_up_character)
                OR LOWER(item_name) LIKE '%' || LOWER(pool_up_character) || '%'
                OR LOWER(pool_up_character) LIKE '%' || LOWER(item_name) || '%'
              )
            THEN 'up'           -- 当期UP角色
            ELSE 'off_limited'  -- 歪到其他限定角色
          END
        WHEN rarity = 6 AND char_is_limited = false THEN 'off_standard' -- 歪到常驻角色
        ELSE 'other'
      END as six_star_category
    FROM history_with_info
  ),

  -- ========== 限定池统计（仅角色）==========
  -- 限定池6★UP角色排名
  limited_six_star_up AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited'
      AND rarity = 6
      AND item_type = 'character'
      AND six_star_category = 'up'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 5
  ),

  -- 限定池6★歪出常驻角色排名
  limited_six_star_off_standard AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited'
      AND rarity = 6
      AND item_type = 'character'
      AND six_star_category = 'off_standard'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 5
  ),

  -- 限定池6★歪出其他限定角色排名
  limited_six_star_off_limited AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited'
      AND rarity = 6
      AND item_type = 'character'
      AND six_star_category = 'off_limited'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 5
  ),

  -- 限定池5★角色排名
  limited_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited'
      AND rarity = 5
      AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- ========== 常驻池统计（仅角色）TOP5 ==========
  standard_six_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'standard'
      AND rarity = 6
      AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 5
  ),
  standard_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'standard'
      AND rarity = 5
      AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- ========== 武器池统计（仅武器）==========
  weapon_six_star_up AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'weapon'
      AND rarity = 6
      AND item_type = 'weapon'
      AND six_star_category = 'up'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  weapon_six_star_off AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'weapon'
      AND rarity = 6
      AND item_type = 'weapon'
      AND six_star_category IN ('off_standard', 'off_limited')
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  weapon_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'weapon'
      AND rarity = 5
      AND item_type = 'weapon'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),

  -- ========== 数量统计 ==========
  -- 限定池6★角色数量统计（区分 UP / 歪常驻 / 歪限定 / 免费）
  limited_six_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE is_free = false OR is_free IS NULL) as excluding_free,
      -- UP（当期UP角色）
      COUNT(*) FILTER (WHERE six_star_category = 'up') as up_count,
      -- 歪出总数（含歪常驻+歪限定）
      COUNT(*) FILTER (WHERE six_star_category IN ('off_standard', 'off_limited')) as off_count,
      -- 歪到常驻角色
      COUNT(*) FILTER (WHERE six_star_category = 'off_standard') as off_standard_count,
      -- 歪到非当期限定角色
      COUNT(*) FILTER (WHERE six_star_category = 'off_limited') as off_limited_count,
      -- 不含免费的统计
      COUNT(*) FILTER (WHERE six_star_category = 'up' AND (is_free = false OR is_free IS NULL)) as up_excluding_free,
      COUNT(*) FILTER (WHERE six_star_category IN ('off_standard', 'off_limited') AND (is_free = false OR is_free IS NULL)) as off_excluding_free,
      COUNT(*) FILTER (WHERE six_star_category = 'off_standard' AND (is_free = false OR is_free IS NULL)) as off_standard_excluding_free,
      COUNT(*) FILTER (WHERE six_star_category = 'off_limited' AND (is_free = false OR is_free IS NULL)) as off_limited_excluding_free
    FROM history_classified
    WHERE pool_type = 'limited'
      AND rarity = 6
      AND item_type = 'character'
  ),

  -- 常驻池6★角色数量统计
  standard_six_counts AS (
    SELECT COUNT(*) as total
    FROM history_classified
    WHERE pool_type = 'standard'
      AND rarity = 6
      AND item_type = 'character'
  ),

  -- 武器池6★武器数量统计
  weapon_six_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE six_star_category = 'up') as up_count,
      COUNT(*) FILTER (WHERE six_star_category IN ('off_standard', 'off_limited')) as off_count
    FROM history_classified
    WHERE pool_type = 'weapon'
      AND rarity = 6
      AND item_type = 'weapon'
  )

  SELECT json_build_object(
    'limited', json_build_object(
      'sixStarUp', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_up),
      'sixStarOff', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_off_standard),
      'sixStarOffLimited', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_off_limited),
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_up),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_five_star),
      'sixStarTotal', (SELECT COALESCE(total, 0) FROM limited_six_counts),
      'sixStarExcludingFree', (SELECT COALESCE(excluding_free, 0) FROM limited_six_counts),
      'sixStarUpCount', (SELECT COALESCE(up_count, 0) FROM limited_six_counts),
      'sixStarOffCount', (SELECT COALESCE(off_count, 0) FROM limited_six_counts),
      'sixStarOffStandardCount', (SELECT COALESCE(off_standard_count, 0) FROM limited_six_counts),
      'sixStarOffLimitedCount', (SELECT COALESCE(off_limited_count, 0) FROM limited_six_counts),
      'sixStarUpExcludingFree', (SELECT COALESCE(up_excluding_free, 0) FROM limited_six_counts),
      'sixStarOffExcludingFree', (SELECT COALESCE(off_excluding_free, 0) FROM limited_six_counts),
      'sixStarOffStandardExcludingFree', (SELECT COALESCE(off_standard_excluding_free, 0) FROM limited_six_counts),
      'sixStarOffLimitedExcludingFree', (SELECT COALESCE(off_limited_excluding_free, 0) FROM limited_six_counts)
    ),
    'standard', json_build_object(
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_six_star),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_five_star),
      'sixStarTotal', (SELECT COALESCE(total, 0) FROM standard_six_counts)
    ),
    'weapon', json_build_object(
      'sixStarUp', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_up),
      'sixStarOff', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_off),
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_up),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_five_star),
      'sixStarTotal', (SELECT COALESCE(total, 0) FROM weapon_six_counts),
      'sixStarUpCount', (SELECT COALESCE(up_count, 0) FROM weapon_six_counts),
      'sixStarOffCount', (SELECT COALESCE(off_count, 0) FROM weapon_six_counts)
    )
  ) INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.get_character_ranking_stats() IS 'FEAT-013: 歪出六星分类统计 - 区分歪常驻/歪非当期限定';
GRANT EXECUTE ON FUNCTION public.get_character_ranking_stats() TO anon, authenticated;


-- ==================== 用户个人排名统计函数 ====================
CREATE OR REPLACE FUNCTION public.get_user_ranking_stats(p_user_id uuid)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  WITH
  history_with_info AS (
    SELECT
      h.rarity,
      h.item_name,
      h.is_free,
      h.special_type,
      h.pool_id,
      COALESCE(c.type, 'character') as item_type,
      COALESCE(c.is_limited, false) as char_is_limited,
      -- 直接从 JOIN 获取卡池UP角色
      p.up_character as pool_up_character,
      CASE
        WHEN h.pool_id LIKE 'special_%' THEN 'limited'
        WHEN h.pool_id LIKE 'weapon%' OR h.pool_id LIKE 'wepon%' THEN 'weapon'
        WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
        WHEN p.type IS NOT NULL THEN
          CASE
            WHEN p.type IN ('limited', 'limited_character') THEN 'limited'
            WHEN p.type IN ('weapon', 'limited_weapon') THEN 'weapon'
            ELSE 'standard'
          END
        ELSE 'standard'
      END as pool_type
    FROM public.history h
    LEFT JOIN public.characters c ON c.name = h.item_name
    LEFT JOIN public.pools p ON p.pool_id = h.pool_id
    WHERE h.user_id = p_user_id
      AND h.special_type IS DISTINCT FROM 'gift'
      AND h.item_name IS NOT NULL
      AND h.item_name != ''
  ),

  history_classified AS (
    SELECT *,
      CASE
        WHEN rarity = 6 AND char_is_limited = true THEN
          CASE
            WHEN pool_up_character IS NOT NULL
              AND (
                LOWER(item_name) = LOWER(pool_up_character)
                OR LOWER(item_name) LIKE '%' || LOWER(pool_up_character) || '%'
                OR LOWER(pool_up_character) LIKE '%' || LOWER(item_name) || '%'
              )
            THEN 'up'
            ELSE 'off_limited'
          END
        WHEN rarity = 6 AND char_is_limited = false THEN 'off_standard'
        ELSE 'other'
      END as six_star_category
    FROM history_with_info
  ),

  limited_six_star_up AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited' AND rarity = 6 AND item_type = 'character'
      AND six_star_category = 'up'
    GROUP BY item_name ORDER BY count DESC LIMIT 5
  ),
  limited_six_star_off_standard AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited' AND rarity = 6 AND item_type = 'character'
      AND six_star_category = 'off_standard'
    GROUP BY item_name ORDER BY count DESC LIMIT 5
  ),
  limited_six_star_off_limited AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited' AND rarity = 6 AND item_type = 'character'
      AND six_star_category = 'off_limited'
    GROUP BY item_name ORDER BY count DESC LIMIT 5
  ),
  limited_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited' AND rarity = 5 AND item_type = 'character'
    GROUP BY item_name ORDER BY count DESC LIMIT 3
  ),
  standard_six_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'standard' AND rarity = 6 AND item_type = 'character'
    GROUP BY item_name ORDER BY count DESC LIMIT 5
  ),
  standard_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'standard' AND rarity = 5 AND item_type = 'character'
    GROUP BY item_name ORDER BY count DESC LIMIT 3
  ),
  weapon_six_star_up AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'weapon' AND rarity = 6 AND item_type = 'weapon'
      AND six_star_category = 'up'
    GROUP BY item_name ORDER BY count DESC LIMIT 3
  ),
  weapon_six_star_off AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'weapon' AND rarity = 6 AND item_type = 'weapon'
      AND six_star_category IN ('off_standard', 'off_limited')
    GROUP BY item_name ORDER BY count DESC LIMIT 3
  ),
  weapon_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'weapon' AND rarity = 5 AND item_type = 'weapon'
    GROUP BY item_name ORDER BY count DESC LIMIT 3
  ),

  limited_six_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE six_star_category = 'up') as up_count,
      COUNT(*) FILTER (WHERE six_star_category IN ('off_standard', 'off_limited')) as off_count,
      COUNT(*) FILTER (WHERE six_star_category = 'off_standard') as off_standard_count,
      COUNT(*) FILTER (WHERE six_star_category = 'off_limited') as off_limited_count
    FROM history_classified
    WHERE pool_type = 'limited' AND rarity = 6 AND item_type = 'character'
  ),

  weapon_six_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE six_star_category = 'up') as up_count,
      COUNT(*) FILTER (WHERE six_star_category IN ('off_standard', 'off_limited')) as off_count
    FROM history_classified
    WHERE pool_type = 'weapon' AND rarity = 6 AND item_type = 'weapon'
  )

  SELECT json_build_object(
    'limited', json_build_object(
      'sixStarUp', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_up),
      'sixStarOff', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_off_standard),
      'sixStarOffLimited', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_off_limited),
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_up),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_five_star),
      'sixStarUpCount', (SELECT COALESCE(up_count, 0) FROM limited_six_counts),
      'sixStarOffCount', (SELECT COALESCE(off_count, 0) FROM limited_six_counts),
      'sixStarOffStandardCount', (SELECT COALESCE(off_standard_count, 0) FROM limited_six_counts),
      'sixStarOffLimitedCount', (SELECT COALESCE(off_limited_count, 0) FROM limited_six_counts)
    ),
    'standard', json_build_object(
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_six_star),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_five_star)
    ),
    'weapon', json_build_object(
      'sixStarUp', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_up),
      'sixStarOff', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_off),
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_up),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_five_star),
      'sixStarUpCount', (SELECT COALESCE(up_count, 0) FROM weapon_six_counts),
      'sixStarOffCount', (SELECT COALESCE(off_count, 0) FROM weapon_six_counts)
    )
  ) INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.get_user_ranking_stats(uuid) IS 'FEAT-013: 用户个人排名 - 歪出六星分类统计';
GRANT EXECUTE ON FUNCTION public.get_user_ranking_stats(uuid) TO anon, authenticated;
-- <<< END MIGRATION: archive/058_add_off_banner_breakdown.sql

-- >>> BEGIN MIGRATION: archive/059_fix_pity_data_and_constraint.sql
-- ============================================================
-- Migration 059: 修复 pity 数据并添加约束
-- BUG-FIX-011: 数据库>=81抽出货异常
--
-- 问题: calculatePity() 之前未排除免费十连(is_free=true)，
--       导致数据库中存储了超过80的 pity 值。
--
-- 修复:
--   1. 重算所有记录的 pity 值（排除 is_free=true 的记录）
--   2. 钳制仍然超出范围的值（不完整数据导致的边界情况）
--   3. 添加 CHECK 约束防止未来再次发生
-- ============================================================

DO $$
DECLARE
  rec RECORD;
  current_pity INTEGER := 0;
  prev_user_id UUID := NULL;
  prev_pool_id TEXT := NULL;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'history' AND column_name = 'pity'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'history' AND column_name = 'is_free'
  ) THEN
    RAISE NOTICE 'Migration 059 skipped because history.pity / history.is_free are unavailable';
    RETURN;
  END IF;

  -- 步骤 1~3: 直接在 DO 块中重算 pity
  FOR rec IN
    SELECT user_id, record_id, pool_id, rarity, is_free
    FROM public.history
    ORDER BY user_id, pool_id, timestamp ASC, record_id ASC
  LOOP
    IF rec.user_id IS DISTINCT FROM prev_user_id
       OR rec.pool_id IS DISTINCT FROM prev_pool_id THEN
      current_pity := 0;
      prev_user_id := rec.user_id;
      prev_pool_id := rec.pool_id;
    END IF;

    IF rec.is_free IS NOT TRUE THEN
      current_pity := current_pity + 1;
    END IF;

    UPDATE public.history
    SET pity = current_pity
    WHERE user_id = rec.user_id AND record_id = rec.record_id;

    IF rec.rarity = 6 THEN
      current_pity := 0;
    END IF;
  END LOOP;

  -- 步骤 4: 钳制边界情况
  UPDATE public.history SET pity = 80 WHERE pity > 80;
  UPDATE public.history SET pity = 0 WHERE pity < 0;

  -- 步骤 5: 添加 CHECK 约束
  ALTER TABLE public.history DROP CONSTRAINT IF EXISTS history_pity_check;
  ALTER TABLE public.history ADD CONSTRAINT history_pity_check
    CHECK (pity >= 0 AND pity <= 80);
END $$;
-- <<< END MIGRATION: archive/059_fix_pity_data_and_constraint.sql

-- >>> BEGIN MIGRATION: archive/060_fix_global_stats_exclude_free.sql
-- ============================================================
-- Migration 060: 修复 get_global_stats 函数 (v2)
-- BUG-FIX-011: 全面修复免费十连与赠送记录的统计问题
--
-- 修复内容:
--   A. Section 6 的 COUNT 查询缺少 special_type 过滤
--      sixStarTotal/sixStarLimited/sixStarStandard/fiveStar/fourStar
--      以及 counts.* 只过滤了 is_free 但没有排除 gift，
--      导致赠送6星被双重计数。
--
--   B. Gift 查询使用原始 history 表的 is_standard，
--      而非 CTE 计算的 is_standard_calc，分类可能不准确。
--
--   C. charGift 和 weaponGiftLimited 查询完全相同（复制粘贴错误），
--      缺少卡池类型区分。
--
--   D. 新增 totalPullsWithFree / freePullCount 字段，
--      支持前端同时展示"有效抽数"和"含免费总抽数"。
--
--   E. 所有 ordered_pulls / base_pulls 的 WHERE 子句
--      已包含 AND (is_free IS NOT TRUE) 排除免费十连。
-- ============================================================

CREATE OR REPLACE FUNCTION get_global_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  avg_pity NUMERIC;
  global_distribution JSON;
  limited_stats JSON;
  weapon_stats JSON;
  standard_stats JSON;
BEGIN
  -- ============================================
  -- 核心CTE: 重新计算所有记录的 is_standard
  -- ============================================
  WITH history_with_correct_is_standard AS (
    SELECT
      h.*,
      p.type as pool_type,
      p.up_character,
      CASE
        WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN true
        WHEN h.rarity = 6 AND p.up_character IS NOT NULL THEN
          NOT (
            COALESCE(h.character_name, '') ILIKE '%' || p.up_character || '%' OR
            COALESCE(h.item_name, '') ILIKE '%' || p.up_character || '%' OR
            p.up_character ILIKE '%' || COALESCE(h.character_name, h.item_name, '') || '%'
          )
        ELSE COALESCE(h.is_standard, false)
      END as is_standard_calc
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id
  )

  -- ============================================
  -- 1. 计算全局平均出货
  -- ============================================
  ,ordered_pulls AS (
    SELECT
      pool_id,
      user_id,
      rarity,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM history_with_correct_is_standard
    WHERE special_type IS DISTINCT FROM 'gift'
      AND (is_free IS NOT TRUE)
  ),
  six_stars_with_prev AS (
    SELECT
      pool_id,
      user_id,
      rn,
      -- 钳制: 不完整数据可能导致 pity > 80，限制到合理范围
      LEAST(rn - LAG(rn, 1, 0) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 80) as pity
    FROM ordered_pulls
    WHERE rarity = 6
  )
  SELECT COALESCE(AVG(pity), 0) INTO avg_pity FROM six_stars_with_prev;

  -- ============================================
  -- 2. 计算全局6星出货分布
  -- ============================================
  WITH history_with_correct_is_standard AS (
    SELECT
      h.*,
      p.type as pool_type,
      p.up_character,
      CASE
        WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN true
        WHEN h.rarity = 6 AND p.up_character IS NOT NULL THEN
          NOT (
            COALESCE(h.character_name, '') ILIKE '%' || p.up_character || '%' OR
            COALESCE(h.item_name, '') ILIKE '%' || p.up_character || '%' OR
            p.up_character ILIKE '%' || COALESCE(h.character_name, h.item_name, '') || '%'
          )
        ELSE COALESCE(h.is_standard, false)
      END as is_standard_calc
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id
  ),
  ordered_pulls AS (
    SELECT
      h.pool_id,
      h.user_id,
      h.rarity,
      h.is_standard_calc,
      ROW_NUMBER() OVER (PARTITION BY h.pool_id, h.user_id ORDER BY h.record_id) as rn
    FROM history_with_correct_is_standard h
    WHERE h.special_type IS DISTINCT FROM 'gift'
      AND (h.is_free IS NOT TRUE)
  ),
  six_stars_pity AS (
    SELECT
      is_standard_calc,
      -- 钳制: 不完整数据可能导致 pity > 80
      LEAST(rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0), 80) as pity
    FROM ordered_pulls
    WHERE rarity = 6
  ),
  pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard_calc
    FROM six_stars_pity
  ),
  grouped_ranges AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard_calc THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard_calc THEN 1 ELSE 0 END) as standard_count
    FROM pity_ranges
    GROUP BY range_label
  )
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'range', REPLACE(range_label, '01-10', '1-10'),
        'limited', limited_count,
        'standard', standard_count
      ) ORDER BY range_label
    ),
    '[]'::json
  ) INTO global_distribution FROM grouped_ranges;

  -- ============================================
  -- 3. 计算限定池统计
  -- ============================================
  WITH history_with_correct_is_standard AS (
    SELECT
      h.*,
      p.type as pool_type,
      p.up_character,
      CASE
        WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN true
        WHEN h.rarity = 6 AND p.up_character IS NOT NULL THEN
          NOT (
            COALESCE(h.character_name, '') ILIKE '%' || p.up_character || '%' OR
            COALESCE(h.item_name, '') ILIKE '%' || p.up_character || '%' OR
            p.up_character ILIKE '%' || COALESCE(h.character_name, h.item_name, '') || '%'
          )
        ELSE COALESCE(h.is_standard, false)
      END as is_standard_calc
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id
  ),
  base_pulls AS (
    SELECT
      h.*,
      COALESCE(
        CASE
          WHEN h.pool_type IN ('limited', 'limited_character') THEN 'limited'
          WHEN h.pool_type IN ('weapon', 'limited_weapon') THEN 'weapon'
          WHEN h.pool_type IN ('standard', 'beginner') THEN 'standard'
          ELSE NULL
        END,
        CASE
          WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
          WHEN split_part(h.pool_id, '_', 1) = 'special' THEN 'limited'
          WHEN split_part(h.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
          WHEN h.is_standard_calc = true THEN 'standard'
          ELSE 'limited'
        END
      ) AS classified_pool_type
    FROM history_with_correct_is_standard h
    WHERE h.special_type IS DISTINCT FROM 'gift'
      AND (h.is_free IS NOT TRUE)
  ),
  limited_pulls AS (
    SELECT * FROM base_pulls WHERE classified_pool_type = 'limited'
  ),
  limited_ordered AS (
    SELECT pool_id, user_id, rarity, is_standard_calc,
           ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM limited_pulls
  ),
  limited_six_pity AS (
    SELECT pool_id, user_id, is_standard_calc, rn,
           -- 钳制: 不完整数据可能导致 pity > 80
           LEAST(rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0), 80) as pity,
           -- Spark(井)检测: 限定池 + UP角色 + 恰好第120抽 + 之前无UP出货
           CASE
             WHEN is_standard_calc = false AND rn = 120
               AND MIN(CASE WHEN is_standard_calc = false THEN rn ELSE 999999 END)
                   OVER (PARTITION BY pool_id, user_id) = 120
             THEN true ELSE false
           END as is_spark
    FROM limited_ordered
    WHERE rarity = 6
  ),
  limited_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard_calc
    FROM limited_six_pity
  ),
  limited_grouped AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard_calc THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard_calc THEN 1 ELSE 0 END) as standard_count
    FROM limited_pity_ranges
    GROUP BY range_label
  )
  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM limited_pulls), 0),
    'six', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard_calc = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard_calc = true), 0),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM limited_six_pity), 1), 0),
    'avgPityUp', COALESCE(ROUND((SELECT AVG(pity) FROM limited_six_pity WHERE is_standard_calc = false AND NOT is_spark), 1), 0),
    'sparkCount', COALESCE((SELECT COUNT(DISTINCT user_id) FROM limited_six_pity WHERE is_spark = true), 0),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard_calc = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 6 AND is_standard_calc = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM limited_pulls WHERE rarity <= 4), 0)
    ),
    'distribution', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        ) ORDER BY range_label
      ) FROM limited_grouped),
      '[]'::json
    )
  ) INTO limited_stats;

  -- ============================================
  -- 4. 计算武器池统计
  -- ============================================
  WITH history_with_correct_is_standard AS (
    SELECT
      h.*,
      p.type as pool_type,
      p.up_character,
      CASE
        WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN true
        WHEN h.rarity = 6 AND p.up_character IS NOT NULL THEN
          NOT (
            COALESCE(h.character_name, '') ILIKE '%' || p.up_character || '%' OR
            COALESCE(h.item_name, '') ILIKE '%' || p.up_character || '%' OR
            p.up_character ILIKE '%' || COALESCE(h.character_name, h.item_name, '') || '%'
          )
        ELSE COALESCE(h.is_standard, false)
      END as is_standard_calc
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id
  ),
  base_pulls AS (
    SELECT
      h.*,
      COALESCE(
        CASE
          WHEN h.pool_type IN ('limited', 'limited_character') THEN 'limited'
          WHEN h.pool_type IN ('weapon', 'limited_weapon') THEN 'weapon'
          WHEN h.pool_type IN ('standard', 'beginner') THEN 'standard'
          ELSE NULL
        END,
        CASE
          WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
          WHEN split_part(h.pool_id, '_', 1) = 'special' THEN 'limited'
          WHEN split_part(h.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
          WHEN h.is_standard_calc = true THEN 'standard'
          ELSE 'limited'
        END
      ) AS classified_pool_type
    FROM history_with_correct_is_standard h
    WHERE h.special_type IS DISTINCT FROM 'gift'
      AND (h.is_free IS NOT TRUE)
  ),
  weapon_pulls AS (
    SELECT * FROM base_pulls WHERE classified_pool_type = 'weapon'
  ),
  weapon_ordered AS (
    SELECT pool_id, user_id, rarity, is_standard_calc,
           ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM weapon_pulls
  ),
  weapon_six_pity AS (
    SELECT pool_id, user_id, is_standard_calc,
           -- 钳制: 不完整数据可能导致 pity > 80
           LEAST(rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0), 80) as pity
    FROM weapon_ordered
    WHERE rarity = 6
  ),
  weapon_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label,
      is_standard_calc
    FROM weapon_six_pity
  ),
  weapon_grouped AS (
    SELECT
      range_label,
      SUM(CASE WHEN NOT is_standard_calc THEN 1 ELSE 0 END) as limited_count,
      SUM(CASE WHEN is_standard_calc THEN 1 ELSE 0 END) as standard_count
    FROM weapon_pity_ranges
    GROUP BY range_label
  )
  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM weapon_pulls), 0),
    'six', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard_calc = false), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard_calc = true), 0),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM weapon_six_pity), 1), 0),
    'avgPityUp', COALESCE(ROUND((SELECT AVG(pity) FROM weapon_six_pity WHERE is_standard_calc = false), 1), 0),
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard_calc = false), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 6 AND is_standard_calc = true), 0),
      '5', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM weapon_pulls WHERE rarity <= 4), 0)
    ),
    'distribution', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        ) ORDER BY range_label
      ) FROM weapon_grouped),
      '[]'::json
    )
  ) INTO weapon_stats;

  -- ============================================
  -- 5. 计算常驻池统计
  -- ============================================
  WITH history_with_correct_is_standard AS (
    SELECT
      h.*,
      p.type as pool_type,
      p.up_character,
      CASE
        WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN true
        WHEN h.rarity = 6 AND p.up_character IS NOT NULL THEN
          NOT (
            COALESCE(h.character_name, '') ILIKE '%' || p.up_character || '%' OR
            COALESCE(h.item_name, '') ILIKE '%' || p.up_character || '%' OR
            p.up_character ILIKE '%' || COALESCE(h.character_name, h.item_name, '') || '%'
          )
        ELSE COALESCE(h.is_standard, false)
      END as is_standard_calc
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id
  ),
  base_pulls AS (
    SELECT
      h.*,
      COALESCE(
        CASE
          WHEN h.pool_type IN ('limited', 'limited_character') THEN 'limited'
          WHEN h.pool_type IN ('weapon', 'limited_weapon') THEN 'weapon'
          WHEN h.pool_type IN ('standard', 'beginner') THEN 'standard'
          ELSE NULL
        END,
        CASE
          WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
          WHEN split_part(h.pool_id, '_', 1) = 'special' THEN 'limited'
          WHEN split_part(h.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
          WHEN h.is_standard_calc = true THEN 'standard'
          ELSE 'limited'
        END
      ) AS classified_pool_type
    FROM history_with_correct_is_standard h
    WHERE h.special_type IS DISTINCT FROM 'gift'
      AND (h.is_free IS NOT TRUE)
  ),
  standard_pulls AS (
    SELECT * FROM base_pulls WHERE classified_pool_type = 'standard'
  ),
  standard_ordered AS (
    SELECT pool_id, user_id, rarity,
           ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) as rn
    FROM standard_pulls
  ),
  standard_six_pity AS (
    SELECT pool_id, user_id,
           -- 钳制: 不完整数据可能导致 pity > 80
           LEAST(rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0), 80) as pity
    FROM standard_ordered
    WHERE rarity = 6
  ),
  standard_pity_ranges AS (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END as range_label
    FROM standard_six_pity
  ),
  standard_grouped AS (
    SELECT
      range_label,
      0 as limited_count,
      COUNT(*) as standard_count
    FROM standard_pity_ranges
    GROUP BY range_label
  )
  SELECT json_build_object(
    'total', COALESCE((SELECT COUNT(*) FROM standard_pulls), 0),
    'six', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6), 0),
    'sixStarLimited', 0,
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6), 0),
    'avgPity', COALESCE(ROUND((SELECT AVG(pity) FROM standard_six_pity), 1), 0),
    'counts', json_build_object(
      '6', 0,
      '6_std', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 6), 0),
      '5', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity = 5), 0),
      '4', COALESCE((SELECT COUNT(*) FROM standard_pulls WHERE rarity <= 4), 0)
    ),
    'distribution', COALESCE(
      (SELECT json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        ) ORDER BY range_label
      ) FROM standard_grouped),
      '[]'::json
    )
  ) INTO standard_stats;

  -- ============================================
  -- 6. 组装最终结果
  --    修复: 所有 COUNT 同时排除 gift 和 is_free
  --    修复: Gift 查询使用 CTE + is_standard_calc + 卡池类型
  --    新增: totalPullsWithFree / freePullCount
  -- ============================================
  WITH history_enriched AS (
    SELECT
      h.*,
      p.type as pool_type,
      p.up_character,
      CASE
        WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN true
        WHEN h.rarity = 6 AND p.up_character IS NOT NULL THEN
          NOT (
            COALESCE(h.character_name, '') ILIKE '%' || p.up_character || '%' OR
            COALESCE(h.item_name, '') ILIKE '%' || p.up_character || '%' OR
            p.up_character ILIKE '%' || COALESCE(h.character_name, h.item_name, '') || '%'
          )
        ELSE COALESCE(h.is_standard, false)
      END as is_standard_calc,
      -- 卡池类型分类（用于 gift 查询区分角色池/武器池）
      COALESCE(
        CASE
          WHEN p.type IN ('limited', 'limited_character') THEN 'limited'
          WHEN p.type IN ('weapon', 'limited_weapon') THEN 'weapon'
          WHEN p.type IN ('standard', 'beginner') THEN 'standard'
          ELSE NULL
        END,
        CASE
          WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
          WHEN split_part(h.pool_id, '_', 1) = 'special' THEN 'limited'
          WHEN split_part(h.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
          ELSE 'limited'
        END
      ) AS classified_pool_type
    FROM history h
    LEFT JOIN pools p ON h.pool_id = p.pool_id
  )
  SELECT json_build_object(
    -- === 有效抽数（排除 gift + free）===
    'totalPulls', COALESCE((SELECT COUNT(*) FROM history_enriched
      WHERE special_type IS DISTINCT FROM 'gift' AND (is_free IS NOT TRUE)), 0),

    -- === 含免费总抽数（排除 gift，包含 free）===
    'totalPullsWithFree', COALESCE((SELECT COUNT(*) FROM history_enriched
      WHERE special_type IS DISTINCT FROM 'gift'), 0),

    -- === 免费抽数 ===
    'freePullCount', COALESCE((SELECT COUNT(*) FROM history_enriched
      WHERE special_type IS DISTINCT FROM 'gift' AND is_free = true), 0),

    'totalUsers', COALESCE((SELECT COUNT(*) FROM profiles), 0),
    'totalContributors', COALESCE((SELECT COUNT(DISTINCT user_id) FROM history WHERE special_type IS DISTINCT FROM 'gift' AND (is_free IS NOT TRUE)), 0),

    -- === 6星（排除 gift + free）===
    'sixStarTotal', COALESCE((SELECT COUNT(*) FROM history_enriched
      WHERE rarity = 6 AND special_type IS DISTINCT FROM 'gift' AND (is_free IS NOT TRUE)), 0),
    'sixStarLimited', COALESCE((SELECT COUNT(*) FROM history_enriched
      WHERE rarity = 6 AND is_standard_calc = false AND special_type IS DISTINCT FROM 'gift' AND (is_free IS NOT TRUE)), 0),
    'sixStarStandard', COALESCE((SELECT COUNT(*) FROM history_enriched
      WHERE rarity = 6 AND is_standard_calc = true AND special_type IS DISTINCT FROM 'gift' AND (is_free IS NOT TRUE)), 0),

    -- === 5星/4星（排除 gift + free）===
    'fiveStar', COALESCE((SELECT COUNT(*) FROM history_enriched
      WHERE rarity = 5 AND special_type IS DISTINCT FROM 'gift' AND (is_free IS NOT TRUE)), 0),
    'fourStar', COALESCE((SELECT COUNT(*) FROM history_enriched
      WHERE rarity <= 4 AND special_type IS DISTINCT FROM 'gift' AND (is_free IS NOT TRUE)), 0),

    'avgPity', ROUND(avg_pity, 1),

    -- === counts 对象（排除 gift + free）===
    'counts', json_build_object(
      '6', COALESCE((SELECT COUNT(*) FROM history_enriched
        WHERE rarity = 6 AND is_standard_calc = false AND special_type IS DISTINCT FROM 'gift' AND (is_free IS NOT TRUE)), 0),
      '6_std', COALESCE((SELECT COUNT(*) FROM history_enriched
        WHERE rarity = 6 AND is_standard_calc = true AND special_type IS DISTINCT FROM 'gift' AND (is_free IS NOT TRUE)), 0),
      '5', COALESCE((SELECT COUNT(*) FROM history_enriched
        WHERE rarity = 5 AND special_type IS DISTINCT FROM 'gift' AND (is_free IS NOT TRUE)), 0),
      '4', COALESCE((SELECT COUNT(*) FROM history_enriched
        WHERE rarity <= 4 AND special_type IS DISTINCT FROM 'gift' AND (is_free IS NOT TRUE)), 0)
    ),

    'distribution', global_distribution,
    'byType', json_build_object(
      'limited', limited_stats,
      'weapon', weapon_stats,
      'standard', standard_stats
    ),

    -- === 赠送统计（使用 CTE + is_standard_calc + 卡池类型区分）===
    -- 角色池(限定)赠送6星
    'charGift', COALESCE((SELECT COUNT(*) FROM history_enriched
      WHERE special_type = 'gift' AND rarity = 6 AND classified_pool_type = 'limited'), 0),
    -- 武器池赠送限定6星
    'weaponGiftLimited', COALESCE((SELECT COUNT(*) FROM history_enriched
      WHERE special_type = 'gift' AND rarity = 6 AND classified_pool_type = 'weapon' AND is_standard_calc = false), 0),
    -- 武器池赠送常驻6星
    'weaponGiftStandard', COALESCE((SELECT COUNT(*) FROM history_enriched
      WHERE special_type = 'gift' AND rarity = 6 AND classified_pool_type = 'weapon' AND is_standard_calc = true), 0),
    -- 赠送总数
    'giftTotal', COALESCE((SELECT COUNT(*) FROM history_enriched
      WHERE special_type = 'gift'), 0)
  ) INTO result;

  RETURN result;
END;
$$;

-- 授权
GRANT EXECUTE ON FUNCTION get_global_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION get_global_stats() TO anon;
-- <<< END MIGRATION: archive/060_fix_global_stats_exclude_free.sql

-- >>> BEGIN MIGRATION: archive/061_fix_history_select_rls.sql
-- ============================================
-- DR-S01: 修复 history 表 SELECT 策略
--
-- 问题: history 表 FOR SELECT USING (true) 导致任何人可查询所有用户的抽卡记录
-- 修复: 普通用户只能查看自己的数据，超管可查看所有数据
-- 注意: get_global_stats() 使用 SECURITY DEFINER，不受 RLS 影响
--
-- 执行日期: 2026-02-24
-- ============================================

-- 1. 删除所有旧的 SELECT 策略
DROP POLICY IF EXISTS "history_select_policy" ON public.history;
DROP POLICY IF EXISTS "All users can view all history" ON public.history;
DROP POLICY IF EXISTS "history_select_all" ON public.history;

-- 2. 创建新的 SELECT 策略：用户只能查看自己的数据，超管可查看所有
CREATE POLICY "history_select_own_or_admin" ON public.history
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- ============================================
-- 执行后的效果：
-- 1. ✅ 普通用户只能查询自己的抽卡记录
-- 2. ✅ 超管可查询所有用户的记录（管理面板功能）
-- 3. ✅ get_global_stats() 不受影响（SECURITY DEFINER 绕过 RLS）
-- 4. ✅ game_uid 等敏感字段不再暴露给其他用户
-- ============================================
-- <<< END MIGRATION: archive/061_fix_history_select_rls.sql

-- >>> BEGIN MIGRATION: archive/062_site_config.sql
-- 062: 站点配置表
-- 将硬编码的备案号、作者信息等从代码迁移到数据库，支持管理面板编辑

CREATE TABLE IF NOT EXISTS public.site_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

-- RLS: 所有人可读，仅超管可写
ALTER TABLE public.site_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_config_select_all" ON public.site_config
  FOR SELECT USING (true);

CREATE POLICY "site_config_admin_write" ON public.site_config
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- 预置数据（占位值，部署后通过管理面板配置实际内容）
INSERT INTO public.site_config (key, value, label, category) VALUES
  ('site_version', 'v0.0.0', '站点版本', 'general'),
  ('build_info', '', '构建信息', 'general'),
  ('icp_number', '', 'ICP备案号', 'legal'),
  ('icp_url', 'https://beian.miit.gov.cn/', 'ICP备案链接', 'legal'),
  ('police_number', '', '公安备案号', 'legal'),
  ('police_url', 'https://www.beian.gov.cn/', '公安备案链接', 'legal'),
  ('author_name', '', '作者名', 'social'),
  ('author_bilibili', '', 'Bilibili主页', 'social'),
  ('github_url', '', 'GitHub仓库', 'social')
ON CONFLICT (key) DO NOTHING;
-- <<< END MIGRATION: archive/062_site_config.sql

-- >>> BEGIN MIGRATION: archive/063_fix_pools_rls_policy.sql
-- ============================================
-- 迁移 063: 修复卡池 RLS 策略
-- ============================================
-- 问题: 048 迁移将 pools 表改为全局共享 (移除 user_id 主键)
--       但 021 迁移的 RLS 策略未同步更新 (仍要求 auth.uid() = user_id)
--       导致管理员无法编辑非自己创建的卡池
--
-- 修复: 允许管理员和超管编辑全局共享卡池
-- 日期: 2026-02-24
-- ============================================

-- 删除旧的 UPDATE 策略 (来自 021 迁移)
DROP POLICY IF EXISTS "pools_update_policy" ON public.pools;

-- 创建新的 UPDATE 策略: 允许管理员和超管编辑所有卡池
CREATE POLICY "pools_update_policy" ON public.pools
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
  );

-- 同时检查并修复其他可能过时的策略

-- 删除旧的 INSERT 策略 (如果存在)
DROP POLICY IF EXISTS "pools_insert_policy" ON public.pools;

-- 创建新的 INSERT 策略: 允许管理员和超管创建卡池
CREATE POLICY "pools_insert_policy" ON public.pools
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
  );

-- 删除旧的 DELETE 策略 (如果存在)
DROP POLICY IF EXISTS "pools_delete_policy" ON public.pools;

-- 创建新的 DELETE 策略: 仅允许超管删除卡池
CREATE POLICY "pools_delete_policy" ON public.pools
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'super_admin'
    )
  );

-- 验证 SELECT 策略是否正确 (应该允许所有人查看)
-- 如果不存在，则创建
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pools'
      AND policyname = 'pools_select_policy'
  ) THEN
    CREATE POLICY "pools_select_policy" ON public.pools
      FOR SELECT
      USING (true);
  END IF;
END $$;

-- 添加注释说明策略变更
COMMENT ON POLICY "pools_update_policy" ON public.pools IS
  '允许管理员和超管编辑所有卡池 (适配 048 迁移的全局共享架构)';

COMMENT ON POLICY "pools_insert_policy" ON public.pools IS
  '允许管理员和超管创建卡池';

COMMENT ON POLICY "pools_delete_policy" ON public.pools IS
  '仅允许超管删除卡池';
-- <<< END MIGRATION: archive/063_fix_pools_rls_policy.sql

-- >>> BEGIN MIGRATION: archive/064_create_puzzles_table.sql
-- 拼图题库表（共享题库 + 未来验证码题目来源）
CREATE TABLE IF NOT EXISTS public.puzzles (
  id SERIAL PRIMARY KEY,
  author TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL,
  piece_count SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  solve_count INT NOT NULL DEFAULT 0
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_puzzles_created_at ON public.puzzles (created_at DESC);

-- RLS
ALTER TABLE public.puzzles ENABLE ROW LEVEL SECURITY;

-- 所有人可读
CREATE POLICY "puzzles_select_all" ON public.puzzles
  FOR SELECT USING (true);

-- 所有人可插入
CREATE POLICY "puzzles_insert_all" ON public.puzzles
  FOR INSERT WITH CHECK (true);

-- 禁止直接 UPDATE/DELETE（通过 RPC 更新 solve_count）

-- 解题计数 RPC（SECURITY DEFINER 绕过 RLS）
CREATE OR REPLACE FUNCTION public.increment_puzzle_solve(puzzle_id INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.puzzles
  SET solve_count = solve_count + 1
  WHERE id = puzzle_id;
END;
$$;
-- <<< END MIGRATION: archive/064_create_puzzles_table.sql

-- >>> BEGIN MIGRATION: archive/065_puzzles_auth_difficulty.sql
-- 拼图系统：登录 + 审核 + 难度
-- 为 puzzles 表增加 difficulty、status、uploader_id 列
-- 替换 RLS 策略，增加审核 RPC

-- ═══ 1. 新增列 ═══
ALTER TABLE public.puzzles
  ADD COLUMN IF NOT EXISTS difficulty SMALLINT NOT NULL DEFAULT 2
    CHECK (difficulty IN (1, 2, 3)),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS uploader_id UUID REFERENCES auth.users(id)
    ON DELETE SET NULL;

-- ═══ 2. 索引 ═══
CREATE INDEX IF NOT EXISTS idx_puzzles_status ON public.puzzles (status);
CREATE INDEX IF NOT EXISTS idx_puzzles_difficulty ON public.puzzles (difficulty);

-- ═══ 3. 替换 RLS 策略 ═══

-- 删除旧策略
DROP POLICY IF EXISTS "puzzles_select_all" ON public.puzzles;
DROP POLICY IF EXISTS "puzzles_insert_all" ON public.puzzles;

-- SELECT: 已通过→所有人 | 上传者→自己的题 | 管理员→所有
CREATE POLICY "puzzles_select_v2" ON public.puzzles
  FOR SELECT USING (
    status = 'approved'
    OR (auth.uid() IS NOT NULL AND auth.uid() = uploader_id)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
  );

-- INSERT: 须登录，须为自己，须为 pending
CREATE POLICY "puzzles_insert_v2" ON public.puzzles
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND uploader_id = auth.uid()
    AND status = 'pending'
  );

-- UPDATE: 仅管理员（审核用）
CREATE POLICY "puzzles_update_admin" ON public.puzzles
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
  );

-- ═══ 4. 审核 RPC ═══
CREATE OR REPLACE FUNCTION public.review_puzzle(puzzle_id INT, new_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF new_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid status: %', new_status;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE public.puzzles SET status = new_status WHERE id = puzzle_id;
END;
$$;
-- <<< END MIGRATION: archive/065_puzzles_auth_difficulty.sql

-- >>> BEGIN MIGRATION: archive/066_puzzle_uploader_edit.sql
-- 允许上传者修改自己题目的难度（通过 SECURITY DEFINER RPC，绕过只允许管理员 UPDATE 的 RLS）
CREATE OR REPLACE FUNCTION public.update_puzzle_difficulty(puzzle_id INT, new_difficulty SMALLINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF new_difficulty NOT IN (1, 2, 3) THEN
    RAISE EXCEPTION 'Invalid difficulty: %', new_difficulty;
  END IF;
  -- 须为上传者本人或管理员
  IF NOT EXISTS (
    SELECT 1 FROM public.puzzles WHERE id = puzzle_id AND (
      uploader_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
    )
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE public.puzzles SET difficulty = new_difficulty WHERE id = puzzle_id;
END;
$$;
-- <<< END MIGRATION: archive/066_puzzle_uploader_edit.sql

-- >>> BEGIN MIGRATION: archive/067_delete_puzzle_rpc.sql
-- 允许上传者或管理员删除题目（SECURITY DEFINER 绕过 RLS）
-- 拒绝审核时也调用此函数，直接从数据库删除，不保留 rejected 状态
CREATE OR REPLACE FUNCTION public.delete_puzzle(puzzle_id INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 须为上传者本人或管理员
  IF NOT EXISTS (
    SELECT 1 FROM public.puzzles WHERE id = puzzle_id AND (
      uploader_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
    )
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  DELETE FROM public.puzzles WHERE id = puzzle_id;
END;
$$;
-- <<< END MIGRATION: archive/067_delete_puzzle_rpc.sql

-- >>> BEGIN MIGRATION: archive/068_security_harden_profiles_and_pool_characters.sql
-- ============================================
-- 068: 安全加固 - profiles / pool_characters
-- 修复:
--   1. profiles.role 自提权风险
--   2. profiles 私有字段公开暴露
--   3. pool_characters 过宽写权限
-- ============================================

-- ---------- profiles: 公开字段改为受限视图 ----------

DROP VIEW IF EXISTS public.public_profiles;

CREATE VIEW public.public_profiles AS
SELECT
  id,
  username,
  role
FROM public.profiles;

GRANT SELECT ON public.public_profiles TO anon, authenticated;

COMMENT ON VIEW public.public_profiles IS
  '对外公开的用户简档视图，仅暴露 id / username / role，不暴露 email / last_seen_at 等私有字段';

-- ---------- profiles: 重建策略 ----------

DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
DROP POLICY IF EXISTS "Enable update for super_admin" ON public.profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.profiles;

-- 仅自己或超管可读取完整 profiles
CREATE POLICY "profiles_select_self_or_super_admin" ON public.profiles
  FOR SELECT
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );

-- 用户只能插入自己的 profile，且角色必须是 user
CREATE POLICY "profiles_insert_self_user_only" ON public.profiles
  FOR INSERT
  WITH CHECK (
    id = auth.uid()
    AND role = 'user'
  );

-- 用户可以更新自己的 profile，但不能借此修改 role / email
CREATE POLICY "profiles_update_self_without_role_change" ON public.profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role IS NOT DISTINCT FROM (
      SELECT p.role
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
    )
    AND email IS NOT DISTINCT FROM (
      SELECT p.email
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
    )
  );

-- 超管可更新任何 profile（含角色调整）
CREATE POLICY "profiles_update_super_admin" ON public.profiles
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  )
  WITH CHECK (role IN ('user', 'admin', 'super_admin'));

COMMENT ON POLICY "profiles_select_self_or_super_admin" ON public.profiles IS
  '仅允许本人或超管读取完整 profile；公开展示请改走 public_profiles 视图';

COMMENT ON POLICY "profiles_update_self_without_role_change" ON public.profiles IS
  '允许用户更新自己的 profile，但禁止通过直接 update 修改 role / email';

COMMENT ON POLICY "profiles_update_super_admin" ON public.profiles IS
  '仅超管可以更新任意 profile 并调整角色';

-- ---------- profiles: 角色更新统一走 RPC ----------

CREATE OR REPLACE FUNCTION public.admin_update_profile(
  p_target_user_id UUID,
  p_username TEXT DEFAULT NULL,
  p_role TEXT DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated public.profiles;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Only super_admin can update profiles'
      USING ERRCODE = '42501';
  END IF;

  IF p_role IS NOT NULL AND p_role NOT IN ('user', 'admin') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET
    username = COALESCE(NULLIF(BTRIM(p_username), ''), username),
    role = COALESCE(p_role, role),
    updated_at = NOW()
  WHERE id = p_target_user_id
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found: %', p_target_user_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_profile(UUID, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.admin_update_profile(UUID, TEXT, TEXT) IS
  '超管更新用户 profile 的受控入口，禁止浏览器直接修改 role';

-- ---------- pool_characters: 收紧写权限 ----------

DROP POLICY IF EXISTS "pool_characters_insert_policy" ON public.pool_characters;
DROP POLICY IF EXISTS "pool_characters_update_policy" ON public.pool_characters;
DROP POLICY IF EXISTS "pool_characters_delete_policy" ON public.pool_characters;

CREATE POLICY "pool_characters_insert_admin_only" ON public.pool_characters
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "pool_characters_update_admin_only" ON public.pool_characters
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "pool_characters_delete_admin_only" ON public.pool_characters
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
  );

COMMENT ON POLICY "pool_characters_insert_admin_only" ON public.pool_characters IS
  '仅管理员和超管可新增池子角色映射';

COMMENT ON POLICY "pool_characters_update_admin_only" ON public.pool_characters IS
  '仅管理员和超管可编辑池子角色映射';

COMMENT ON POLICY "pool_characters_delete_admin_only" ON public.pool_characters IS
  '仅管理员和超管可删除池子角色映射';
-- <<< END MIGRATION: archive/068_security_harden_profiles_and_pool_characters.sql

-- >>> BEGIN MIGRATION: archive/069_fix_profiles_rls_recursion.sql
-- ============================================
-- 069: 修复 profiles RLS 递归
--
-- 问题:
--   068 在 profiles 自身策略里再次 SELECT public.profiles，
--   导致 PostgreSQL 检测到 policy recursion：
--   infinite recursion detected in policy for relation "profiles"
--
-- 影响:
--   1. profiles 自身查询 500
--   2. 任何在 RLS 中依赖 profiles 进行角色判断的表也会连带 500
--      包括 characters / announcements / site_config / history / tickets 等
--
-- 修复:
--   将策略里的角色/邮箱读取改为 SECURITY DEFINER helper functions，
--   避免在 profiles policy 内部再次触发 profiles 的 RLS 计算。
-- ============================================

-- ---------- helper functions ----------

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_profile_email()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT email
  FROM public.profiles
  WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_profile_role() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_profile_email() TO anon, authenticated;

COMMENT ON FUNCTION public.is_super_admin() IS
  '安全判断当前登录用户是否为 super_admin，供 RLS 使用，避免 profiles 策略递归';

COMMENT ON FUNCTION public.current_profile_role() IS
  '安全读取当前登录用户在 profiles 中的角色，供 RLS 使用，避免 profiles 策略递归';

COMMENT ON FUNCTION public.current_profile_email() IS
  '安全读取当前登录用户在 profiles 中的邮箱，供 RLS 使用，避免 profiles 策略递归';

-- ---------- rebuild profiles policies ----------

DROP POLICY IF EXISTS "profiles_select_self_or_super_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_self_without_role_change" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_super_admin" ON public.profiles;

CREATE POLICY "profiles_select_self_or_super_admin" ON public.profiles
  FOR SELECT
  USING (
    id = auth.uid()
    OR public.is_super_admin()
  );

CREATE POLICY "profiles_update_self_without_role_change" ON public.profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role IS NOT DISTINCT FROM public.current_profile_role()
    AND email IS NOT DISTINCT FROM public.current_profile_email()
  );

CREATE POLICY "profiles_update_super_admin" ON public.profiles
  FOR UPDATE
  USING (public.is_super_admin())
  WITH CHECK (role IN ('user', 'admin', 'super_admin'));

COMMENT ON POLICY "profiles_select_self_or_super_admin" ON public.profiles IS
  '仅允许本人或超管读取完整 profile；通过 helper function 避免 RLS 递归';

COMMENT ON POLICY "profiles_update_self_without_role_change" ON public.profiles IS
  '允许用户更新自己的 profile，但禁止通过直接 update 修改 role / email；通过 helper function 避免 RLS 递归';

COMMENT ON POLICY "profiles_update_super_admin" ON public.profiles IS
  '仅超管可以更新任意 profile 并调整角色；通过 helper function 避免 RLS 递归';
-- <<< END MIGRATION: archive/069_fix_profiles_rls_recursion.sql

-- >>> BEGIN MIGRATION: archive/070_fix_get_global_stats_timeout_after_rls.sql
-- ============================================
-- 070: 修复 get_global_stats 在 RLS 加固后的超时
--
-- 问题:
--   1. 061 将 history SELECT 策略改为每次读取都查询 profiles 判断 super_admin
--   2. 060 的 get_global_stats() 会重复多次扫描 history + pools
--   3. 在生产数据量下，RPC /rest/v1/rpc/get_global_stats 开始出现 8s+ 的 500
--
-- 修复:
--   1. history SELECT 策略改为直接调用 is_super_admin() helper
--   2. 为统计路径补充关键索引
--   3. 重写 get_global_stats()，用 MATERIALIZED CTE 共享一次 history/pools enrich 结果
-- ============================================

-- ---------- history: 降低 RLS 判断开销 ----------

DROP POLICY IF EXISTS "history_select_own_or_admin" ON public.history;

CREATE POLICY "history_select_own_or_admin" ON public.history
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR (SELECT public.is_super_admin())
  );

COMMENT ON POLICY "history_select_own_or_admin" ON public.history IS
  '仅允许用户查看自己的 history，super_admin 可查看全部；使用 helper function 降低 RLS 成本';

-- ---------- stats: 补充执行路径索引 ----------

CREATE INDEX IF NOT EXISTS idx_history_pool_user_record
  ON public.history (pool_id, user_id, record_id);

CREATE INDEX IF NOT EXISTS idx_history_valid_pool_user_record
  ON public.history (pool_id, user_id, record_id)
  WHERE special_type IS DISTINCT FROM 'gift'
    AND (is_free IS NOT TRUE);

CREATE INDEX IF NOT EXISTS idx_history_gift_pool_rarity_standard
  ON public.history (pool_id, rarity, is_standard)
  WHERE special_type = 'gift';

-- ---------- stats: 单次数据管线重写 RPC ----------

CREATE OR REPLACE FUNCTION public.get_global_stats()
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH history_base AS MATERIALIZED (
  SELECT
    h.*,
    p.type AS pool_type,
    p.up_character,
    CASE
      WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN true
      WHEN h.rarity = 6 AND p.up_character IS NOT NULL THEN
        NOT (
          COALESCE(h.character_name, '') ILIKE '%' || p.up_character || '%'
          OR COALESCE(h.item_name, '') ILIKE '%' || p.up_character || '%'
          OR p.up_character ILIKE '%' || COALESCE(h.character_name, h.item_name, '') || '%'
        )
      ELSE COALESCE(h.is_standard, false)
    END AS is_standard_calc
  FROM public.history AS h
  LEFT JOIN public.pools AS p ON p.pool_id = h.pool_id
),
history_enriched AS MATERIALIZED (
  SELECT
    hb.*,
    COALESCE(
      CASE
        WHEN hb.pool_type IN ('limited', 'limited_character') THEN 'limited'
        WHEN hb.pool_type IN ('weapon', 'limited_weapon') THEN 'weapon'
        WHEN hb.pool_type IN ('standard', 'beginner') THEN 'standard'
        ELSE NULL
      END,
      CASE
        WHEN hb.pool_id IN ('standard', 'beginner') THEN 'standard'
        WHEN split_part(hb.pool_id, '_', 1) = 'special' THEN 'limited'
        WHEN split_part(hb.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
        WHEN hb.is_standard_calc = true THEN 'standard'
        ELSE 'limited'
      END
    ) AS classified_pool_type
  FROM history_base AS hb
),
valid_pulls AS MATERIALIZED (
  SELECT *
  FROM history_enriched
  WHERE special_type IS DISTINCT FROM 'gift'
    AND (is_free IS NOT TRUE)
),
ordered_valid AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    rarity,
    is_standard_calc,
    classified_pool_type,
    record_id,
    ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) AS rn
  FROM valid_pulls
),
six_pity AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    rarity,
    is_standard_calc,
    classified_pool_type,
    rn,
    LEAST(
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0),
      80
    ) AS pity
  FROM ordered_valid
  WHERE rarity = 6
),
limited_six_pity AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    is_standard_calc,
    rn,
    pity,
    CASE
      WHEN is_standard_calc = false
        AND rn = 120
        AND MIN(
          CASE
            WHEN is_standard_calc = false THEN rn
            ELSE 999999
          END
        ) OVER (PARTITION BY pool_id, user_id) = 120
      THEN true
      ELSE false
    END AS is_spark
  FROM six_pity
  WHERE classified_pool_type = 'limited'
),
global_grouped AS (
  SELECT
    range_label,
    SUM(CASE WHEN NOT is_standard_calc THEN 1 ELSE 0 END) AS limited_count,
    SUM(CASE WHEN is_standard_calc THEN 1 ELSE 0 END) AS standard_count
  FROM (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END AS range_label,
      is_standard_calc
    FROM six_pity
  ) AS t
  GROUP BY range_label
),
limited_grouped AS (
  SELECT
    range_label,
    SUM(CASE WHEN NOT is_standard_calc THEN 1 ELSE 0 END) AS limited_count,
    SUM(CASE WHEN is_standard_calc THEN 1 ELSE 0 END) AS standard_count
  FROM (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END AS range_label,
      is_standard_calc
    FROM limited_six_pity
  ) AS t
  GROUP BY range_label
),
weapon_grouped AS (
  SELECT
    range_label,
    SUM(CASE WHEN NOT is_standard_calc THEN 1 ELSE 0 END) AS limited_count,
    SUM(CASE WHEN is_standard_calc THEN 1 ELSE 0 END) AS standard_count
  FROM (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END AS range_label,
      is_standard_calc
    FROM six_pity
    WHERE classified_pool_type = 'weapon'
  ) AS t
  GROUP BY range_label
),
standard_grouped AS (
  SELECT
    range_label,
    0 AS limited_count,
    COUNT(*) AS standard_count
  FROM (
    SELECT
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END AS range_label
    FROM six_pity
    WHERE classified_pool_type = 'standard'
  ) AS t
  GROUP BY range_label
)
SELECT json_build_object(
  'totalPulls', COALESCE((SELECT COUNT(*) FROM valid_pulls), 0),
  'totalPullsWithFree', COALESCE((
    SELECT COUNT(*)
    FROM history_enriched
    WHERE special_type IS DISTINCT FROM 'gift'
  ), 0),
  'freePullCount', COALESCE((
    SELECT COUNT(*)
    FROM history_enriched
    WHERE special_type IS DISTINCT FROM 'gift'
      AND is_free = true
  ), 0),
  'totalUsers', COALESCE((SELECT COUNT(*) FROM public.public_profiles), 0),
  'totalContributors', COALESCE((SELECT COUNT(DISTINCT user_id) FROM valid_pulls), 0),
  'sixStarTotal', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE rarity = 6), 0),
  'sixStarLimited', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE rarity = 6 AND is_standard_calc = false), 0),
  'sixStarStandard', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE rarity = 6 AND is_standard_calc = true), 0),
  'fiveStar', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE rarity = 5), 0),
  'fourStar', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE rarity <= 4), 0),
  'avgPity', COALESCE((SELECT ROUND(AVG(pity), 1) FROM six_pity), 0),
  'counts', json_build_object(
    '6', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE rarity = 6 AND is_standard_calc = false), 0),
    '6_std', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE rarity = 6 AND is_standard_calc = true), 0),
    '5', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE rarity = 5), 0),
    '4', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE rarity <= 4), 0)
  ),
  'distribution', COALESCE((
    SELECT json_agg(
      json_build_object(
        'range', REPLACE(range_label, '01-10', '1-10'),
        'limited', limited_count,
        'standard', standard_count
      )
      ORDER BY range_label
    )
    FROM global_grouped
  ), '[]'::json),
  'byType', json_build_object(
    'limited', json_build_object(
      'total', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'limited'), 0),
      'six', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'limited' AND rarity = 6), 0),
      'sixStarLimited', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'limited' AND rarity = 6 AND is_standard_calc = false), 0),
      'sixStarStandard', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'limited' AND rarity = 6 AND is_standard_calc = true), 0),
      'avgPity', COALESCE((SELECT ROUND(AVG(pity), 1) FROM limited_six_pity), 0),
      'avgPityUp', COALESCE((SELECT ROUND(AVG(pity), 1) FROM limited_six_pity WHERE is_standard_calc = false AND NOT is_spark), 0),
      'sparkCount', COALESCE((SELECT COUNT(DISTINCT user_id) FROM limited_six_pity WHERE is_spark = true), 0),
      'counts', json_build_object(
        '6', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'limited' AND rarity = 6 AND is_standard_calc = false), 0),
        '6_std', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'limited' AND rarity = 6 AND is_standard_calc = true), 0),
        '5', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'limited' AND rarity = 5), 0),
        '4', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'limited' AND rarity <= 4), 0)
      ),
      'distribution', COALESCE((
        SELECT json_agg(
          json_build_object(
            'range', REPLACE(range_label, '01-10', '1-10'),
            'limited', limited_count,
            'standard', standard_count
          )
          ORDER BY range_label
        )
        FROM limited_grouped
      ), '[]'::json)
    ),
    'weapon', json_build_object(
      'total', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'weapon'), 0),
      'six', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'weapon' AND rarity = 6), 0),
      'sixStarLimited', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'weapon' AND rarity = 6 AND is_standard_calc = false), 0),
      'sixStarStandard', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'weapon' AND rarity = 6 AND is_standard_calc = true), 0),
      'avgPity', COALESCE((SELECT ROUND(AVG(pity), 1) FROM six_pity WHERE classified_pool_type = 'weapon'), 0),
      'avgPityUp', COALESCE((SELECT ROUND(AVG(pity), 1) FROM six_pity WHERE classified_pool_type = 'weapon' AND is_standard_calc = false), 0),
      'counts', json_build_object(
        '6', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'weapon' AND rarity = 6 AND is_standard_calc = false), 0),
        '6_std', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'weapon' AND rarity = 6 AND is_standard_calc = true), 0),
        '5', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'weapon' AND rarity = 5), 0),
        '4', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'weapon' AND rarity <= 4), 0)
      ),
      'distribution', COALESCE((
        SELECT json_agg(
          json_build_object(
            'range', REPLACE(range_label, '01-10', '1-10'),
            'limited', limited_count,
            'standard', standard_count
          )
          ORDER BY range_label
        )
        FROM weapon_grouped
      ), '[]'::json)
    ),
    'standard', json_build_object(
      'total', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'standard'), 0),
      'six', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'standard' AND rarity = 6), 0),
      'sixStarLimited', 0,
      'sixStarStandard', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'standard' AND rarity = 6), 0),
      'avgPity', COALESCE((SELECT ROUND(AVG(pity), 1) FROM six_pity WHERE classified_pool_type = 'standard'), 0),
      'counts', json_build_object(
        '6', 0,
        '6_std', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'standard' AND rarity = 6), 0),
        '5', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'standard' AND rarity = 5), 0),
        '4', COALESCE((SELECT COUNT(*) FROM valid_pulls WHERE classified_pool_type = 'standard' AND rarity <= 4), 0)
      ),
      'distribution', COALESCE((
        SELECT json_agg(
          json_build_object(
            'range', REPLACE(range_label, '01-10', '1-10'),
            'limited', limited_count,
            'standard', standard_count
          )
          ORDER BY range_label
        )
        FROM standard_grouped
      ), '[]'::json)
    )
  ),
  'charGift', COALESCE((
    SELECT COUNT(*)
    FROM history_enriched
    WHERE special_type = 'gift'
      AND rarity = 6
      AND classified_pool_type = 'limited'
  ), 0),
  'weaponGiftLimited', COALESCE((
    SELECT COUNT(*)
    FROM history_enriched
    WHERE special_type = 'gift'
      AND rarity = 6
      AND classified_pool_type = 'weapon'
      AND is_standard_calc = false
  ), 0),
  'weaponGiftStandard', COALESCE((
    SELECT COUNT(*)
    FROM history_enriched
    WHERE special_type = 'gift'
      AND rarity = 6
      AND classified_pool_type = 'weapon'
      AND is_standard_calc = true
  ), 0),
  'giftTotal', COALESCE((
    SELECT COUNT(*)
    FROM history_enriched
    WHERE special_type = 'gift'
  ), 0)
);
$$;

GRANT EXECUTE ON FUNCTION public.get_global_stats() TO anon, authenticated;
-- <<< END MIGRATION: archive/070_fix_get_global_stats_timeout_after_rls.sql

-- >>> BEGIN MIGRATION: archive/071_optimize_get_global_stats_query_shape.sql
-- ============================================
-- 071: 进一步优化 get_global_stats 查询形状
--
-- 背景:
--   070 已将旧版 get_global_stats() 从多段重复全表扫描
--   收敛到共享 CTE，但最终 json_build_object 仍然对
--   valid_pulls / six_pity / history_enriched 做了大量重复 scalar subquery。
--
-- 目标:
--   1. 保持返回 JSON 结构不变
--   2. 将大结果集上的重复扫描改为一次聚合
--   3. 缩窄中间 CTE 的列宽，降低 materialize / spill 成本
-- ============================================

CREATE OR REPLACE FUNCTION public.get_global_stats()
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH history_base AS MATERIALIZED (
  SELECT
    h.pool_id,
    h.user_id,
    h.record_id,
    h.rarity,
    h.special_type,
    h.is_free,
    h.is_standard,
    h.character_name,
    h.item_name,
    p.type AS pool_type,
    p.up_character
  FROM public.history AS h
  LEFT JOIN public.pools AS p ON p.pool_id = h.pool_id
),
history_enriched AS MATERIALIZED (
  SELECT
    hb.pool_id,
    hb.user_id,
    hb.record_id,
    hb.rarity,
    hb.special_type,
    hb.is_free,
    CASE
      WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN true
      WHEN hb.rarity = 6 AND hb.up_character IS NOT NULL THEN
        NOT (
          COALESCE(hb.character_name, '') ILIKE '%' || hb.up_character || '%'
          OR COALESCE(hb.item_name, '') ILIKE '%' || hb.up_character || '%'
          OR hb.up_character ILIKE '%' || COALESCE(hb.character_name, hb.item_name, '') || '%'
        )
      ELSE COALESCE(hb.is_standard, false)
    END AS is_standard_calc,
    COALESCE(
      CASE
        WHEN hb.pool_type IN ('limited', 'limited_character') THEN 'limited'
        WHEN hb.pool_type IN ('weapon', 'limited_weapon') THEN 'weapon'
        WHEN hb.pool_type IN ('standard', 'beginner') THEN 'standard'
        ELSE NULL
      END,
      CASE
        WHEN hb.pool_id IN ('standard', 'beginner') THEN 'standard'
        WHEN split_part(hb.pool_id, '_', 1) = 'special' THEN 'limited'
        WHEN split_part(hb.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
        WHEN
          CASE
            WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN true
            WHEN hb.rarity = 6 AND hb.up_character IS NOT NULL THEN
              NOT (
                COALESCE(hb.character_name, '') ILIKE '%' || hb.up_character || '%'
                OR COALESCE(hb.item_name, '') ILIKE '%' || hb.up_character || '%'
                OR hb.up_character ILIKE '%' || COALESCE(hb.character_name, hb.item_name, '') || '%'
              )
            ELSE COALESCE(hb.is_standard, false)
          END
        THEN 'standard'
        ELSE 'limited'
      END
    ) AS classified_pool_type
  FROM history_base AS hb
),
valid_pulls AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    record_id,
    rarity,
    is_standard_calc,
    classified_pool_type
  FROM history_enriched
  WHERE special_type IS DISTINCT FROM 'gift'
    AND (is_free IS NOT TRUE)
),
valid_counts AS MATERIALIZED (
  SELECT
    COUNT(*) AS total_pulls,
    COUNT(DISTINCT user_id) AS total_contributors,
    COUNT(*) FILTER (WHERE rarity = 6) AS six_star_total,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = false) AS six_star_limited,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = true) AS six_star_standard,
    COUNT(*) FILTER (WHERE rarity = 5) AS five_star,
    COUNT(*) FILTER (WHERE rarity <= 4) AS four_star
  FROM valid_pulls
),
history_counts AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE special_type IS DISTINCT FROM 'gift') AS total_pulls_with_free,
    COUNT(*) FILTER (WHERE special_type IS DISTINCT FROM 'gift' AND is_free = true) AS free_pull_count,
    COUNT(*) FILTER (WHERE special_type = 'gift') AS gift_total,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'limited'
    ) AS char_gift,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'weapon'
        AND is_standard_calc = false
    ) AS weapon_gift_limited,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'weapon'
        AND is_standard_calc = true
    ) AS weapon_gift_standard
  FROM history_enriched
),
type_counts AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE rarity = 6) AS six,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = false) AS six_star_limited,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = true) AS six_star_standard,
    COUNT(*) FILTER (WHERE rarity = 5) AS five,
    COUNT(*) FILTER (WHERE rarity <= 4) AS four
  FROM valid_pulls
  GROUP BY classified_pool_type
),
ordered_valid AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    rarity,
    is_standard_calc,
    classified_pool_type,
    record_id,
    ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) AS rn
  FROM valid_pulls
),
six_pity AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    is_standard_calc,
    classified_pool_type,
    rn,
    LEAST(
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0),
      80
    ) AS pity
  FROM ordered_valid
  WHERE rarity = 6
),
limited_first_up AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    MIN(rn) FILTER (WHERE is_standard_calc = false) AS first_up_rn
  FROM six_pity
  WHERE classified_pool_type = 'limited'
  GROUP BY pool_id, user_id
),
limited_six_pity AS MATERIALIZED (
  SELECT
    sp.pool_id,
    sp.user_id,
    sp.is_standard_calc,
    sp.rn,
    sp.pity,
    CASE
      WHEN sp.is_standard_calc = false
        AND sp.rn = 120
        AND COALESCE(lfu.first_up_rn, 999999) = 120
      THEN true
      ELSE false
    END AS is_spark
  FROM six_pity AS sp
  LEFT JOIN limited_first_up AS lfu
    ON lfu.pool_id = sp.pool_id
   AND lfu.user_id = sp.user_id
  WHERE sp.classified_pool_type = 'limited'
),
pity_ranges AS MATERIALIZED (
  SELECT
    classified_pool_type,
    is_standard_calc,
    CASE
      WHEN pity BETWEEN 1 AND 10 THEN '01-10'
      WHEN pity BETWEEN 11 AND 20 THEN '11-20'
      WHEN pity BETWEEN 21 AND 30 THEN '21-30'
      WHEN pity BETWEEN 31 AND 40 THEN '31-40'
      WHEN pity BETWEEN 41 AND 50 THEN '41-50'
      WHEN pity BETWEEN 51 AND 60 THEN '51-60'
      WHEN pity BETWEEN 61 AND 70 THEN '61-70'
      WHEN pity BETWEEN 71 AND 80 THEN '71-80'
      WHEN pity BETWEEN 81 AND 90 THEN '81-90'
      ELSE '91+'
    END AS range_label
  FROM six_pity
),
global_distribution_rows AS MATERIALIZED (
  SELECT
    range_label,
    COUNT(*) FILTER (WHERE is_standard_calc = false) AS limited_count,
    COUNT(*) FILTER (WHERE is_standard_calc = true) AS standard_count
  FROM pity_ranges
  GROUP BY range_label
),
type_distribution_rows AS MATERIALIZED (
  SELECT
    classified_pool_type,
    range_label,
    COUNT(*) FILTER (WHERE is_standard_calc = false) AS limited_count,
    COUNT(*) FILTER (WHERE is_standard_calc = true) AS standard_count
  FROM pity_ranges
  GROUP BY classified_pool_type, range_label
),
global_distribution AS MATERIALIZED (
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'range', REPLACE(range_label, '01-10', '1-10'),
        'limited', limited_count,
        'standard', standard_count
      )
      ORDER BY range_label
    ),
    '[]'::json
  ) AS distribution
  FROM global_distribution_rows
),
type_distributions AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COALESCE(
      json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        )
        ORDER BY range_label
      ),
      '[]'::json
    ) AS distribution
  FROM type_distribution_rows
  GROUP BY classified_pool_type
),
global_avg_pity AS MATERIALIZED (
  SELECT COALESCE(ROUND(AVG(pity)::numeric, 1), 0) AS avg_pity
  FROM six_pity
),
type_pity_stats AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COALESCE(ROUND(AVG(pity)::numeric, 1), 0) AS avg_pity,
    COALESCE(ROUND(AVG(pity) FILTER (WHERE is_standard_calc = false)::numeric, 1), 0) AS avg_pity_up
  FROM six_pity
  GROUP BY classified_pool_type
),
limited_pity_stats AS MATERIALIZED (
  SELECT
    COALESCE(ROUND(AVG(pity)::numeric, 1), 0) AS avg_pity,
    COALESCE(ROUND(AVG(pity) FILTER (WHERE is_standard_calc = false AND NOT is_spark)::numeric, 1), 0) AS avg_pity_up,
    COUNT(DISTINCT user_id) FILTER (WHERE is_spark = true) AS spark_count
  FROM limited_six_pity
),
total_users AS MATERIALIZED (
  SELECT COUNT(*) AS total_users
  FROM public.profiles
)
SELECT json_build_object(
  'totalPulls', COALESCE(vc.total_pulls, 0),
  'totalPullsWithFree', COALESCE(hc.total_pulls_with_free, 0),
  'freePullCount', COALESCE(hc.free_pull_count, 0),
  'totalUsers', COALESCE(tu.total_users, 0),
  'totalContributors', COALESCE(vc.total_contributors, 0),
  'sixStarTotal', COALESCE(vc.six_star_total, 0),
  'sixStarLimited', COALESCE(vc.six_star_limited, 0),
  'sixStarStandard', COALESCE(vc.six_star_standard, 0),
  'fiveStar', COALESCE(vc.five_star, 0),
  'fourStar', COALESCE(vc.four_star, 0),
  'avgPity', COALESCE(gap.avg_pity, 0),
  'counts', json_build_object(
    '6', COALESCE(vc.six_star_limited, 0),
    '6_std', COALESCE(vc.six_star_standard, 0),
    '5', COALESCE(vc.five_star, 0),
    '4', COALESCE(vc.four_star, 0)
  ),
  'distribution', COALESCE(gd.distribution, '[]'::json),
  'byType', json_build_object(
    'limited', json_build_object(
      'total', COALESCE(tc_limited.total, 0),
      'six', COALESCE(tc_limited.six, 0),
      'sixStarLimited', COALESCE(tc_limited.six_star_limited, 0),
      'sixStarStandard', COALESCE(tc_limited.six_star_standard, 0),
      'avgPity', COALESCE(lps.avg_pity, 0),
      'avgPityUp', COALESCE(lps.avg_pity_up, 0),
      'sparkCount', COALESCE(lps.spark_count, 0),
      'counts', json_build_object(
        '6', COALESCE(tc_limited.six_star_limited, 0),
        '6_std', COALESCE(tc_limited.six_star_standard, 0),
        '5', COALESCE(tc_limited.five, 0),
        '4', COALESCE(tc_limited.four, 0)
      ),
      'distribution', COALESCE(td_limited.distribution, '[]'::json)
    ),
    'weapon', json_build_object(
      'total', COALESCE(tc_weapon.total, 0),
      'six', COALESCE(tc_weapon.six, 0),
      'sixStarLimited', COALESCE(tc_weapon.six_star_limited, 0),
      'sixStarStandard', COALESCE(tc_weapon.six_star_standard, 0),
      'avgPity', COALESCE(tps_weapon.avg_pity, 0),
      'avgPityUp', COALESCE(tps_weapon.avg_pity_up, 0),
      'counts', json_build_object(
        '6', COALESCE(tc_weapon.six_star_limited, 0),
        '6_std', COALESCE(tc_weapon.six_star_standard, 0),
        '5', COALESCE(tc_weapon.five, 0),
        '4', COALESCE(tc_weapon.four, 0)
      ),
      'distribution', COALESCE(td_weapon.distribution, '[]'::json)
    ),
    'standard', json_build_object(
      'total', COALESCE(tc_standard.total, 0),
      'six', COALESCE(tc_standard.six, 0),
      'sixStarLimited', 0,
      'sixStarStandard', COALESCE(tc_standard.six, 0),
      'avgPity', COALESCE(tps_standard.avg_pity, 0),
      'counts', json_build_object(
        '6', 0,
        '6_std', COALESCE(tc_standard.six, 0),
        '5', COALESCE(tc_standard.five, 0),
        '4', COALESCE(tc_standard.four, 0)
      ),
      'distribution', COALESCE(td_standard.distribution, '[]'::json)
    )
  ),
  'charGift', COALESCE(hc.char_gift, 0),
  'weaponGiftLimited', COALESCE(hc.weapon_gift_limited, 0),
  'weaponGiftStandard', COALESCE(hc.weapon_gift_standard, 0),
  'giftTotal', COALESCE(hc.gift_total, 0)
)
FROM valid_counts AS vc
CROSS JOIN history_counts AS hc
CROSS JOIN global_avg_pity AS gap
CROSS JOIN global_distribution AS gd
CROSS JOIN limited_pity_stats AS lps
CROSS JOIN total_users AS tu
LEFT JOIN type_counts AS tc_limited
  ON tc_limited.classified_pool_type = 'limited'
LEFT JOIN type_counts AS tc_weapon
  ON tc_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_counts AS tc_standard
  ON tc_standard.classified_pool_type = 'standard'
LEFT JOIN type_pity_stats AS tps_weapon
  ON tps_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_pity_stats AS tps_standard
  ON tps_standard.classified_pool_type = 'standard'
LEFT JOIN type_distributions AS td_limited
  ON td_limited.classified_pool_type = 'limited'
LEFT JOIN type_distributions AS td_weapon
  ON td_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_distributions AS td_standard
  ON td_standard.classified_pool_type = 'standard';
$$;

GRANT EXECUTE ON FUNCTION public.get_global_stats() TO anon, authenticated;
-- <<< END MIGRATION: archive/071_optimize_get_global_stats_query_shape.sql

-- >>> BEGIN MIGRATION: archive/072_add_get_app_visible_pools_rpc.sql
-- ============================================
-- 072: app 端卡池读取边界收口
-- 目的:
--   1. 停止客户端直接 select * 拉全表后再前端去重
--   2. 统一“公开共享卡池 + 当前用户自有卡池”的读取口径
-- ============================================

DROP FUNCTION IF EXISTS public.get_app_visible_pools();

CREATE OR REPLACE FUNCTION public.get_app_visible_pools()
RETURNS TABLE (
  pool_id TEXT,
  name TEXT,
  type TEXT,
  locked BOOLEAN,
  is_limited_weapon BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  user_id UUID,
  creator_username TEXT,
  creator_role TEXT,
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
      OR
      p.user_id IS NULL
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
      p.type,
      p.locked,
      p.is_limited_weapon,
      p.created_at,
      p.updated_at,
      p.user_id,
      prof.username AS creator_username,
      prof.role AS creator_role,
      p.up_character,
      p.description,
      p.banner_url,
      p.start_time,
      p.end_time,
      p.featured_characters,
      ROW_NUMBER() OVER (
        PARTITION BY p.pool_id
        ORDER BY
          CASE
            WHEN prof.role = 'super_admin' THEN 3
            WHEN prof.role = 'admin' THEN 2
            ELSE 1
          END DESC,
          (
            CASE WHEN NULLIF(BTRIM(COALESCE(p.up_character, '')), '') IS NOT NULL THEN 4 ELSE 0 END +
            CASE WHEN p.start_time IS NOT NULL THEN 2 ELSE 0 END +
            CASE WHEN p.end_time IS NOT NULL THEN 2 ELSE 0 END +
            CASE WHEN COALESCE(array_length(p.featured_characters, 1), 0) > 0 THEN 1 ELSE 0 END +
            CASE WHEN NULLIF(BTRIM(COALESCE(p.banner_url, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
            CASE WHEN NULLIF(BTRIM(COALESCE(p.description, '')), '') IS NOT NULL THEN 1 ELSE 0 END +
            CASE WHEN p.locked THEN 1 ELSE 0 END
          ) DESC,
          CASE WHEN p.user_id = auth.uid() THEN 1 ELSE 0 END DESC,
          COALESCE(p.start_time, p.updated_at, p.created_at, to_timestamp(0)) DESC,
          COALESCE(p.updated_at, p.created_at, to_timestamp(0)) DESC
      ) AS row_rank
    FROM visible_pools AS p
    LEFT JOIN public.profiles AS prof
      ON prof.id = p.user_id
  )
  SELECT
    pool_id,
    name,
    type,
    locked,
    is_limited_weapon,
    created_at,
    updated_at,
    user_id,
    creator_username,
    creator_role,
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
  '返回 app 端可见的卡池集合：公开共享卡池 + 当前用户自有卡池，并在服务端完成 pool_id 级别去重与共享池优先级排序。';
-- <<< END MIGRATION: archive/072_add_get_app_visible_pools_rpc.sql

-- >>> BEGIN MIGRATION: archive/073_drop_admin_applications.sql
-- ============================================
-- 073: 移除已废弃的管理员申请体系
-- 背景:
--   前端运行时已经不再依赖 admin_applications。
--   保留该表只会让新环境继续创建无用结构，并增加文档噪音。
-- ============================================

DROP POLICY IF EXISTS "admin_applications_select_own" ON public.admin_applications;
DROP POLICY IF EXISTS "admin_applications_select_super" ON public.admin_applications;
DROP POLICY IF EXISTS "admin_applications_insert_policy" ON public.admin_applications;
DROP POLICY IF EXISTS "admin_applications_update_super" ON public.admin_applications;
DROP POLICY IF EXISTS "admin_applications_delete_super" ON public.admin_applications;
DROP POLICY IF EXISTS "Enable delete for super_admin on applications" ON public.admin_applications;

DROP TABLE IF EXISTS public.admin_applications CASCADE;

COMMENT ON TABLE public.profiles IS
  '用户资料表；管理员权限变更已改走超管直管流程，不再使用 admin_applications 申请链路。';
-- <<< END MIGRATION: archive/073_drop_admin_applications.sql

-- >>> BEGIN MIGRATION: archive/074_extend_rpc_statement_timeouts.sql
-- ============================================
-- 074: 放宽关键 RPC 的 statement_timeout
--
-- 背景:
--   国内访问 Supabase 时，跨境链路抖动会放大统计/卡池 RPC 的耗时。
--   仅拉长前端超时不够，数据库函数本身也需要更宽松的执行窗口。
--
-- 目标:
--   1. 给重查询统计 RPC 更多执行时间，减少过早 57014
--   2. 给卡池可见性 RPC 留出适度余量，避免偶发超时直接判空
-- ============================================

ALTER FUNCTION public.get_global_stats()
  SET statement_timeout = '90s';

ALTER FUNCTION public.get_character_ranking_stats()
  SET statement_timeout = '75s';

ALTER FUNCTION public.get_user_ranking_stats(uuid)
  SET statement_timeout = '60s';

ALTER FUNCTION public.get_app_visible_pools()
  SET statement_timeout = '30s';
-- <<< END MIGRATION: archive/074_extend_rpc_statement_timeouts.sql

-- >>> BEGIN MIGRATION: archive/075_create_id_alias_tables.sql
-- ============================================
-- 075: 创建角色 / 卡池 ID alias 映射表
--
-- 背景:
--   现有 characters.id / pools.pool_id 同时承担了“内部主键”和“外部来源 ID”两种职责，
--   导致手工补录 ID、wiki ID、官方导入 ID 之间无法稳定收口。
--
-- 目标:
--   1. 给角色与卡池增加 source_id -> canonical_id 的映射层
--   2. 为后续“统一到官方 ID”的合并脚本提供安全落点
--   3. 先回填当前内部 ID 为 self alias，不在本迁移里直接改主键
-- ============================================

CREATE TABLE IF NOT EXISTS public.character_id_aliases (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL CHECK (
    source IN (
      'internal',
      'wiki',
      'official_api',
      'legacy_manual',
      'manual_placeholder',
      'import_raw',
      'custom'
    )
  ),
  alias_id TEXT NOT NULL,
  character_id TEXT NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT character_id_aliases_source_alias_unique UNIQUE (source, alias_id)
);

CREATE INDEX IF NOT EXISTS idx_character_id_aliases_character_id
  ON public.character_id_aliases(character_id);

CREATE INDEX IF NOT EXISTS idx_character_id_aliases_alias_id
  ON public.character_id_aliases(alias_id);

COMMENT ON TABLE public.character_id_aliases IS
  '角色 ID alias 映射表。把 wiki / 手工 / 导入原始 ID 映射到 canonical characters.id。';
COMMENT ON COLUMN public.character_id_aliases.source IS
  'alias 来源：internal / wiki / official_api / legacy_manual / manual_placeholder / import_raw / custom';
COMMENT ON COLUMN public.character_id_aliases.alias_id IS
  '外部来源或历史系统中的角色 ID';
COMMENT ON COLUMN public.character_id_aliases.character_id IS
  'canonical 角色 ID，关联 public.characters(id)';

ALTER TABLE public.character_id_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "character_id_aliases_select_all" ON public.character_id_aliases;
CREATE POLICY "character_id_aliases_select_all" ON public.character_id_aliases
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "character_id_aliases_manage_super_admin" ON public.character_id_aliases;
CREATE POLICY "character_id_aliases_manage_super_admin" ON public.character_id_aliases
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

DROP TRIGGER IF EXISTS update_character_id_aliases_updated_at ON public.character_id_aliases;
CREATE TRIGGER update_character_id_aliases_updated_at
  BEFORE UPDATE ON public.character_id_aliases
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.pool_id_aliases (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL CHECK (
    source IN (
      'internal',
      'official_api',
      'legacy_manual',
      'manual_placeholder',
      'import_raw',
      'custom'
    )
  ),
  alias_id TEXT NOT NULL,
  pool_id TEXT NOT NULL REFERENCES public.pools(pool_id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT pool_id_aliases_source_alias_unique UNIQUE (source, alias_id)
);

CREATE INDEX IF NOT EXISTS idx_pool_id_aliases_pool_id
  ON public.pool_id_aliases(pool_id);

CREATE INDEX IF NOT EXISTS idx_pool_id_aliases_alias_id
  ON public.pool_id_aliases(alias_id);

COMMENT ON TABLE public.pool_id_aliases IS
  '卡池 ID alias 映射表。把历史手工池 / 官方导入池 / 其它来源池 ID 映射到 canonical pools.pool_id。';
COMMENT ON COLUMN public.pool_id_aliases.source IS
  'alias 来源：internal / official_api / legacy_manual / manual_placeholder / import_raw / custom';
COMMENT ON COLUMN public.pool_id_aliases.alias_id IS
  '外部来源或历史系统中的卡池 ID';
COMMENT ON COLUMN public.pool_id_aliases.pool_id IS
  'canonical 卡池 ID，关联 public.pools(pool_id)';

ALTER TABLE public.pool_id_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pool_id_aliases_select_all" ON public.pool_id_aliases;
CREATE POLICY "pool_id_aliases_select_all" ON public.pool_id_aliases
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "pool_id_aliases_manage_super_admin" ON public.pool_id_aliases;
CREATE POLICY "pool_id_aliases_manage_super_admin" ON public.pool_id_aliases
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

DROP TRIGGER IF EXISTS update_pool_id_aliases_updated_at ON public.pool_id_aliases;
CREATE TRIGGER update_pool_id_aliases_updated_at
  BEFORE UPDATE ON public.pool_id_aliases
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.character_id_aliases (source, alias_id, character_id, is_primary, note)
SELECT
  'internal' AS source,
  c.id AS alias_id,
  c.id AS character_id,
  TRUE AS is_primary,
  'Backfill current characters.id as canonical self-alias'
FROM public.characters AS c
ON CONFLICT (source, alias_id) DO UPDATE
SET
  character_id = EXCLUDED.character_id,
  is_primary = TRUE,
  note = EXCLUDED.note,
  updated_at = NOW();

INSERT INTO public.pool_id_aliases (source, alias_id, pool_id, is_primary, note)
SELECT
  'internal' AS source,
  p.pool_id AS alias_id,
  p.pool_id AS pool_id,
  TRUE AS is_primary,
  'Backfill current pools.pool_id as canonical self-alias'
FROM public.pools AS p
ON CONFLICT (source, alias_id) DO UPDATE
SET
  pool_id = EXCLUDED.pool_id,
  is_primary = TRUE,
  note = EXCLUDED.note,
  updated_at = NOW();

CREATE OR REPLACE FUNCTION public.resolve_character_alias(
  p_alias_id TEXT,
  p_source TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cia.character_id
  FROM public.character_id_aliases AS cia
  WHERE cia.alias_id = p_alias_id
    AND (p_source IS NULL OR cia.source = p_source)
  ORDER BY
    CASE WHEN p_source IS NOT NULL AND cia.source = p_source THEN 0 ELSE 1 END,
    cia.is_primary DESC,
    cia.id ASC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.resolve_character_alias(TEXT, TEXT) IS
  '通过 alias_id + 可选 source 解析 canonical character_id。';

CREATE OR REPLACE FUNCTION public.resolve_pool_alias(
  p_alias_id TEXT,
  p_source TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pia.pool_id
  FROM public.pool_id_aliases AS pia
  WHERE pia.alias_id = p_alias_id
    AND (p_source IS NULL OR pia.source = p_source)
  ORDER BY
    CASE WHEN p_source IS NOT NULL AND pia.source = p_source THEN 0 ELSE 1 END,
    pia.is_primary DESC,
    pia.id ASC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.resolve_pool_alias(TEXT, TEXT) IS
  '通过 alias_id + 可选 source 解析 canonical pool_id。';

GRANT EXECUTE ON FUNCTION public.resolve_character_alias(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_pool_alias(TEXT, TEXT) TO anon, authenticated;

DO $$
DECLARE
  character_alias_count BIGINT;
  pool_alias_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO character_alias_count FROM public.character_id_aliases;
  SELECT COUNT(*) INTO pool_alias_count FROM public.pool_id_aliases;

  RAISE NOTICE '✅ Migration 075: alias 映射表创建完成';
  RAISE NOTICE '   character_id_aliases rows: %', character_alias_count;
  RAISE NOTICE '   pool_id_aliases rows: %', pool_alias_count;
END $$;
-- <<< END MIGRATION: archive/075_create_id_alias_tables.sql

-- >>> BEGIN MIGRATION: archive/076_auto_maintain_internal_id_aliases.sql
-- ============================================
-- 076: 自动维护 internal self alias
--
-- 背景:
--   075 迁移只回填了当时已有的主数据。后续无论是谁新增 characters / pools，
--   都必须自动拥有一条 internal self alias，否则 alias 解析层会逐步失真。
--
-- 目标:
--   1. 在 characters / pools 新增或变更主键时，自动回填 internal self alias
--   2. 不依赖前端/后端调用方手工写 alias
-- ============================================

CREATE OR REPLACE FUNCTION public.sync_character_internal_self_alias()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.character_id_aliases (source, alias_id, character_id, is_primary, note)
  VALUES ('internal', NEW.id, NEW.id, TRUE, 'Auto-maintained canonical self alias')
  ON CONFLICT (source, alias_id) DO UPDATE
  SET
    character_id = EXCLUDED.character_id,
    is_primary = TRUE,
    note = EXCLUDED.note,
    updated_at = NOW();

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_character_internal_self_alias() IS
  '自动维护 character_id_aliases 中的 internal self alias。';

DROP TRIGGER IF EXISTS sync_character_internal_self_alias ON public.characters;
CREATE TRIGGER sync_character_internal_self_alias
  AFTER INSERT OR UPDATE OF id
  ON public.characters
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_character_internal_self_alias();

CREATE OR REPLACE FUNCTION public.sync_pool_internal_self_alias()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.pool_id_aliases (source, alias_id, pool_id, is_primary, note)
  VALUES ('internal', NEW.pool_id, NEW.pool_id, TRUE, 'Auto-maintained canonical self alias')
  ON CONFLICT (source, alias_id) DO UPDATE
  SET
    pool_id = EXCLUDED.pool_id,
    is_primary = TRUE,
    note = EXCLUDED.note,
    updated_at = NOW();

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_pool_internal_self_alias() IS
  '自动维护 pool_id_aliases 中的 internal self alias。';

DROP TRIGGER IF EXISTS sync_pool_internal_self_alias ON public.pools;
CREATE TRIGGER sync_pool_internal_self_alias
  AFTER INSERT OR UPDATE OF pool_id
  ON public.pools
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_pool_internal_self_alias();

INSERT INTO public.character_id_aliases (source, alias_id, character_id, is_primary, note)
SELECT
  'internal',
  c.id,
  c.id,
  TRUE,
  'Auto-backfill canonical self alias'
FROM public.characters AS c
ON CONFLICT (source, alias_id) DO UPDATE
SET
  character_id = EXCLUDED.character_id,
  is_primary = TRUE,
  note = EXCLUDED.note,
  updated_at = NOW();

INSERT INTO public.pool_id_aliases (source, alias_id, pool_id, is_primary, note)
SELECT
  'internal',
  p.pool_id,
  p.pool_id,
  TRUE,
  'Auto-backfill canonical self alias'
FROM public.pools AS p
ON CONFLICT (source, alias_id) DO UPDATE
SET
  pool_id = EXCLUDED.pool_id,
  is_primary = TRUE,
  note = EXCLUDED.note,
  updated_at = NOW();

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 076: internal self alias auto-maintenance enabled';
END $$;
-- <<< END MIGRATION: archive/076_auto_maintain_internal_id_aliases.sql

-- >>> BEGIN MIGRATION: archive/077_add_admin_sync_character_rpc.sql
-- ============================================
-- 077: 原子化同步角色/武器与 alias
--
-- 背景:
--   管理端从 Wiki 同步时，characters 与 character_id_aliases 分两步写入，
--   一旦 alias 写入失败，会留下 canonical 主数据已更新、alias 缺失的半成功状态。
--
-- 目标:
--   1. 提供一个 SECURITY DEFINER RPC，在单个事务中完成角色 upsert + alias upsert
--   2. 仅允许 super_admin 调用
--   3. 角色已存在时只更新同步链路允许覆盖的字段，避免误伤 pool_config / is_limited
-- ============================================

CREATE OR REPLACE FUNCTION public.admin_sync_character_with_aliases(
  p_character_id TEXT,
  p_insert_payload JSONB,
  p_update_payload JSONB DEFAULT '{}'::jsonb,
  p_alias_rows JSONB DEFAULT '[]'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'only super_admin can sync characters';
  END IF;

  IF COALESCE(BTRIM(p_character_id), '') = '' THEN
    RAISE EXCEPTION 'p_character_id is required';
  END IF;

  IF p_insert_payload IS NULL OR jsonb_typeof(p_insert_payload) <> 'object' THEN
    RAISE EXCEPTION 'p_insert_payload must be a JSON object';
  END IF;

  IF p_update_payload IS NULL THEN
    p_update_payload := '{}'::jsonb;
  END IF;

  IF jsonb_typeof(p_update_payload) <> 'object' THEN
    RAISE EXCEPTION 'p_update_payload must be a JSON object';
  END IF;

  IF p_alias_rows IS NULL THEN
    p_alias_rows := '[]'::jsonb;
  END IF;

  IF jsonb_typeof(p_alias_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_alias_rows must be a JSON array';
  END IF;

  INSERT INTO public.characters (
    id,
    name,
    avatar_url,
    rarity,
    type,
    aliases,
    is_limited,
    pool_config
  )
  VALUES (
    BTRIM(p_character_id),
    BTRIM(p_insert_payload->>'name'),
    NULLIF(BTRIM(p_insert_payload->>'avatar_url'), ''),
    NULLIF(BTRIM(p_insert_payload->>'rarity'), '')::INTEGER,
    COALESCE(NULLIF(BTRIM(p_insert_payload->>'type'), ''), 'character'),
    CASE
      WHEN p_insert_payload ? 'aliases'
        AND jsonb_typeof(p_insert_payload->'aliases') = 'array'
      THEN ARRAY(
        SELECT jsonb_array_elements_text(p_insert_payload->'aliases')
      )
      ELSE NULL
    END,
    COALESCE((p_insert_payload->>'is_limited')::BOOLEAN, FALSE),
    CASE
      WHEN p_insert_payload ? 'pool_config'
        AND jsonb_typeof(p_insert_payload->'pool_config') = 'object'
      THEN p_insert_payload->'pool_config'
      ELSE '{}'::jsonb
    END
  )
  ON CONFLICT (id) DO UPDATE
  SET
    name = CASE
      WHEN p_update_payload ? 'name'
      THEN COALESCE(NULLIF(BTRIM(p_update_payload->>'name'), ''), public.characters.name)
      ELSE public.characters.name
    END,
    avatar_url = CASE
      WHEN p_update_payload ? 'avatar_url'
      THEN NULLIF(BTRIM(p_update_payload->>'avatar_url'), '')
      ELSE public.characters.avatar_url
    END,
    rarity = CASE
      WHEN p_update_payload ? 'rarity'
      THEN NULLIF(BTRIM(p_update_payload->>'rarity'), '')::INTEGER
      ELSE public.characters.rarity
    END,
    type = CASE
      WHEN p_update_payload ? 'type'
      THEN COALESCE(NULLIF(BTRIM(p_update_payload->>'type'), ''), public.characters.type)
      ELSE public.characters.type
    END;

  INSERT INTO public.character_id_aliases (
    source,
    alias_id,
    character_id,
    is_primary,
    note
  )
  SELECT
    BTRIM(alias_entry.value->>'source'),
    BTRIM(alias_entry.value->>'alias_id'),
    BTRIM(p_character_id),
    COALESCE((alias_entry.value->>'is_primary')::BOOLEAN, FALSE),
    NULLIF(BTRIM(alias_entry.value->>'note'), '')
  FROM jsonb_array_elements(p_alias_rows) AS alias_entry(value)
  WHERE jsonb_typeof(alias_entry.value) = 'object'
    AND COALESCE(BTRIM(alias_entry.value->>'source'), '') <> ''
    AND COALESCE(BTRIM(alias_entry.value->>'alias_id'), '') <> ''
  ON CONFLICT (source, alias_id) DO UPDATE
  SET
    character_id = EXCLUDED.character_id,
    is_primary = EXCLUDED.is_primary,
    note = EXCLUDED.note,
    updated_at = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_sync_character_with_aliases(TEXT, JSONB, JSONB, JSONB) TO authenticated;

COMMENT ON FUNCTION public.admin_sync_character_with_aliases(TEXT, JSONB, JSONB, JSONB) IS
  '管理端原子化同步单个角色/武器及其 alias；已存在时仅更新 name/rarity/type/avatar_url。';

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 077: admin_sync_character_with_aliases RPC created';
END $$;
-- <<< END MIGRATION: archive/077_add_admin_sync_character_rpc.sql

-- >>> BEGIN MIGRATION: archive/078_harden_admin_entity_upsert_rpcs.sql
-- ============================================
-- 078: 强化管理端实体原子写入 RPC
--
-- 目标:
--   1. 扩展 admin_sync_character_with_aliases，使其也可用于手工角色管理
--   2. 新增 admin_upsert_pool_with_aliases，使卡池主记录、alias、初始 pool_characters 同事务写入
--   3. 统一由数据库端负责 DATA-NEW-008 的角色/卡池 alias 一致性
-- ============================================

CREATE OR REPLACE FUNCTION public.admin_upsert_character_with_aliases(
  p_character_id TEXT,
  p_insert_payload JSONB,
  p_update_payload JSONB DEFAULT '{}'::jsonb,
  p_alias_rows JSONB DEFAULT '[]'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'only super_admin can sync characters';
  END IF;

  IF COALESCE(BTRIM(p_character_id), '') = '' THEN
    RAISE EXCEPTION 'p_character_id is required';
  END IF;

  IF p_insert_payload IS NULL OR jsonb_typeof(p_insert_payload) <> 'object' THEN
    RAISE EXCEPTION 'p_insert_payload must be a JSON object';
  END IF;

  IF p_update_payload IS NULL THEN
    p_update_payload := '{}'::jsonb;
  END IF;

  IF jsonb_typeof(p_update_payload) <> 'object' THEN
    RAISE EXCEPTION 'p_update_payload must be a JSON object';
  END IF;

  IF p_alias_rows IS NULL THEN
    p_alias_rows := '[]'::jsonb;
  END IF;

  IF jsonb_typeof(p_alias_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_alias_rows must be a JSON array';
  END IF;

  INSERT INTO public.characters (
    id,
    name,
    avatar_url,
    rarity,
    type,
    aliases,
    is_limited,
    pool_config
  )
  VALUES (
    BTRIM(p_character_id),
    BTRIM(p_insert_payload->>'name'),
    NULLIF(BTRIM(p_insert_payload->>'avatar_url'), ''),
    NULLIF(BTRIM(p_insert_payload->>'rarity'), '')::INTEGER,
    COALESCE(NULLIF(BTRIM(p_insert_payload->>'type'), ''), 'character'),
    CASE
      WHEN p_insert_payload ? 'aliases'
        AND jsonb_typeof(p_insert_payload->'aliases') = 'array'
      THEN ARRAY(
        SELECT jsonb_array_elements_text(p_insert_payload->'aliases')
      )
      ELSE NULL
    END,
    COALESCE((p_insert_payload->>'is_limited')::BOOLEAN, FALSE),
    CASE
      WHEN p_insert_payload ? 'pool_config'
        AND jsonb_typeof(p_insert_payload->'pool_config') = 'object'
      THEN p_insert_payload->'pool_config'
      ELSE '{}'::jsonb
    END
  )
  ON CONFLICT (id) DO UPDATE
  SET
    name = CASE
      WHEN p_update_payload ? 'name'
      THEN COALESCE(NULLIF(BTRIM(p_update_payload->>'name'), ''), public.characters.name)
      ELSE public.characters.name
    END,
    avatar_url = CASE
      WHEN p_update_payload ? 'avatar_url'
      THEN NULLIF(BTRIM(p_update_payload->>'avatar_url'), '')
      ELSE public.characters.avatar_url
    END,
    rarity = CASE
      WHEN p_update_payload ? 'rarity'
      THEN NULLIF(BTRIM(p_update_payload->>'rarity'), '')::INTEGER
      ELSE public.characters.rarity
    END,
    type = CASE
      WHEN p_update_payload ? 'type'
      THEN COALESCE(NULLIF(BTRIM(p_update_payload->>'type'), ''), public.characters.type)
      ELSE public.characters.type
    END,
    aliases = CASE
      WHEN p_update_payload ? 'aliases'
        AND jsonb_typeof(p_update_payload->'aliases') = 'array'
      THEN ARRAY(
        SELECT jsonb_array_elements_text(p_update_payload->'aliases')
      )
      WHEN p_update_payload ? 'aliases'
        AND jsonb_typeof(p_update_payload->'aliases') = 'null'
      THEN NULL
      ELSE public.characters.aliases
    END,
    is_limited = CASE
      WHEN p_update_payload ? 'is_limited'
        AND jsonb_typeof(p_update_payload->'is_limited') = 'boolean'
      THEN (p_update_payload->>'is_limited')::BOOLEAN
      ELSE public.characters.is_limited
    END,
    pool_config = CASE
      WHEN p_update_payload ? 'pool_config'
        AND jsonb_typeof(p_update_payload->'pool_config') = 'object'
      THEN p_update_payload->'pool_config'
      WHEN p_update_payload ? 'pool_config'
        AND jsonb_typeof(p_update_payload->'pool_config') = 'null'
      THEN NULL
      ELSE public.characters.pool_config
    END;

  INSERT INTO public.character_id_aliases (
    source,
    alias_id,
    character_id,
    is_primary,
    note
  )
  SELECT
    BTRIM(alias_entry.value->>'source'),
    BTRIM(alias_entry.value->>'alias_id'),
    BTRIM(p_character_id),
    COALESCE((alias_entry.value->>'is_primary')::BOOLEAN, FALSE),
    NULLIF(BTRIM(alias_entry.value->>'note'), '')
  FROM jsonb_array_elements(p_alias_rows) AS alias_entry(value)
  WHERE jsonb_typeof(alias_entry.value) = 'object'
    AND COALESCE(BTRIM(alias_entry.value->>'source'), '') <> ''
    AND COALESCE(BTRIM(alias_entry.value->>'alias_id'), '') <> ''
  ON CONFLICT (source, alias_id) DO UPDATE
  SET
    character_id = EXCLUDED.character_id,
    is_primary = EXCLUDED.is_primary,
    note = EXCLUDED.note,
    updated_at = NOW();
END;
$$;

COMMENT ON FUNCTION public.admin_upsert_character_with_aliases(TEXT, JSONB, JSONB, JSONB) IS
  '管理端原子化写入单个角色/武器及其 alias；已存在时可按 update payload 更新完整角色字段。';

CREATE OR REPLACE FUNCTION public.admin_sync_character_with_aliases(
  p_character_id TEXT,
  p_insert_payload JSONB,
  p_update_payload JSONB DEFAULT '{}'::jsonb,
  p_alias_rows JSONB DEFAULT '[]'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_upsert_character_with_aliases(
    p_character_id,
    p_insert_payload,
    p_update_payload,
    p_alias_rows
  );
END;
$$;

COMMENT ON FUNCTION public.admin_sync_character_with_aliases(TEXT, JSONB, JSONB, JSONB) IS
  '兼容旧调用方的角色同步 RPC；实际委托给 admin_upsert_character_with_aliases。';

CREATE OR REPLACE FUNCTION public.admin_upsert_pool_with_aliases(
  p_pool_id TEXT,
  p_insert_payload JSONB,
  p_update_payload JSONB DEFAULT '{}'::jsonb,
  p_alias_rows JSONB DEFAULT '[]'::jsonb,
  p_pool_character_rows JSONB DEFAULT '[]'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'only super_admin can manage pools';
  END IF;

  IF COALESCE(BTRIM(p_pool_id), '') = '' THEN
    RAISE EXCEPTION 'p_pool_id is required';
  END IF;

  IF p_insert_payload IS NULL OR jsonb_typeof(p_insert_payload) <> 'object' THEN
    RAISE EXCEPTION 'p_insert_payload must be a JSON object';
  END IF;

  IF p_update_payload IS NULL THEN
    p_update_payload := '{}'::jsonb;
  END IF;

  IF jsonb_typeof(p_update_payload) <> 'object' THEN
    RAISE EXCEPTION 'p_update_payload must be a JSON object';
  END IF;

  IF p_alias_rows IS NULL THEN
    p_alias_rows := '[]'::jsonb;
  END IF;

  IF jsonb_typeof(p_alias_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_alias_rows must be a JSON array';
  END IF;

  IF p_pool_character_rows IS NULL THEN
    p_pool_character_rows := '[]'::jsonb;
  END IF;

  IF jsonb_typeof(p_pool_character_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_pool_character_rows must be a JSON array';
  END IF;

  INSERT INTO public.pools (
    user_id,
    pool_id,
    name,
    type,
    locked,
    is_limited_weapon,
    description,
    start_time,
    end_time,
    banner_url,
    featured_characters,
    up_character
  )
  VALUES (
    auth.uid(),
    BTRIM(p_pool_id),
    BTRIM(p_insert_payload->>'name'),
    COALESCE(NULLIF(BTRIM(p_insert_payload->>'type'), ''), 'limited'),
    COALESCE((p_insert_payload->>'locked')::BOOLEAN, FALSE),
    CASE
      WHEN p_insert_payload ? 'is_limited_weapon'
        AND jsonb_typeof(p_insert_payload->'is_limited_weapon') = 'boolean'
      THEN (p_insert_payload->>'is_limited_weapon')::BOOLEAN
      ELSE NULL
    END,
    NULLIF(BTRIM(p_insert_payload->>'description'), ''),
    NULLIF(BTRIM(p_insert_payload->>'start_time'), '')::TIMESTAMPTZ,
    NULLIF(BTRIM(p_insert_payload->>'end_time'), '')::TIMESTAMPTZ,
    NULLIF(BTRIM(p_insert_payload->>'banner_url'), ''),
    CASE
      WHEN p_insert_payload ? 'featured_characters'
        AND jsonb_typeof(p_insert_payload->'featured_characters') = 'array'
      THEN ARRAY(
        SELECT jsonb_array_elements_text(p_insert_payload->'featured_characters')
      )
      ELSE NULL
    END,
    NULLIF(BTRIM(p_insert_payload->>'up_character'), '')
  )
  ON CONFLICT (pool_id) DO UPDATE
  SET
    name = CASE
      WHEN p_update_payload ? 'name'
      THEN COALESCE(NULLIF(BTRIM(p_update_payload->>'name'), ''), public.pools.name)
      ELSE public.pools.name
    END,
    type = CASE
      WHEN p_update_payload ? 'type'
      THEN COALESCE(NULLIF(BTRIM(p_update_payload->>'type'), ''), public.pools.type)
      ELSE public.pools.type
    END,
    locked = CASE
      WHEN p_update_payload ? 'locked'
        AND jsonb_typeof(p_update_payload->'locked') = 'boolean'
      THEN (p_update_payload->>'locked')::BOOLEAN
      ELSE public.pools.locked
    END,
    is_limited_weapon = CASE
      WHEN p_update_payload ? 'is_limited_weapon'
        AND jsonb_typeof(p_update_payload->'is_limited_weapon') = 'boolean'
      THEN (p_update_payload->>'is_limited_weapon')::BOOLEAN
      WHEN p_update_payload ? 'is_limited_weapon'
        AND jsonb_typeof(p_update_payload->'is_limited_weapon') = 'null'
      THEN NULL
      ELSE public.pools.is_limited_weapon
    END,
    description = CASE
      WHEN p_update_payload ? 'description'
      THEN NULLIF(BTRIM(p_update_payload->>'description'), '')
      ELSE public.pools.description
    END,
    start_time = CASE
      WHEN p_update_payload ? 'start_time'
      THEN NULLIF(BTRIM(p_update_payload->>'start_time'), '')::TIMESTAMPTZ
      ELSE public.pools.start_time
    END,
    end_time = CASE
      WHEN p_update_payload ? 'end_time'
      THEN NULLIF(BTRIM(p_update_payload->>'end_time'), '')::TIMESTAMPTZ
      ELSE public.pools.end_time
    END,
    banner_url = CASE
      WHEN p_update_payload ? 'banner_url'
      THEN NULLIF(BTRIM(p_update_payload->>'banner_url'), '')
      ELSE public.pools.banner_url
    END,
    featured_characters = CASE
      WHEN p_update_payload ? 'featured_characters'
        AND jsonb_typeof(p_update_payload->'featured_characters') = 'array'
      THEN ARRAY(
        SELECT jsonb_array_elements_text(p_update_payload->'featured_characters')
      )
      WHEN p_update_payload ? 'featured_characters'
        AND jsonb_typeof(p_update_payload->'featured_characters') = 'null'
      THEN NULL
      ELSE public.pools.featured_characters
    END,
    up_character = CASE
      WHEN p_update_payload ? 'up_character'
      THEN NULLIF(BTRIM(p_update_payload->>'up_character'), '')
      ELSE public.pools.up_character
    END;

  INSERT INTO public.pool_id_aliases (
    source,
    alias_id,
    pool_id,
    is_primary,
    note
  )
  SELECT
    BTRIM(alias_entry.value->>'source'),
    BTRIM(alias_entry.value->>'alias_id'),
    BTRIM(p_pool_id),
    COALESCE((alias_entry.value->>'is_primary')::BOOLEAN, FALSE),
    NULLIF(BTRIM(alias_entry.value->>'note'), '')
  FROM jsonb_array_elements(p_alias_rows) AS alias_entry(value)
  WHERE jsonb_typeof(alias_entry.value) = 'object'
    AND COALESCE(BTRIM(alias_entry.value->>'source'), '') <> ''
    AND COALESCE(BTRIM(alias_entry.value->>'alias_id'), '') <> ''
  ON CONFLICT (source, alias_id) DO UPDATE
  SET
    pool_id = EXCLUDED.pool_id,
    is_primary = EXCLUDED.is_primary,
    note = EXCLUDED.note,
    updated_at = NOW();

  INSERT INTO public.pool_characters (
    pool_id,
    character_id,
    is_up
  )
  SELECT
    BTRIM(p_pool_id),
    BTRIM(pool_character_entry.value->>'character_id'),
    COALESCE((pool_character_entry.value->>'is_up')::BOOLEAN, FALSE)
  FROM jsonb_array_elements(p_pool_character_rows) AS pool_character_entry(value)
  WHERE jsonb_typeof(pool_character_entry.value) = 'object'
    AND COALESCE(BTRIM(pool_character_entry.value->>'character_id'), '') <> ''
  ON CONFLICT (pool_id, character_id) DO UPDATE
  SET
    is_up = EXCLUDED.is_up;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_character_with_aliases(TEXT, JSONB, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_sync_character_with_aliases(TEXT, JSONB, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_pool_with_aliases(TEXT, JSONB, JSONB, JSONB, JSONB) TO authenticated;

COMMENT ON FUNCTION public.admin_upsert_pool_with_aliases(TEXT, JSONB, JSONB, JSONB, JSONB) IS
  '管理端原子化写入卡池、pool_id alias 与初始 pool_characters。';

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 078: admin entity upsert RPCs hardened';
END $$;
-- <<< END MIGRATION: archive/078_harden_admin_entity_upsert_rpcs.sql

-- >>> BEGIN MIGRATION: archive/079_replace_public_profiles_view_with_security_invoker.sql
-- ============================================
-- 079: 将 public_profiles 改为 security_invoker 视图
--
-- 背景:
--   068 为了公开用户名 / 角色，创建了 public.public_profiles 视图，
--   但它直接读取 public.profiles，在 PostgreSQL 中默认按视图拥有者权限执行，
--   会被 Supabase adviser 标记为 security_definer_view。
--
-- 目标:
--   1. 保持 public.public_profiles 这个对外读取接口不变
--   2. 让视图本身改为 security_invoker = true，消除 adviser 报错
--   3. 通过独立的公开索引表承载对外可见字段，避免直接放宽 profiles 的 RLS
-- ============================================

CREATE TABLE IF NOT EXISTS public.public_profile_cache (
  id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  username TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'admin', 'super_admin')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.public_profile_cache IS
  'public_profiles 的底层公开索引表，仅缓存可对外展示的 id / username / role。';

ALTER TABLE public.public_profile_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_profile_cache_select_all" ON public.public_profile_cache;
CREATE POLICY "public_profile_cache_select_all" ON public.public_profile_cache
  FOR SELECT USING (true);

REVOKE ALL ON public.public_profile_cache FROM anon, authenticated;
GRANT SELECT ON public.public_profile_cache TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_public_profile_cache()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.public_profile_cache
    WHERE id = OLD.id;

    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
    DELETE FROM public.public_profile_cache
    WHERE id = OLD.id;
  END IF;

  INSERT INTO public.public_profile_cache (id, username, role, updated_at)
  VALUES (NEW.id, NEW.username, NEW.role, NOW())
  ON CONFLICT (id) DO UPDATE
  SET
    username = EXCLUDED.username,
    role = EXCLUDED.role,
    updated_at = NOW();

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_public_profile_cache() IS
  '同步 profiles 到 public_profile_cache，供 security_invoker public_profiles 视图读取。';

DROP TRIGGER IF EXISTS sync_public_profile_cache ON public.profiles;
CREATE TRIGGER sync_public_profile_cache
  AFTER INSERT OR UPDATE OF id, username, role OR DELETE
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_public_profile_cache();

INSERT INTO public.public_profile_cache (id, username, role, updated_at)
SELECT
  p.id,
  p.username,
  p.role,
  NOW()
FROM public.profiles AS p
ON CONFLICT (id) DO UPDATE
SET
  username = EXCLUDED.username,
  role = EXCLUDED.role,
  updated_at = NOW();

CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = true) AS
SELECT
  id,
  username,
  role
FROM public.public_profile_cache;

GRANT SELECT ON public.public_profiles TO anon, authenticated;

COMMENT ON VIEW public.public_profiles IS
  '对外公开的用户简档视图（security_invoker），仅暴露 id / username / role。';

DO $$
DECLARE
  profile_cache_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO profile_cache_count
  FROM public.public_profile_cache;

  RAISE NOTICE '✅ Migration 079: public_profiles 已切换为 security_invoker 视图';
  RAISE NOTICE '   public_profile_cache rows: %', profile_cache_count;
END $$;
-- <<< END MIGRATION: archive/079_replace_public_profiles_view_with_security_invoker.sql

-- >>> BEGIN MIGRATION: archive/080_retire_page_content_management.sql
-- ============================================
-- 080: 退役无用的页面管理能力
--
-- 背景:
--   page_content 仅剩超管后台维护链路在读取，
--   首页、公告、导航、权限判断与 bootstrap 数据链已不再依赖它。
--
-- 目标:
--   1. 移除 page_content 表及其触发器 / 策略残留
--   2. 为前端后台入口退役提供对应的数据库收口
-- ============================================

DROP TABLE IF EXISTS public.page_content CASCADE;

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 080: page_content 已退役';
END $$;
-- <<< END MIGRATION: archive/080_retire_page_content_management.sql

-- >>> BEGIN MIGRATION: archive/081_remove_blacklist_feature.sql
-- ============================================
-- 081: 移除无用黑名单功能
--
-- 背景:
--   黑名单 / 邮箱黑白名单验证链当前已无运行时调用，
--   仅剩超管后台与历史 schema 残留。
--
-- 目标:
--   1. 删除 blacklist 表与旧邮箱黑白名单表
--   2. 删除 is_email_blacklisted / validate_email_domain 等旧函数
--   3. 收口无效的防刷旧链，避免继续误导维护者
-- ============================================

DROP FUNCTION IF EXISTS public.is_email_blacklisted(TEXT);
DROP FUNCTION IF EXISTS public.validate_email_domain(TEXT);

DROP TABLE IF EXISTS public.blacklist CASCADE;
DROP TABLE IF EXISTS public.email_blacklist CASCADE;
DROP TABLE IF EXISTS public.email_whitelist CASCADE;

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 081: 黑名单与邮箱黑白名单旧链已移除';
END $$;
-- <<< END MIGRATION: archive/081_remove_blacklist_feature.sql

-- >>> BEGIN MIGRATION: archive/082_fix_global_stats_exclude_info_book_resource.sql
-- ============================================
-- 082: 修复全服统计中的情报书十连资源口径
--
-- 背景:
--   get_global_stats() 当前只排除了 gift / 免费十连，
--   但没有识别“上一限定池 60 抽后，下一限定池前 10 抽为情报书”的收费例外。
--   前端全服资源卡因此会把情报书十连误计入嵌晶玉消耗。
--
-- 目标:
--   1. 在 RPC 内按“用户 + 限定池轮换顺序”推导情报书十连
--   2. 输出各池 chargedPulls 与全局 chargedCharacterPulls / chargedWeaponPulls
--   3. 保持总抽数、保底、出货统计继续按有效抽数（含情报书）计算
-- ============================================

CREATE OR REPLACE FUNCTION public.get_global_stats()
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH history_base AS MATERIALIZED (
  SELECT
    h.pool_id,
    h.user_id,
    h.record_id,
    h.rarity,
    h.special_type,
    h.is_free,
    h.is_standard,
    h.character_name,
    h.item_name,
    p.type AS pool_type,
    p.up_character
  FROM public.history AS h
  LEFT JOIN public.pools AS p ON p.pool_id = h.pool_id
),
history_enriched AS MATERIALIZED (
  SELECT
    hb.pool_id,
    hb.user_id,
    hb.record_id,
    hb.rarity,
    hb.special_type,
    hb.is_free,
    CASE
      WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN true
      WHEN hb.rarity = 6 AND hb.up_character IS NOT NULL THEN
        NOT (
          COALESCE(hb.character_name, '') ILIKE '%' || hb.up_character || '%'
          OR COALESCE(hb.item_name, '') ILIKE '%' || hb.up_character || '%'
          OR hb.up_character ILIKE '%' || COALESCE(hb.character_name, hb.item_name, '') || '%'
        )
      ELSE COALESCE(hb.is_standard, false)
    END AS is_standard_calc,
    COALESCE(
      CASE
        WHEN hb.pool_type IN ('limited', 'limited_character') THEN 'limited'
        WHEN hb.pool_type IN ('weapon', 'limited_weapon') THEN 'weapon'
        WHEN hb.pool_type IN ('standard', 'beginner') THEN 'standard'
        ELSE NULL
      END,
      CASE
        WHEN hb.pool_id IN ('standard', 'beginner') THEN 'standard'
        WHEN split_part(hb.pool_id, '_', 1) = 'special' THEN 'limited'
        WHEN split_part(hb.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
        WHEN
          CASE
            WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN true
            WHEN hb.rarity = 6 AND hb.up_character IS NOT NULL THEN
              NOT (
                COALESCE(hb.character_name, '') ILIKE '%' || hb.up_character || '%'
                OR COALESCE(hb.item_name, '') ILIKE '%' || hb.up_character || '%'
                OR hb.up_character ILIKE '%' || COALESCE(hb.character_name, hb.item_name, '') || '%'
              )
            ELSE COALESCE(hb.is_standard, false)
          END
        THEN 'standard'
        ELSE 'limited'
      END
    ) AS classified_pool_type
  FROM history_base AS hb
),
valid_pulls AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    record_id,
    rarity,
    is_standard_calc,
    classified_pool_type
  FROM history_enriched
  WHERE special_type IS DISTINCT FROM 'gift'
    AND (is_free IS NOT TRUE)
),
limited_pool_sequence AS MATERIALIZED (
  SELECT
    p.pool_id,
    LEAD(p.pool_id) OVER (
      ORDER BY COALESCE(p.start_time, p.created_at), p.pool_id
    ) AS next_pool_id
  FROM public.pools AS p
  WHERE p.type IN ('limited', 'limited_character')
),
limited_paid_pool_counts AS MATERIALIZED (
  SELECT
    vp.user_id,
    vp.pool_id,
    COUNT(*) AS paid_pull_count
  FROM valid_pulls AS vp
  WHERE vp.classified_pool_type = 'limited'
  GROUP BY vp.user_id, vp.pool_id
),
info_book_credits AS MATERIALIZED (
  SELECT
    lpc.user_id,
    lps.next_pool_id AS pool_id,
    SUM(10) AS credit_pull_count
  FROM limited_paid_pool_counts AS lpc
  JOIN limited_pool_sequence AS lps
    ON lps.pool_id = lpc.pool_id
  WHERE lps.next_pool_id IS NOT NULL
    AND lpc.paid_pull_count >= 60
  GROUP BY lpc.user_id, lps.next_pool_id
),
limited_paid_pull_order AS MATERIALIZED (
  SELECT
    vp.user_id,
    vp.pool_id,
    vp.record_id,
    ROW_NUMBER() OVER (
      PARTITION BY vp.user_id, vp.pool_id
      ORDER BY vp.record_id
    ) AS paid_pull_order
  FROM valid_pulls AS vp
  WHERE vp.classified_pool_type = 'limited'
),
info_book_pulls AS MATERIALIZED (
  SELECT
    lpo.user_id,
    lpo.pool_id,
    lpo.record_id
  FROM limited_paid_pull_order AS lpo
  JOIN info_book_credits AS ibc
    ON ibc.user_id = lpo.user_id
   AND ibc.pool_id = lpo.pool_id
  WHERE lpo.paid_pull_order <= ibc.credit_pull_count
),
charged_valid_pulls AS MATERIALIZED (
  SELECT vp.*
  FROM valid_pulls AS vp
  LEFT JOIN info_book_pulls AS ibp
    ON ibp.user_id = vp.user_id
   AND ibp.pool_id = vp.pool_id
   AND ibp.record_id = vp.record_id
  WHERE ibp.record_id IS NULL
),
valid_counts AS MATERIALIZED (
  SELECT
    COUNT(*) AS total_pulls,
    COUNT(DISTINCT user_id) AS total_contributors,
    COUNT(*) FILTER (WHERE rarity = 6) AS six_star_total,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = false) AS six_star_limited,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = true) AS six_star_standard,
    COUNT(*) FILTER (WHERE rarity = 5) AS five_star,
    COUNT(*) FILTER (WHERE rarity <= 4) AS four_star
  FROM valid_pulls
),
history_counts AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE special_type IS DISTINCT FROM 'gift') AS total_pulls_with_free,
    COUNT(*) FILTER (WHERE special_type IS DISTINCT FROM 'gift' AND is_free = true) AS free_pull_count,
    COUNT(*) FILTER (WHERE special_type = 'gift') AS gift_total,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'limited'
    ) AS char_gift,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'weapon'
        AND is_standard_calc = false
    ) AS weapon_gift_limited,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'weapon'
        AND is_standard_calc = true
    ) AS weapon_gift_standard
  FROM history_enriched
),
type_counts AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE rarity = 6) AS six,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = false) AS six_star_limited,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = true) AS six_star_standard,
    COUNT(*) FILTER (WHERE rarity = 5) AS five,
    COUNT(*) FILTER (WHERE rarity <= 4) AS four
  FROM valid_pulls
  GROUP BY classified_pool_type
),
charged_counts AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE classified_pool_type IN ('limited', 'standard')) AS charged_character_pulls,
    COUNT(*) FILTER (WHERE classified_pool_type = 'weapon') AS charged_weapon_pulls,
    COUNT(*) FILTER (WHERE classified_pool_type = 'limited') AS charged_limited_pulls,
    COUNT(*) FILTER (WHERE classified_pool_type = 'standard') AS charged_standard_pulls,
    COUNT(*) FILTER (WHERE classified_pool_type = 'weapon') AS charged_weapon_type_pulls,
    (SELECT COUNT(*) FROM info_book_pulls) AS info_book_pull_count
  FROM charged_valid_pulls
),
ordered_valid AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    rarity,
    is_standard_calc,
    classified_pool_type,
    record_id,
    ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) AS rn
  FROM valid_pulls
),
six_pity AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    is_standard_calc,
    classified_pool_type,
    rn,
    LEAST(
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0),
      80
    ) AS pity
  FROM ordered_valid
  WHERE rarity = 6
),
limited_first_up AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    MIN(rn) FILTER (WHERE is_standard_calc = false) AS first_up_rn
  FROM six_pity
  WHERE classified_pool_type = 'limited'
  GROUP BY pool_id, user_id
),
limited_six_pity AS MATERIALIZED (
  SELECT
    sp.pool_id,
    sp.user_id,
    sp.is_standard_calc,
    sp.rn,
    sp.pity,
    CASE
      WHEN sp.is_standard_calc = false
        AND sp.rn = 120
        AND COALESCE(lfu.first_up_rn, 999999) = 120
      THEN true
      ELSE false
    END AS is_spark
  FROM six_pity AS sp
  LEFT JOIN limited_first_up AS lfu
    ON lfu.pool_id = sp.pool_id
   AND lfu.user_id = sp.user_id
  WHERE sp.classified_pool_type = 'limited'
),
pity_ranges AS MATERIALIZED (
  SELECT
    classified_pool_type,
    is_standard_calc,
    CASE
      WHEN pity BETWEEN 1 AND 10 THEN '01-10'
      WHEN pity BETWEEN 11 AND 20 THEN '11-20'
      WHEN pity BETWEEN 21 AND 30 THEN '21-30'
      WHEN pity BETWEEN 31 AND 40 THEN '31-40'
      WHEN pity BETWEEN 41 AND 50 THEN '41-50'
      WHEN pity BETWEEN 51 AND 60 THEN '51-60'
      WHEN pity BETWEEN 61 AND 70 THEN '61-70'
      WHEN pity BETWEEN 71 AND 80 THEN '71-80'
      WHEN pity BETWEEN 81 AND 90 THEN '81-90'
      ELSE '91+'
    END AS range_label
  FROM six_pity
),
global_distribution_rows AS MATERIALIZED (
  SELECT
    range_label,
    COUNT(*) FILTER (WHERE is_standard_calc = false) AS limited_count,
    COUNT(*) FILTER (WHERE is_standard_calc = true) AS standard_count
  FROM pity_ranges
  GROUP BY range_label
),
type_distribution_rows AS MATERIALIZED (
  SELECT
    classified_pool_type,
    range_label,
    COUNT(*) FILTER (WHERE is_standard_calc = false) AS limited_count,
    COUNT(*) FILTER (WHERE is_standard_calc = true) AS standard_count
  FROM pity_ranges
  GROUP BY classified_pool_type, range_label
),
global_distribution AS MATERIALIZED (
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'range', REPLACE(range_label, '01-10', '1-10'),
        'limited', limited_count,
        'standard', standard_count
      )
      ORDER BY range_label
    ),
    '[]'::json
  ) AS distribution
  FROM global_distribution_rows
),
type_distributions AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COALESCE(
      json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        )
        ORDER BY range_label
      ),
      '[]'::json
    ) AS distribution
  FROM type_distribution_rows
  GROUP BY classified_pool_type
),
global_avg_pity AS MATERIALIZED (
  SELECT COALESCE(ROUND(AVG(pity)::numeric, 1), 0) AS avg_pity
  FROM six_pity
),
type_pity_stats AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COALESCE(ROUND(AVG(pity)::numeric, 1), 0) AS avg_pity,
    COALESCE(ROUND(AVG(pity) FILTER (WHERE is_standard_calc = false)::numeric, 1), 0) AS avg_pity_up
  FROM six_pity
  GROUP BY classified_pool_type
),
limited_pity_stats AS MATERIALIZED (
  SELECT
    COALESCE(ROUND(AVG(pity)::numeric, 1), 0) AS avg_pity,
    COALESCE(ROUND(AVG(pity) FILTER (WHERE is_standard_calc = false AND NOT is_spark)::numeric, 1), 0) AS avg_pity_up,
    COUNT(DISTINCT user_id) FILTER (WHERE is_spark = true) AS spark_count
  FROM limited_six_pity
),
total_users AS MATERIALIZED (
  SELECT COUNT(*) AS total_users
  FROM public.profiles
)
SELECT json_build_object(
  'totalPulls', COALESCE(vc.total_pulls, 0),
  'totalPullsWithFree', COALESCE(hc.total_pulls_with_free, 0),
  'freePullCount', COALESCE(hc.free_pull_count, 0),
  'chargedCharacterPulls', COALESCE(cc.charged_character_pulls, 0),
  'chargedWeaponPulls', COALESCE(cc.charged_weapon_pulls, 0),
  'infoBookPullCount', COALESCE(cc.info_book_pull_count, 0),
  'totalUsers', COALESCE(tu.total_users, 0),
  'totalContributors', COALESCE(vc.total_contributors, 0),
  'sixStarTotal', COALESCE(vc.six_star_total, 0),
  'sixStarLimited', COALESCE(vc.six_star_limited, 0),
  'sixStarStandard', COALESCE(vc.six_star_standard, 0),
  'fiveStar', COALESCE(vc.five_star, 0),
  'fourStar', COALESCE(vc.four_star, 0),
  'avgPity', COALESCE(gap.avg_pity, 0),
  'counts', json_build_object(
    '6', COALESCE(vc.six_star_limited, 0),
    '6_std', COALESCE(vc.six_star_standard, 0),
    '5', COALESCE(vc.five_star, 0),
    '4', COALESCE(vc.four_star, 0)
  ),
  'distribution', COALESCE(gd.distribution, '[]'::json),
  'byType', json_build_object(
    'limited', json_build_object(
      'total', COALESCE(tc_limited.total, 0),
      'chargedPulls', COALESCE(cc.charged_limited_pulls, 0),
      'six', COALESCE(tc_limited.six, 0),
      'sixStarLimited', COALESCE(tc_limited.six_star_limited, 0),
      'sixStarStandard', COALESCE(tc_limited.six_star_standard, 0),
      'avgPity', COALESCE(lps.avg_pity, 0),
      'avgPityUp', COALESCE(lps.avg_pity_up, 0),
      'sparkCount', COALESCE(lps.spark_count, 0),
      'counts', json_build_object(
        '6', COALESCE(tc_limited.six_star_limited, 0),
        '6_std', COALESCE(tc_limited.six_star_standard, 0),
        '5', COALESCE(tc_limited.five, 0),
        '4', COALESCE(tc_limited.four, 0)
      ),
      'distribution', COALESCE(td_limited.distribution, '[]'::json)
    ),
    'weapon', json_build_object(
      'total', COALESCE(tc_weapon.total, 0),
      'chargedPulls', COALESCE(cc.charged_weapon_type_pulls, 0),
      'six', COALESCE(tc_weapon.six, 0),
      'sixStarLimited', COALESCE(tc_weapon.six_star_limited, 0),
      'sixStarStandard', COALESCE(tc_weapon.six_star_standard, 0),
      'avgPity', COALESCE(tps_weapon.avg_pity, 0),
      'avgPityUp', COALESCE(tps_weapon.avg_pity_up, 0),
      'counts', json_build_object(
        '6', COALESCE(tc_weapon.six_star_limited, 0),
        '6_std', COALESCE(tc_weapon.six_star_standard, 0),
        '5', COALESCE(tc_weapon.five, 0),
        '4', COALESCE(tc_weapon.four, 0)
      ),
      'distribution', COALESCE(td_weapon.distribution, '[]'::json)
    ),
    'standard', json_build_object(
      'total', COALESCE(tc_standard.total, 0),
      'chargedPulls', COALESCE(cc.charged_standard_pulls, 0),
      'six', COALESCE(tc_standard.six, 0),
      'sixStarLimited', 0,
      'sixStarStandard', COALESCE(tc_standard.six, 0),
      'avgPity', COALESCE(tps_standard.avg_pity, 0),
      'counts', json_build_object(
        '6', 0,
        '6_std', COALESCE(tc_standard.six, 0),
        '5', COALESCE(tc_standard.five, 0),
        '4', COALESCE(tc_standard.four, 0)
      ),
      'distribution', COALESCE(td_standard.distribution, '[]'::json)
    )
  ),
  'charGift', COALESCE(hc.char_gift, 0),
  'weaponGiftLimited', COALESCE(hc.weapon_gift_limited, 0),
  'weaponGiftStandard', COALESCE(hc.weapon_gift_standard, 0),
  'giftTotal', COALESCE(hc.gift_total, 0)
)
FROM valid_counts AS vc
CROSS JOIN history_counts AS hc
CROSS JOIN charged_counts AS cc
CROSS JOIN global_avg_pity AS gap
CROSS JOIN global_distribution AS gd
CROSS JOIN limited_pity_stats AS lps
CROSS JOIN total_users AS tu
LEFT JOIN type_counts AS tc_limited
  ON tc_limited.classified_pool_type = 'limited'
LEFT JOIN type_counts AS tc_weapon
  ON tc_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_counts AS tc_standard
  ON tc_standard.classified_pool_type = 'standard'
LEFT JOIN type_pity_stats AS tps_weapon
  ON tps_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_pity_stats AS tps_standard
  ON tps_standard.classified_pool_type = 'standard'
LEFT JOIN type_distributions AS td_limited
  ON td_limited.classified_pool_type = 'limited'
LEFT JOIN type_distributions AS td_weapon
  ON td_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_distributions AS td_standard
  ON td_standard.classified_pool_type = 'standard';
$$;

GRANT EXECUTE ON FUNCTION public.get_global_stats() TO anon, authenticated;

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 082: get_global_stats 已补 chargedPulls / 情报书资源口径';
END $$;
-- <<< END MIGRATION: archive/082_fix_global_stats_exclude_info_book_resource.sql

-- >>> BEGIN MIGRATION: archive/083_harden_admin_delete_user_foreign_keys.sql
-- ============================================
-- 083: 加固 admin-delete-user 的 auth.users 外键删除策略
--
-- 背景:
--   announcements.created_by / site_config.updated_by 仍直接引用 auth.users(id)，
--   默认行为会在超管删除管理员账号时阻塞 auth.admin.deleteUser()。
--
-- 目标:
--   1. 将仍保留的元数据外键改为 ON DELETE SET NULL
--   2. 保持公告 / 站点配置内容可保留，删除账号后仅清空“最后操作者”
-- ============================================

ALTER TABLE public.announcements
  DROP CONSTRAINT IF EXISTS announcements_created_by_fkey;

ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_created_by_fkey
  FOREIGN KEY (created_by)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;

ALTER TABLE public.site_config
  DROP CONSTRAINT IF EXISTS site_config_updated_by_fkey;

ALTER TABLE public.site_config
  ADD CONSTRAINT site_config_updated_by_fkey
  FOREIGN KEY (updated_by)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 083: admin-delete-user 外键策略已改为 ON DELETE SET NULL';
END $$;
-- <<< END MIGRATION: archive/083_harden_admin_delete_user_foreign_keys.sql

-- >>> BEGIN MIGRATION: archive/084_create_account_recovery_requests.sql
-- ============================================
-- 084: 新增账号恢复申请表
--
-- 目标:
--   1. 为“忘记密码/账号恢复”提供匿名申请入口
--   2. 将验证信息（账号个数、UID、昵称）交给超管审核
--   3. 不在未登录状态下直接开放改密，仅记录与处理恢复申请
-- ============================================

CREATE TABLE IF NOT EXISTS public.account_recovery_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  matched_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('password_reset', 'delete_account')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'verified', 'rejected', 'closed')),
  claimed_account_count INTEGER NOT NULL DEFAULT 1 CHECK (claimed_account_count BETWEEN 1 AND 20),
  verification_claims JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT,
  admin_note TEXT,
  handled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_recovery_requests_email
  ON public.account_recovery_requests(email);

CREATE INDEX IF NOT EXISTS idx_account_recovery_requests_status
  ON public.account_recovery_requests(status);

CREATE INDEX IF NOT EXISTS idx_account_recovery_requests_created_at
  ON public.account_recovery_requests(created_at DESC);

ALTER TABLE public.account_recovery_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can view recovery requests" ON public.account_recovery_requests;
CREATE POLICY "Super admins can view recovery requests"
  ON public.account_recovery_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS "Super admins can update recovery requests" ON public.account_recovery_requests;
CREATE POLICY "Super admins can update recovery requests"
  ON public.account_recovery_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

GRANT SELECT, UPDATE ON public.account_recovery_requests TO authenticated;

DROP TRIGGER IF EXISTS update_account_recovery_requests_updated_at ON public.account_recovery_requests;
CREATE TRIGGER update_account_recovery_requests_updated_at
  BEFORE UPDATE ON public.account_recovery_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.account_recovery_requests IS
  '匿名账号恢复申请：记录忘记密码或申请注销旧账号时提交的人工核验信息。';

COMMENT ON COLUMN public.account_recovery_requests.request_type IS
  '申请类型：password_reset=申请恢复登录，delete_account=申请注销旧账号。';

COMMENT ON COLUMN public.account_recovery_requests.verification_claims IS
  '申请人提交的身份核验信息，格式如 [{gameUid, nickName}]。';
-- <<< END MIGRATION: archive/084_create_account_recovery_requests.sql

-- >>> BEGIN MIGRATION: archive/085_restore_history_v2_columns.sql
-- ============================================
-- 085: 恢复 history 的 V2 导入字段与约束
--
-- 背景:
--   公开仓库的标准迁移链曾默认依赖 manual/legacy/042_v2_schema_upgrade.sql
--   提前补充 history 的官网导入字段；但 baseline / 新库起库时不会执行 manual/legacy。
--   结果是 game_uid / seq_id / pity / is_free 等字段在标准链中被后续迁移引用时可能缺失。
--
-- 目标:
--   1. 将 V2 导入链必须的 history 字段收口到标准迁移链
--   2. 补齐索引与唯一约束，和前端 cloudWriteService 的 upsert 口径保持一致
--   3. 兼容已存在旧字段/旧约束的数据库，保持幂等
-- ============================================

ALTER TABLE public.history
  ADD COLUMN IF NOT EXISTS batch_id TEXT,
  ADD COLUMN IF NOT EXISTS seq_id TEXT,
  ADD COLUMN IF NOT EXISTS pity INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_new BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS game_uid TEXT;

COMMENT ON COLUMN public.history.batch_id IS '批次 ID（十连分组）';
COMMENT ON COLUMN public.history.seq_id IS '官方序列号（去重用）';
COMMENT ON COLUMN public.history.pity IS '当前保底计数';
COMMENT ON COLUMN public.history.is_new IS '是否首次获得';
COMMENT ON COLUMN public.history.is_free IS '是否免费抽取';
COMMENT ON COLUMN public.history.game_uid IS '关联的游戏账号 UID';

CREATE INDEX IF NOT EXISTS idx_history_batch_id ON public.history(batch_id);
CREATE INDEX IF NOT EXISTS idx_history_seq_id ON public.history(seq_id);
CREATE INDEX IF NOT EXISTS idx_history_game_uid ON public.history(game_uid);
CREATE INDEX IF NOT EXISTS idx_history_user_record_id ON public.history(user_id, record_id);

UPDATE public.history
SET game_uid = 'legacy_' || LEFT(user_id::text, 8)
WHERE game_uid IS NULL AND seq_id IS NOT NULL;

UPDATE public.history
SET pity = 0
WHERE pity IS NULL OR pity < 0;

UPDATE public.history
SET pity = 80
WHERE pity > 80;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.history'::regclass
      AND conname = 'history_user_id_game_uid_seq_id_key'
  ) THEN
    ALTER TABLE public.history DROP CONSTRAINT history_user_id_game_uid_seq_id_key;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.history'::regclass
      AND conname = 'history_user_game_seq_unique'
  ) THEN
    ALTER TABLE public.history DROP CONSTRAINT history_user_game_seq_unique;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.history'::regclass
      AND conname = 'history_user_game_pool_seq_unique'
  ) THEN
    ALTER TABLE public.history
      ADD CONSTRAINT history_user_game_pool_seq_unique
      UNIQUE (user_id, game_uid, pool_id, seq_id);
  END IF;
END $$;

ALTER TABLE public.history DROP CONSTRAINT IF EXISTS history_pity_check;
ALTER TABLE public.history
  ADD CONSTRAINT history_pity_check
  CHECK (pity >= 0 AND pity <= 80);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'history'
      AND column_name IN ('batch_id', 'seq_id', 'pity', 'is_new', 'is_free', 'game_uid')
    GROUP BY table_name
    HAVING COUNT(*) = 6
  ) THEN
    RAISE EXCEPTION 'Migration 085 failed: history V2 columns are still incomplete';
  END IF;

  RAISE NOTICE '✅ Migration 085: history V2 columns / indexes / constraints are ready';
END $$;
-- <<< END MIGRATION: archive/085_restore_history_v2_columns.sql

-- >>> BEGIN MIGRATION: archive/086_add_global_stats_contributor_region_breakdown.sql
/*
-- ============================================
-- 086: 为全服统计补充国服 / 国际服贡献人数拆分
--
-- 背景:
--   统计页需要同时显示贡献总人数与国服 / 国际服拆分。
--   现有 get_global_stats() 只输出 totalContributors，缺少区服维度。
--
-- 目标:
--   1. 在 get_global_stats() 中输出 contributorsByRegion.cn / intl
--   2. 保持现有总抽数、情报书、保底、资源与分池统计口径不变
-- ============================================

CREATE OR REPLACE FUNCTION public.get_global_stats()
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH history_base AS MATERIALIZED (
  SELECT
    h.pool_id,
    h.user_id,
    h.record_id,
    h.rarity,
    h.server_id,
    h.region,
    h.special_type,
    h.is_free,
    h.is_standard,
    h.character_name,
    h.item_name,
    p.type AS pool_type,
    p.up_character
  FROM public.history AS h
  LEFT JOIN public.pools AS p ON p.pool_id = h.pool_id
),
history_enriched AS MATERIALIZED (
  SELECT
    hb.pool_id,
    hb.user_id,
    hb.record_id,
    hb.rarity,
    hb.server_id,
    hb.region,
    hb.special_type,
    hb.is_free,
    CASE
      WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN true
      WHEN hb.rarity = 6 AND hb.up_character IS NOT NULL THEN
        NOT (
          COALESCE(hb.character_name, '') ILIKE '%' || hb.up_character || '%'
          OR COALESCE(hb.item_name, '') ILIKE '%' || hb.up_character || '%'
          OR hb.up_character ILIKE '%' || COALESCE(hb.character_name, hb.item_name, '') || '%'
        )
      ELSE COALESCE(hb.is_standard, false)
    END AS is_standard_calc,
    COALESCE(
      CASE
        WHEN hb.pool_type IN ('limited', 'limited_character') THEN 'limited'
        WHEN hb.pool_type IN ('weapon', 'limited_weapon') THEN 'weapon'
        WHEN hb.pool_type IN ('standard', 'beginner') THEN 'standard'
        ELSE NULL
      END,
      CASE
        WHEN hb.pool_id IN ('standard', 'beginner') THEN 'standard'
        WHEN split_part(hb.pool_id, '_', 1) = 'special' THEN 'limited'
        WHEN split_part(hb.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
        WHEN
          CASE
            WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN true
            WHEN hb.rarity = 6 AND hb.up_character IS NOT NULL THEN
              NOT (
                COALESCE(hb.character_name, '') ILIKE '%' || hb.up_character || '%'
                OR COALESCE(hb.item_name, '') ILIKE '%' || hb.up_character || '%'
                OR hb.up_character ILIKE '%' || COALESCE(hb.character_name, hb.item_name, '') || '%'
              )
            ELSE COALESCE(hb.is_standard, false)
          END
        THEN 'standard'
        ELSE 'limited'
      END
    ) AS classified_pool_type
  FROM history_base AS hb
),
valid_pulls AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    record_id,
    rarity,
    server_id,
    region,
    is_standard_calc,
    classified_pool_type
  FROM history_enriched
  WHERE special_type IS DISTINCT FROM 'gift'
    AND (is_free IS NOT TRUE)
),
contributor_regions AS MATERIALIZED (
  SELECT DISTINCT
    user_id,
    CASE
      WHEN COALESCE(server_id, '') IN ('2', '3') THEN 'intl'
      WHEN lower(COALESCE(region, '')) ~ '(asia|sea|jp|kr|tw|hk|mo|sg|global|international|eu|na|us|亚服|亚洲|海外|欧服|美服|欧美)' THEN 'intl'
      ELSE 'cn'
    END AS region_bucket
  FROM valid_pulls
),
contributor_region_counts AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE region_bucket = 'cn') AS cn_contributors,
    COUNT(*) FILTER (WHERE region_bucket = 'intl') AS intl_contributors
  FROM contributor_regions
),
limited_pool_sequence AS MATERIALIZED (
  SELECT
    p.pool_id,
    LEAD(p.pool_id) OVER (
      ORDER BY COALESCE(p.start_time, p.created_at), p.pool_id
    ) AS next_pool_id
  FROM public.pools AS p
  WHERE p.type IN ('limited', 'limited_character')
),
limited_paid_pool_counts AS MATERIALIZED (
  SELECT
    vp.user_id,
    vp.pool_id,
    COUNT(*) AS paid_pull_count
  FROM valid_pulls AS vp
  WHERE vp.classified_pool_type = 'limited'
  GROUP BY vp.user_id, vp.pool_id
),
info_book_credits AS MATERIALIZED (
  SELECT
    lpc.user_id,
    lps.next_pool_id AS pool_id,
    SUM(10) AS credit_pull_count
  FROM limited_paid_pool_counts AS lpc
  JOIN limited_pool_sequence AS lps
    ON lps.pool_id = lpc.pool_id
  WHERE lps.next_pool_id IS NOT NULL
    AND lpc.paid_pull_count >= 60
  GROUP BY lpc.user_id, lps.next_pool_id
),
limited_paid_pull_order AS MATERIALIZED (
  SELECT
    vp.user_id,
    vp.pool_id,
    vp.record_id,
    ROW_NUMBER() OVER (
      PARTITION BY vp.user_id, vp.pool_id
      ORDER BY vp.record_id
    ) AS paid_pull_order
  FROM valid_pulls AS vp
  WHERE vp.classified_pool_type = 'limited'
),
info_book_pulls AS MATERIALIZED (
  SELECT
    lpo.user_id,
    lpo.pool_id,
    lpo.record_id
  FROM limited_paid_pull_order AS lpo
  JOIN info_book_credits AS ibc
    ON ibc.user_id = lpo.user_id
   AND ibc.pool_id = lpo.pool_id
  WHERE lpo.paid_pull_order <= ibc.credit_pull_count
),
charged_valid_pulls AS MATERIALIZED (
  SELECT vp.*
  FROM valid_pulls AS vp
  LEFT JOIN info_book_pulls AS ibp
    ON ibp.user_id = vp.user_id
   AND ibp.pool_id = vp.pool_id
   AND ibp.record_id = vp.record_id
  WHERE ibp.record_id IS NULL
),
valid_counts AS MATERIALIZED (
  SELECT
    COUNT(*) AS total_pulls,
    COUNT(DISTINCT user_id) AS total_contributors,
    COUNT(*) FILTER (WHERE rarity = 6) AS six_star_total,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = false) AS six_star_limited,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = true) AS six_star_standard,
    COUNT(*) FILTER (WHERE rarity = 5) AS five_star,
    COUNT(*) FILTER (WHERE rarity <= 4) AS four_star
  FROM valid_pulls
),
history_counts AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE special_type IS DISTINCT FROM 'gift') AS total_pulls_with_free,
    COUNT(*) FILTER (WHERE special_type IS DISTINCT FROM 'gift' AND is_free = true) AS free_pull_count,
    COUNT(*) FILTER (WHERE special_type = 'gift') AS gift_total,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'limited'
    ) AS char_gift,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'weapon'
        AND is_standard_calc = false
    ) AS weapon_gift_limited,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'weapon'
        AND is_standard_calc = true
    ) AS weapon_gift_standard
  FROM history_enriched
),
type_counts AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE rarity = 6) AS six,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = false) AS six_star_limited,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = true) AS six_star_standard,
    COUNT(*) FILTER (WHERE rarity = 5) AS five,
    COUNT(*) FILTER (WHERE rarity <= 4) AS four
  FROM valid_pulls
  GROUP BY classified_pool_type
),
charged_counts AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE classified_pool_type IN ('limited', 'standard')) AS charged_character_pulls,
    COUNT(*) FILTER (WHERE classified_pool_type = 'weapon') AS charged_weapon_pulls,
    COUNT(*) FILTER (WHERE classified_pool_type = 'limited') AS charged_limited_pulls,
    COUNT(*) FILTER (WHERE classified_pool_type = 'standard') AS charged_standard_pulls,
    COUNT(*) FILTER (WHERE classified_pool_type = 'weapon') AS charged_weapon_type_pulls,
    (SELECT COUNT(*) FROM info_book_pulls) AS info_book_pull_count
  FROM charged_valid_pulls
),
ordered_valid AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    rarity,
    is_standard_calc,
    classified_pool_type,
    record_id,
    ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) AS rn
  FROM valid_pulls
),
six_pity AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    is_standard_calc,
    classified_pool_type,
    rn,
    LEAST(
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0),
      80
    ) AS pity
  FROM ordered_valid
  WHERE rarity = 6
),
limited_first_up AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    MIN(rn) FILTER (WHERE is_standard_calc = false) AS first_up_rn
  FROM six_pity
  WHERE classified_pool_type = 'limited'
  GROUP BY pool_id, user_id
),
limited_six_pity AS MATERIALIZED (
  SELECT
    sp.pool_id,
    sp.user_id,
    sp.is_standard_calc,
    sp.rn,
    sp.pity,
    CASE
      WHEN sp.is_standard_calc = false
        AND sp.rn = 120
        AND COALESCE(lfu.first_up_rn, 999999) = 120
      THEN true
      ELSE false
    END AS is_spark
  FROM six_pity AS sp
  LEFT JOIN limited_first_up AS lfu
    ON lfu.pool_id = sp.pool_id
   AND lfu.user_id = sp.user_id
  WHERE sp.classified_pool_type = 'limited'
),
pity_ranges AS MATERIALIZED (
  SELECT
    classified_pool_type,
    is_standard_calc,
    CASE
      WHEN pity BETWEEN 1 AND 10 THEN '01-10'
      WHEN pity BETWEEN 11 AND 20 THEN '11-20'
      WHEN pity BETWEEN 21 AND 30 THEN '21-30'
      WHEN pity BETWEEN 31 AND 40 THEN '31-40'
      WHEN pity BETWEEN 41 AND 50 THEN '41-50'
      WHEN pity BETWEEN 51 AND 60 THEN '51-60'
      WHEN pity BETWEEN 61 AND 70 THEN '61-70'
      WHEN pity BETWEEN 71 AND 80 THEN '71-80'
      WHEN pity BETWEEN 81 AND 90 THEN '81-90'
      ELSE '91+'
    END AS range_label
  FROM six_pity
),
global_distribution_rows AS MATERIALIZED (
  SELECT
    range_label,
    COUNT(*) FILTER (WHERE is_standard_calc = false) AS limited_count,
    COUNT(*) FILTER (WHERE is_standard_calc = true) AS standard_count
  FROM pity_ranges
  GROUP BY range_label
),
type_distribution_rows AS MATERIALIZED (
  SELECT
    classified_pool_type,
    range_label,
    COUNT(*) FILTER (WHERE is_standard_calc = false) AS limited_count,
    COUNT(*) FILTER (WHERE is_standard_calc = true) AS standard_count
  FROM pity_ranges
  GROUP BY classified_pool_type, range_label
),
global_distribution AS MATERIALIZED (
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'range', REPLACE(range_label, '01-10', '1-10'),
        'limited', limited_count,
        'standard', standard_count
      )
      ORDER BY range_label
    ),
    '[]'::json
  ) AS distribution
  FROM global_distribution_rows
),
type_distributions AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COALESCE(
      json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        )
        ORDER BY range_label
      ),
      '[]'::json
    ) AS distribution
  FROM type_distribution_rows
  GROUP BY classified_pool_type
),
global_avg_pity AS MATERIALIZED (
  SELECT COALESCE(ROUND(AVG(pity)::numeric, 1), 0) AS avg_pity
  FROM six_pity
),
type_pity_stats AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COALESCE(ROUND(AVG(pity)::numeric, 1), 0) AS avg_pity,
    COALESCE(ROUND(AVG(pity) FILTER (WHERE is_standard_calc = false)::numeric, 1), 0) AS avg_pity_up
  FROM six_pity
  GROUP BY classified_pool_type
),
limited_pity_stats AS MATERIALIZED (
  SELECT
    COALESCE(ROUND(AVG(pity)::numeric, 1), 0) AS avg_pity,
    COALESCE(ROUND(AVG(pity) FILTER (WHERE is_standard_calc = false AND NOT is_spark)::numeric, 1), 0) AS avg_pity_up,
    COUNT(DISTINCT user_id) FILTER (WHERE is_spark = true) AS spark_count
  FROM limited_six_pity
),
total_users AS MATERIALIZED (
  SELECT COUNT(*) AS total_users
  FROM public.profiles
)
SELECT json_build_object(
  'totalPulls', COALESCE(vc.total_pulls, 0),
  'totalPullsWithFree', COALESCE(hc.total_pulls_with_free, 0),
  'freePullCount', COALESCE(hc.free_pull_count, 0),
  'chargedCharacterPulls', COALESCE(cc.charged_character_pulls, 0),
  'chargedWeaponPulls', COALESCE(cc.charged_weapon_pulls, 0),
  'infoBookPullCount', COALESCE(cc.info_book_pull_count, 0),
  'totalUsers', COALESCE(tu.total_users, 0),
  'totalContributors', COALESCE(vc.total_contributors, 0),
  'contributorsByRegion', json_build_object(
    'cn', COALESCE(crc.cn_contributors, 0),
    'intl', COALESCE(crc.intl_contributors, 0)
  ),
  'sixStarTotal', COALESCE(vc.six_star_total, 0),
  'sixStarLimited', COALESCE(vc.six_star_limited, 0),
  'sixStarStandard', COALESCE(vc.six_star_standard, 0),
  'fiveStar', COALESCE(vc.five_star, 0),
  'fourStar', COALESCE(vc.four_star, 0),
  'avgPity', COALESCE(gap.avg_pity, 0),
  'counts', json_build_object(
    '6', COALESCE(vc.six_star_limited, 0),
    '6_std', COALESCE(vc.six_star_standard, 0),
    '5', COALESCE(vc.five_star, 0),
    '4', COALESCE(vc.four_star, 0)
  ),
  'distribution', COALESCE(gd.distribution, '[]'::json),
  'byType', json_build_object(
    'limited', json_build_object(
      'total', COALESCE(tc_limited.total, 0),
      'chargedPulls', COALESCE(cc.charged_limited_pulls, 0),
      'six', COALESCE(tc_limited.six, 0),
      'sixStarLimited', COALESCE(tc_limited.six_star_limited, 0),
      'sixStarStandard', COALESCE(tc_limited.six_star_standard, 0),
      'avgPity', COALESCE(lps.avg_pity, 0),
      'avgPityUp', COALESCE(lps.avg_pity_up, 0),
      'sparkCount', COALESCE(lps.spark_count, 0),
      'counts', json_build_object(
        '6', COALESCE(tc_limited.six_star_limited, 0),
        '6_std', COALESCE(tc_limited.six_star_standard, 0),
        '5', COALESCE(tc_limited.five, 0),
        '4', COALESCE(tc_limited.four, 0)
      ),
      'distribution', COALESCE(td_limited.distribution, '[]'::json)
    ),
    'weapon', json_build_object(
      'total', COALESCE(tc_weapon.total, 0),
      'chargedPulls', COALESCE(cc.charged_weapon_type_pulls, 0),
      'six', COALESCE(tc_weapon.six, 0),
      'sixStarLimited', COALESCE(tc_weapon.six_star_limited, 0),
      'sixStarStandard', COALESCE(tc_weapon.six_star_standard, 0),
      'avgPity', COALESCE(tps_weapon.avg_pity, 0),
      'avgPityUp', COALESCE(tps_weapon.avg_pity_up, 0),
      'counts', json_build_object(
        '6', COALESCE(tc_weapon.six_star_limited, 0),
        '6_std', COALESCE(tc_weapon.six_star_standard, 0),
        '5', COALESCE(tc_weapon.five, 0),
        '4', COALESCE(tc_weapon.four, 0)
      ),
      'distribution', COALESCE(td_weapon.distribution, '[]'::json)
    ),
    'standard', json_build_object(
      'total', COALESCE(tc_standard.total, 0),
      'chargedPulls', COALESCE(cc.charged_standard_pulls, 0),
      'six', COALESCE(tc_standard.six, 0),
      'sixStarLimited', 0,
      'sixStarStandard', COALESCE(tc_standard.six, 0),
      'avgPity', COALESCE(tps_standard.avg_pity, 0),
      'counts', json_build_object(
        '6', 0,
        '6_std', COALESCE(tc_standard.six, 0),
        '5', COALESCE(tc_standard.five, 0),
        '4', COALESCE(tc_standard.four, 0)
      ),
      'distribution', COALESCE(td_standard.distribution, '[]'::json)
    )
  ),
  'charGift', COALESCE(hc.char_gift, 0),
  'weaponGiftLimited', COALESCE(hc.weapon_gift_limited, 0),
  'weaponGiftStandard', COALESCE(hc.weapon_gift_standard, 0),
  'giftTotal', COALESCE(hc.gift_total, 0)
)
FROM valid_counts AS vc
CROSS JOIN history_counts AS hc
CROSS JOIN charged_counts AS cc
CROSS JOIN global_avg_pity AS gap
CROSS JOIN global_distribution AS gd
CROSS JOIN limited_pity_stats AS lps
CROSS JOIN total_users AS tu
CROSS JOIN contributor_region_counts AS crc
LEFT JOIN type_counts AS tc_limited
  ON tc_limited.classified_pool_type = 'limited'
LEFT JOIN type_counts AS tc_weapon
  ON tc_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_counts AS tc_standard
  ON tc_standard.classified_pool_type = 'standard'
LEFT JOIN type_pity_stats AS tps_weapon
  ON tps_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_pity_stats AS tps_standard
  ON tps_standard.classified_pool_type = 'standard'
LEFT JOIN type_distributions AS td_limited
  ON td_limited.classified_pool_type = 'limited'
LEFT JOIN type_distributions AS td_weapon
  ON td_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_distributions AS td_standard
  ON td_standard.classified_pool_type = 'standard';
$$;

GRANT EXECUTE ON FUNCTION public.get_global_stats() TO anon, authenticated;

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 086: get_global_stats 已补国服 / 国际服贡献人数拆分';
END $$;
*/

DO $$
BEGIN
  RAISE NOTICE 'ℹ️ Migration 086: 预留给全服贡献人数区服拆分；当前标准链缺少 server/region 元数据，暂不执行结构变更';
END $$;
-- <<< END MIGRATION: archive/086_add_global_stats_contributor_region_breakdown.sql

-- >>> BEGIN MIGRATION: archive/087_enable_global_stats_region_and_target_metrics.sql
-- ============================================
-- 087: 启用全服统计的区服贡献人数与目标 6★ 平均出货
--
-- 背景:
--   1. 统计页需要在全服口径下展示国服 / 国际服贡献人数拆分
--   2. 全服限定池 / 武器池的 UP 6★ 平均出货，需要改成“仅统计当前池目标 6★”
--   3. 现有标准迁移链缺少 history.server_id / history.region，导致此前 086 只能保留为占位迁移
--
-- 目标:
--   1. 为 history 补齐 server_id / region 字段
--   2. 在 get_global_stats() 中输出 contributorsByRegion.cn / intl
--   3. 在 byType.limited / byType.weapon 中输出 avgPityTarget，并将 avgPityUp 收口到目标 6★ 口径
-- ============================================

ALTER TABLE public.history
  ADD COLUMN IF NOT EXISTS server_id TEXT,
  ADD COLUMN IF NOT EXISTS region TEXT;

COMMENT ON COLUMN public.history.server_id IS '游戏服务器 ID：1=国服，2/3=国际服分区';
COMMENT ON COLUMN public.history.region IS '游戏账号区服标签，如 asia / eu / na / 国服';

CREATE OR REPLACE FUNCTION public.get_global_stats()
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH history_base AS MATERIALIZED (
  SELECT
    h.pool_id,
    h.user_id,
    h.record_id,
    h.rarity,
    h.server_id,
    h.region,
    h.special_type,
    h.is_free,
    h.is_standard,
    h.character_name,
    h.item_name,
    p.type AS pool_type,
    p.up_character
  FROM public.history AS h
  LEFT JOIN public.pools AS p ON p.pool_id = h.pool_id
),
history_enriched AS MATERIALIZED (
  SELECT
    hb.pool_id,
    hb.user_id,
    hb.record_id,
    hb.rarity,
    hb.server_id,
    hb.region,
    hb.special_type,
    hb.is_free,
    CASE
      WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN true
      WHEN hb.rarity = 6 AND hb.up_character IS NOT NULL THEN
        NOT (
          COALESCE(hb.character_name, '') ILIKE '%' || hb.up_character || '%'
          OR COALESCE(hb.item_name, '') ILIKE '%' || hb.up_character || '%'
          OR hb.up_character ILIKE '%' || COALESCE(hb.character_name, hb.item_name, '') || '%'
        )
      ELSE COALESCE(hb.is_standard, false)
    END AS is_standard_calc,
    CASE
      WHEN hb.rarity <> 6 THEN false
      WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN false
      WHEN hb.up_character IS NULL THEN false
      ELSE (
        COALESCE(hb.character_name, '') ILIKE '%' || hb.up_character || '%'
        OR COALESCE(hb.item_name, '') ILIKE '%' || hb.up_character || '%'
        OR hb.up_character ILIKE '%' || COALESCE(hb.character_name, hb.item_name, '') || '%'
      )
    END AS is_target_calc,
    COALESCE(
      CASE
        WHEN hb.pool_type IN ('limited', 'limited_character') THEN 'limited'
        WHEN hb.pool_type IN ('weapon', 'limited_weapon') THEN 'weapon'
        WHEN hb.pool_type IN ('standard', 'beginner') THEN 'standard'
        ELSE NULL
      END,
      CASE
        WHEN hb.pool_id IN ('standard', 'beginner') THEN 'standard'
        WHEN split_part(hb.pool_id, '_', 1) = 'special' THEN 'limited'
        WHEN split_part(hb.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
        WHEN
          CASE
            WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN true
            WHEN hb.rarity = 6 AND hb.up_character IS NOT NULL THEN
              NOT (
                COALESCE(hb.character_name, '') ILIKE '%' || hb.up_character || '%'
                OR COALESCE(hb.item_name, '') ILIKE '%' || hb.up_character || '%'
                OR hb.up_character ILIKE '%' || COALESCE(hb.character_name, hb.item_name, '') || '%'
              )
            ELSE COALESCE(hb.is_standard, false)
          END
        THEN 'standard'
        ELSE 'limited'
      END
    ) AS classified_pool_type
  FROM history_base AS hb
),
valid_pulls AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    record_id,
    rarity,
    server_id,
    region,
    is_standard_calc,
    is_target_calc,
    classified_pool_type
  FROM history_enriched
  WHERE special_type IS DISTINCT FROM 'gift'
    AND (is_free IS NOT TRUE)
),
contributor_regions AS MATERIALIZED (
  SELECT DISTINCT
    user_id,
    CASE
      WHEN COALESCE(server_id, '') IN ('2', '3') THEN 'intl'
      WHEN lower(COALESCE(region, '')) ~ '(asia|sea|jp|kr|tw|hk|mo|sg|global|international|eu|na|us|亚服|亚洲|海外|欧服|美服|欧美)' THEN 'intl'
      ELSE 'cn'
    END AS region_bucket
  FROM valid_pulls
),
contributor_region_counts AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE region_bucket = 'cn') AS cn_contributors,
    COUNT(*) FILTER (WHERE region_bucket = 'intl') AS intl_contributors
  FROM contributor_regions
),
limited_pool_sequence AS MATERIALIZED (
  SELECT
    p.pool_id,
    LEAD(p.pool_id) OVER (
      ORDER BY COALESCE(p.start_time, p.created_at), p.pool_id
    ) AS next_pool_id
  FROM public.pools AS p
  WHERE p.type IN ('limited', 'limited_character')
),
limited_paid_pool_counts AS MATERIALIZED (
  SELECT
    vp.user_id,
    vp.pool_id,
    COUNT(*) AS paid_pull_count
  FROM valid_pulls AS vp
  WHERE vp.classified_pool_type = 'limited'
  GROUP BY vp.user_id, vp.pool_id
),
info_book_credits AS MATERIALIZED (
  SELECT
    lpc.user_id,
    lps.next_pool_id AS pool_id,
    SUM(10) AS credit_pull_count
  FROM limited_paid_pool_counts AS lpc
  JOIN limited_pool_sequence AS lps
    ON lps.pool_id = lpc.pool_id
  WHERE lps.next_pool_id IS NOT NULL
    AND lpc.paid_pull_count >= 60
  GROUP BY lpc.user_id, lps.next_pool_id
),
limited_paid_pull_order AS MATERIALIZED (
  SELECT
    vp.user_id,
    vp.pool_id,
    vp.record_id,
    ROW_NUMBER() OVER (
      PARTITION BY vp.user_id, vp.pool_id
      ORDER BY vp.record_id
    ) AS paid_pull_order
  FROM valid_pulls AS vp
  WHERE vp.classified_pool_type = 'limited'
),
info_book_pulls AS MATERIALIZED (
  SELECT
    lpo.user_id,
    lpo.pool_id,
    lpo.record_id
  FROM limited_paid_pull_order AS lpo
  JOIN info_book_credits AS ibc
    ON ibc.user_id = lpo.user_id
   AND ibc.pool_id = lpo.pool_id
  WHERE lpo.paid_pull_order <= ibc.credit_pull_count
),
charged_valid_pulls AS MATERIALIZED (
  SELECT vp.*
  FROM valid_pulls AS vp
  LEFT JOIN info_book_pulls AS ibp
    ON ibp.user_id = vp.user_id
   AND ibp.pool_id = vp.pool_id
   AND ibp.record_id = vp.record_id
  WHERE ibp.record_id IS NULL
),
valid_counts AS MATERIALIZED (
  SELECT
    COUNT(*) AS total_pulls,
    COUNT(DISTINCT user_id) AS total_contributors,
    COUNT(*) FILTER (WHERE rarity = 6) AS six_star_total,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = false) AS six_star_limited,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = true) AS six_star_standard,
    COUNT(*) FILTER (WHERE rarity = 5) AS five_star,
    COUNT(*) FILTER (WHERE rarity <= 4) AS four_star
  FROM valid_pulls
),
history_counts AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE special_type IS DISTINCT FROM 'gift') AS total_pulls_with_free,
    COUNT(*) FILTER (WHERE special_type IS DISTINCT FROM 'gift' AND is_free = true) AS free_pull_count,
    COUNT(*) FILTER (WHERE special_type = 'gift') AS gift_total,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'limited'
    ) AS char_gift,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'weapon'
        AND is_standard_calc = false
    ) AS weapon_gift_limited,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'weapon'
        AND is_standard_calc = true
    ) AS weapon_gift_standard
  FROM history_enriched
),
type_counts AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE rarity = 6) AS six,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = false) AS six_star_limited,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = true) AS six_star_standard,
    COUNT(*) FILTER (WHERE rarity = 5) AS five,
    COUNT(*) FILTER (WHERE rarity <= 4) AS four
  FROM valid_pulls
  GROUP BY classified_pool_type
),
charged_counts AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE classified_pool_type IN ('limited', 'standard')) AS charged_character_pulls,
    COUNT(*) FILTER (WHERE classified_pool_type = 'weapon') AS charged_weapon_pulls,
    COUNT(*) FILTER (WHERE classified_pool_type = 'limited') AS charged_limited_pulls,
    COUNT(*) FILTER (WHERE classified_pool_type = 'standard') AS charged_standard_pulls,
    COUNT(*) FILTER (WHERE classified_pool_type = 'weapon') AS charged_weapon_type_pulls,
    (SELECT COUNT(*) FROM info_book_pulls) AS info_book_pull_count
  FROM charged_valid_pulls
),
ordered_valid AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    rarity,
    is_standard_calc,
    is_target_calc,
    classified_pool_type,
    record_id,
    ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) AS rn
  FROM valid_pulls
),
six_pity AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    is_standard_calc,
    is_target_calc,
    classified_pool_type,
    rn,
    LEAST(
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0),
      80
    ) AS pity
  FROM ordered_valid
  WHERE rarity = 6
),
limited_first_target AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    MIN(rn) FILTER (WHERE is_target_calc = true) AS first_target_rn
  FROM six_pity
  WHERE classified_pool_type = 'limited'
  GROUP BY pool_id, user_id
),
limited_six_pity AS MATERIALIZED (
  SELECT
    sp.pool_id,
    sp.user_id,
    sp.is_standard_calc,
    sp.is_target_calc,
    sp.rn,
    sp.pity,
    CASE
      WHEN sp.is_target_calc = true
        AND sp.rn = 120
        AND COALESCE(lft.first_target_rn, 999999) = 120
      THEN true
      ELSE false
    END AS is_spark
  FROM six_pity AS sp
  LEFT JOIN limited_first_target AS lft
    ON lft.pool_id = sp.pool_id
   AND lft.user_id = sp.user_id
  WHERE sp.classified_pool_type = 'limited'
),
pity_ranges AS MATERIALIZED (
  SELECT
    classified_pool_type,
    is_standard_calc,
    CASE
      WHEN pity BETWEEN 1 AND 10 THEN '01-10'
      WHEN pity BETWEEN 11 AND 20 THEN '11-20'
      WHEN pity BETWEEN 21 AND 30 THEN '21-30'
      WHEN pity BETWEEN 31 AND 40 THEN '31-40'
      WHEN pity BETWEEN 41 AND 50 THEN '41-50'
      WHEN pity BETWEEN 51 AND 60 THEN '51-60'
      WHEN pity BETWEEN 61 AND 70 THEN '61-70'
      WHEN pity BETWEEN 71 AND 80 THEN '71-80'
      WHEN pity BETWEEN 81 AND 90 THEN '81-90'
      ELSE '91+'
    END AS range_label
  FROM six_pity
),
global_distribution_rows AS MATERIALIZED (
  SELECT
    range_label,
    COUNT(*) FILTER (WHERE is_standard_calc = false) AS limited_count,
    COUNT(*) FILTER (WHERE is_standard_calc = true) AS standard_count
  FROM pity_ranges
  GROUP BY range_label
),
type_distribution_rows AS MATERIALIZED (
  SELECT
    classified_pool_type,
    range_label,
    COUNT(*) FILTER (WHERE is_standard_calc = false) AS limited_count,
    COUNT(*) FILTER (WHERE is_standard_calc = true) AS standard_count
  FROM pity_ranges
  GROUP BY classified_pool_type, range_label
),
global_distribution AS MATERIALIZED (
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'range', REPLACE(range_label, '01-10', '1-10'),
        'limited', limited_count,
        'standard', standard_count
      )
      ORDER BY range_label
    ),
    '[]'::json
  ) AS distribution
  FROM global_distribution_rows
),
type_distributions AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COALESCE(
      json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        )
        ORDER BY range_label
      ),
      '[]'::json
    ) AS distribution
  FROM type_distribution_rows
  GROUP BY classified_pool_type
),
global_avg_pity AS MATERIALIZED (
  SELECT ROUND(AVG(pity)::numeric, 1) AS avg_pity
  FROM six_pity
),
type_pity_stats AS MATERIALIZED (
  SELECT
    classified_pool_type,
    ROUND(AVG(pity)::numeric, 1) AS avg_pity,
    ROUND(AVG(pity) FILTER (WHERE is_standard_calc = false)::numeric, 1) AS avg_pity_up,
    ROUND(AVG(pity) FILTER (WHERE is_target_calc = true)::numeric, 1) AS avg_pity_target
  FROM six_pity
  GROUP BY classified_pool_type
),
limited_pity_stats AS MATERIALIZED (
  SELECT
    ROUND(AVG(pity)::numeric, 1) AS avg_pity,
    ROUND(AVG(pity) FILTER (WHERE is_standard_calc = false AND NOT is_spark)::numeric, 1) AS avg_pity_up,
    ROUND(AVG(pity) FILTER (WHERE is_target_calc = true AND NOT is_spark)::numeric, 1) AS avg_pity_target,
    COUNT(DISTINCT user_id) FILTER (WHERE is_spark = true) AS spark_count
  FROM limited_six_pity
),
total_users AS MATERIALIZED (
  SELECT COUNT(*) AS total_users
  FROM public.profiles
)
SELECT json_build_object(
  'totalPulls', COALESCE(vc.total_pulls, 0),
  'totalPullsWithFree', COALESCE(hc.total_pulls_with_free, 0),
  'freePullCount', COALESCE(hc.free_pull_count, 0),
  'chargedCharacterPulls', COALESCE(cc.charged_character_pulls, 0),
  'chargedWeaponPulls', COALESCE(cc.charged_weapon_pulls, 0),
  'infoBookPullCount', COALESCE(cc.info_book_pull_count, 0),
  'totalUsers', COALESCE(tu.total_users, 0),
  'totalContributors', COALESCE(vc.total_contributors, 0),
  'contributorsByRegion', json_build_object(
    'cn', COALESCE(crc.cn_contributors, 0),
    'intl', COALESCE(crc.intl_contributors, 0)
  ),
  'sixStarTotal', COALESCE(vc.six_star_total, 0),
  'sixStarLimited', COALESCE(vc.six_star_limited, 0),
  'sixStarStandard', COALESCE(vc.six_star_standard, 0),
  'fiveStar', COALESCE(vc.five_star, 0),
  'fourStar', COALESCE(vc.four_star, 0),
  'avgPity', COALESCE(gap.avg_pity, 0),
  'counts', json_build_object(
    '6', COALESCE(vc.six_star_limited, 0),
    '6_std', COALESCE(vc.six_star_standard, 0),
    '5', COALESCE(vc.five_star, 0),
    '4', COALESCE(vc.four_star, 0)
  ),
  'distribution', COALESCE(gd.distribution, '[]'::json),
  'byType', json_build_object(
    'limited', json_build_object(
      'total', COALESCE(tc_limited.total, 0),
      'chargedPulls', COALESCE(cc.charged_limited_pulls, 0),
      'six', COALESCE(tc_limited.six, 0),
      'sixStarLimited', COALESCE(tc_limited.six_star_limited, 0),
      'sixStarStandard', COALESCE(tc_limited.six_star_standard, 0),
      'avgPity', COALESCE(lps.avg_pity, 0),
      'avgPityUp', COALESCE(lps.avg_pity_target, lps.avg_pity_up, 0),
      'avgPityTarget', COALESCE(lps.avg_pity_target, lps.avg_pity_up, 0),
      'sparkCount', COALESCE(lps.spark_count, 0),
      'counts', json_build_object(
        '6', COALESCE(tc_limited.six_star_limited, 0),
        '6_std', COALESCE(tc_limited.six_star_standard, 0),
        '5', COALESCE(tc_limited.five, 0),
        '4', COALESCE(tc_limited.four, 0)
      ),
      'distribution', COALESCE(td_limited.distribution, '[]'::json)
    ),
    'weapon', json_build_object(
      'total', COALESCE(tc_weapon.total, 0),
      'chargedPulls', COALESCE(cc.charged_weapon_type_pulls, 0),
      'six', COALESCE(tc_weapon.six, 0),
      'sixStarLimited', COALESCE(tc_weapon.six_star_limited, 0),
      'sixStarStandard', COALESCE(tc_weapon.six_star_standard, 0),
      'avgPity', COALESCE(tps_weapon.avg_pity, 0),
      'avgPityUp', COALESCE(tps_weapon.avg_pity_target, tps_weapon.avg_pity_up, 0),
      'avgPityTarget', COALESCE(tps_weapon.avg_pity_target, tps_weapon.avg_pity_up, 0),
      'counts', json_build_object(
        '6', COALESCE(tc_weapon.six_star_limited, 0),
        '6_std', COALESCE(tc_weapon.six_star_standard, 0),
        '5', COALESCE(tc_weapon.five, 0),
        '4', COALESCE(tc_weapon.four, 0)
      ),
      'distribution', COALESCE(td_weapon.distribution, '[]'::json)
    ),
    'standard', json_build_object(
      'total', COALESCE(tc_standard.total, 0),
      'chargedPulls', COALESCE(cc.charged_standard_pulls, 0),
      'six', COALESCE(tc_standard.six, 0),
      'sixStarLimited', 0,
      'sixStarStandard', COALESCE(tc_standard.six, 0),
      'avgPity', COALESCE(tps_standard.avg_pity, 0),
      'counts', json_build_object(
        '6', 0,
        '6_std', COALESCE(tc_standard.six, 0),
        '5', COALESCE(tc_standard.five, 0),
        '4', COALESCE(tc_standard.four, 0)
      ),
      'distribution', COALESCE(td_standard.distribution, '[]'::json)
    )
  ),
  'charGift', COALESCE(hc.char_gift, 0),
  'weaponGiftLimited', COALESCE(hc.weapon_gift_limited, 0),
  'weaponGiftStandard', COALESCE(hc.weapon_gift_standard, 0),
  'giftTotal', COALESCE(hc.gift_total, 0)
)
FROM valid_counts AS vc
CROSS JOIN history_counts AS hc
CROSS JOIN charged_counts AS cc
CROSS JOIN global_avg_pity AS gap
CROSS JOIN global_distribution AS gd
CROSS JOIN limited_pity_stats AS lps
CROSS JOIN total_users AS tu
CROSS JOIN contributor_region_counts AS crc
LEFT JOIN type_counts AS tc_limited
  ON tc_limited.classified_pool_type = 'limited'
LEFT JOIN type_counts AS tc_weapon
  ON tc_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_counts AS tc_standard
  ON tc_standard.classified_pool_type = 'standard'
LEFT JOIN type_pity_stats AS tps_weapon
  ON tps_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_pity_stats AS tps_standard
  ON tps_standard.classified_pool_type = 'standard'
LEFT JOIN type_distributions AS td_limited
  ON td_limited.classified_pool_type = 'limited'
LEFT JOIN type_distributions AS td_weapon
  ON td_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_distributions AS td_standard
  ON td_standard.classified_pool_type = 'standard';
$$;

GRANT EXECUTE ON FUNCTION public.get_global_stats() TO anon, authenticated;

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 087: get_global_stats 已启用区服贡献人数拆分与目标 6★ 平均出货';
END $$;
-- <<< END MIGRATION: archive/087_enable_global_stats_region_and_target_metrics.sql

-- >>> BEGIN MIGRATION: archive/088_optimize_global_stats_target_matching.sql
-- ============================================
-- 088: 优化 get_global_stats 的目标 6★ 匹配成本
--
-- 背景:
--   087 为 get_global_stats() 增加了 contributorsByRegion 与 avgPityTarget，
--   但把目标 6★ 文本匹配扩展到了更大的中间结果集，真实库在 PostgREST 超时窗口内可能被取消。
--
-- 目标:
--   1. 将目标 6★ 匹配收窄到“仅 6★ 记录”
--   2. 避免在 classified_pool_type 推导时重复执行文本匹配
--   3. 保持 087 的返回结构与前端口径不变
-- ============================================

CREATE OR REPLACE FUNCTION public.get_global_stats()
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH history_base AS MATERIALIZED (
  SELECT
    h.pool_id,
    h.user_id,
    h.record_id,
    h.rarity,
    h.server_id,
    h.region,
    h.special_type,
    h.is_free,
    h.is_standard,
    h.character_name,
    h.item_name,
    p.type AS pool_type,
    p.up_character
  FROM public.history AS h
  LEFT JOIN public.pools AS p ON p.pool_id = h.pool_id
),
six_star_target_matches AS MATERIALIZED (
  SELECT
    hb.pool_id,
    hb.user_id,
    hb.record_id,
    (
      lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) <> ''
      AND (
        lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) LIKE '%' || lower(trim(hb.up_character)) || '%'
        OR lower(trim(hb.up_character)) LIKE '%' || lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) || '%'
      )
    ) AS is_target
  FROM history_base AS hb
  WHERE hb.rarity = 6
    AND hb.up_character IS NOT NULL
    AND hb.up_character <> ''
    AND NOT (hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner'))
),
history_enriched AS MATERIALIZED (
  SELECT
    hb.pool_id,
    hb.user_id,
    hb.record_id,
    hb.rarity,
    hb.server_id,
    hb.region,
    hb.special_type,
    hb.is_free,
    CASE
      WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN true
      WHEN hb.rarity = 6 AND hb.up_character IS NOT NULL AND hb.up_character <> '' THEN NOT COALESCE(stm.is_target, false)
      ELSE COALESCE(hb.is_standard, false)
    END AS is_standard_calc,
    CASE
      WHEN hb.rarity <> 6 THEN false
      WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN false
      ELSE COALESCE(stm.is_target, false)
    END AS is_target_calc,
    CASE
      WHEN hb.pool_type IN ('limited', 'limited_character') THEN 'limited'
      WHEN hb.pool_type IN ('weapon', 'limited_weapon') THEN 'weapon'
      WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN 'standard'
      WHEN split_part(hb.pool_id, '_', 1) = 'special' THEN 'limited'
      WHEN split_part(hb.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
      WHEN COALESCE(hb.is_standard, false) THEN 'standard'
      ELSE 'limited'
    END AS classified_pool_type
  FROM history_base AS hb
  LEFT JOIN six_star_target_matches AS stm
    ON stm.pool_id = hb.pool_id
   AND stm.user_id = hb.user_id
   AND stm.record_id = hb.record_id
),
valid_pulls AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    record_id,
    rarity,
    server_id,
    region,
    is_standard_calc,
    is_target_calc,
    classified_pool_type
  FROM history_enriched
  WHERE special_type IS DISTINCT FROM 'gift'
    AND (is_free IS NOT TRUE)
),
contributor_regions AS MATERIALIZED (
  SELECT
    user_id,
    CASE
      WHEN bool_or(
        COALESCE(server_id, '') IN ('2', '3')
        OR lower(COALESCE(region, '')) IN ('asia', 'sea', 'jp', 'kr', 'tw', 'hk', 'mo', 'sg', 'global', 'international', 'eu', 'na', 'us')
        OR COALESCE(region, '') IN ('亚服', '亚洲', '海外', '欧服', '美服', '欧美')
      ) THEN 'intl'
      ELSE 'cn'
    END AS region_bucket
  FROM valid_pulls
  GROUP BY user_id
),
contributor_region_counts AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE region_bucket = 'cn') AS cn_contributors,
    COUNT(*) FILTER (WHERE region_bucket = 'intl') AS intl_contributors
  FROM contributor_regions
),
limited_pool_sequence AS MATERIALIZED (
  SELECT
    p.pool_id,
    LEAD(p.pool_id) OVER (
      ORDER BY COALESCE(p.start_time, p.created_at), p.pool_id
    ) AS next_pool_id
  FROM public.pools AS p
  WHERE p.type IN ('limited', 'limited_character')
),
limited_paid_pool_counts AS MATERIALIZED (
  SELECT
    vp.user_id,
    vp.pool_id,
    COUNT(*) AS paid_pull_count
  FROM valid_pulls AS vp
  WHERE vp.classified_pool_type = 'limited'
  GROUP BY vp.user_id, vp.pool_id
),
info_book_credits AS MATERIALIZED (
  SELECT
    lpc.user_id,
    lps.next_pool_id AS pool_id,
    SUM(10) AS credit_pull_count
  FROM limited_paid_pool_counts AS lpc
  JOIN limited_pool_sequence AS lps
    ON lps.pool_id = lpc.pool_id
  WHERE lps.next_pool_id IS NOT NULL
    AND lpc.paid_pull_count >= 60
  GROUP BY lpc.user_id, lps.next_pool_id
),
limited_paid_pull_order AS MATERIALIZED (
  SELECT
    vp.user_id,
    vp.pool_id,
    vp.record_id,
    ROW_NUMBER() OVER (
      PARTITION BY vp.user_id, vp.pool_id
      ORDER BY vp.record_id
    ) AS paid_pull_order
  FROM valid_pulls AS vp
  WHERE vp.classified_pool_type = 'limited'
),
info_book_pulls AS MATERIALIZED (
  SELECT
    lpo.user_id,
    lpo.pool_id,
    lpo.record_id
  FROM limited_paid_pull_order AS lpo
  JOIN info_book_credits AS ibc
    ON ibc.user_id = lpo.user_id
   AND ibc.pool_id = lpo.pool_id
  WHERE lpo.paid_pull_order <= ibc.credit_pull_count
),
charged_valid_pulls AS MATERIALIZED (
  SELECT vp.*
  FROM valid_pulls AS vp
  LEFT JOIN info_book_pulls AS ibp
    ON ibp.user_id = vp.user_id
   AND ibp.pool_id = vp.pool_id
   AND ibp.record_id = vp.record_id
  WHERE ibp.record_id IS NULL
),
valid_counts AS MATERIALIZED (
  SELECT
    COUNT(*) AS total_pulls,
    COUNT(DISTINCT user_id) AS total_contributors,
    COUNT(*) FILTER (WHERE rarity = 6) AS six_star_total,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = false) AS six_star_limited,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = true) AS six_star_standard,
    COUNT(*) FILTER (WHERE rarity = 5) AS five_star,
    COUNT(*) FILTER (WHERE rarity <= 4) AS four_star
  FROM valid_pulls
),
history_counts AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE special_type IS DISTINCT FROM 'gift') AS total_pulls_with_free,
    COUNT(*) FILTER (WHERE special_type IS DISTINCT FROM 'gift' AND is_free = true) AS free_pull_count,
    COUNT(*) FILTER (WHERE special_type = 'gift') AS gift_total,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'limited'
    ) AS char_gift,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'weapon'
        AND is_standard_calc = false
    ) AS weapon_gift_limited,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'weapon'
        AND is_standard_calc = true
    ) AS weapon_gift_standard
  FROM history_enriched
),
type_counts AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE rarity = 6) AS six,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = false) AS six_star_limited,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = true) AS six_star_standard,
    COUNT(*) FILTER (WHERE rarity = 5) AS five,
    COUNT(*) FILTER (WHERE rarity <= 4) AS four
  FROM valid_pulls
  GROUP BY classified_pool_type
),
charged_counts AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE classified_pool_type IN ('limited', 'standard')) AS charged_character_pulls,
    COUNT(*) FILTER (WHERE classified_pool_type = 'weapon') AS charged_weapon_pulls,
    COUNT(*) FILTER (WHERE classified_pool_type = 'limited') AS charged_limited_pulls,
    COUNT(*) FILTER (WHERE classified_pool_type = 'standard') AS charged_standard_pulls,
    COUNT(*) FILTER (WHERE classified_pool_type = 'weapon') AS charged_weapon_type_pulls,
    (SELECT COUNT(*) FROM info_book_pulls) AS info_book_pull_count
  FROM charged_valid_pulls
),
ordered_valid AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    rarity,
    is_standard_calc,
    is_target_calc,
    classified_pool_type,
    record_id,
    ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) AS rn
  FROM valid_pulls
),
six_pity AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    is_standard_calc,
    is_target_calc,
    classified_pool_type,
    rn,
    LEAST(
      rn - COALESCE(LAG(rn, 1) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0),
      80
    ) AS pity
  FROM ordered_valid
  WHERE rarity = 6
),
limited_first_target AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    MIN(rn) FILTER (WHERE is_target_calc = true) AS first_target_rn
  FROM six_pity
  WHERE classified_pool_type = 'limited'
  GROUP BY pool_id, user_id
),
limited_six_pity AS MATERIALIZED (
  SELECT
    sp.pool_id,
    sp.user_id,
    sp.is_standard_calc,
    sp.is_target_calc,
    sp.rn,
    sp.pity,
    CASE
      WHEN sp.is_target_calc = true
        AND sp.rn = 120
        AND COALESCE(lft.first_target_rn, 999999) = 120
      THEN true
      ELSE false
    END AS is_spark
  FROM six_pity AS sp
  LEFT JOIN limited_first_target AS lft
    ON lft.pool_id = sp.pool_id
   AND lft.user_id = sp.user_id
  WHERE sp.classified_pool_type = 'limited'
),
pity_ranges AS MATERIALIZED (
  SELECT
    classified_pool_type,
    is_standard_calc,
    CASE
      WHEN pity BETWEEN 1 AND 10 THEN '01-10'
      WHEN pity BETWEEN 11 AND 20 THEN '11-20'
      WHEN pity BETWEEN 21 AND 30 THEN '21-30'
      WHEN pity BETWEEN 31 AND 40 THEN '31-40'
      WHEN pity BETWEEN 41 AND 50 THEN '41-50'
      WHEN pity BETWEEN 51 AND 60 THEN '51-60'
      WHEN pity BETWEEN 61 AND 70 THEN '61-70'
      WHEN pity BETWEEN 71 AND 80 THEN '71-80'
      WHEN pity BETWEEN 81 AND 90 THEN '81-90'
      ELSE '91+'
    END AS range_label
  FROM six_pity
),
global_distribution_rows AS MATERIALIZED (
  SELECT
    range_label,
    COUNT(*) FILTER (WHERE is_standard_calc = false) AS limited_count,
    COUNT(*) FILTER (WHERE is_standard_calc = true) AS standard_count
  FROM pity_ranges
  GROUP BY range_label
),
type_distribution_rows AS MATERIALIZED (
  SELECT
    classified_pool_type,
    range_label,
    COUNT(*) FILTER (WHERE is_standard_calc = false) AS limited_count,
    COUNT(*) FILTER (WHERE is_standard_calc = true) AS standard_count
  FROM pity_ranges
  GROUP BY classified_pool_type, range_label
),
global_distribution AS MATERIALIZED (
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'range', REPLACE(range_label, '01-10', '1-10'),
        'limited', limited_count,
        'standard', standard_count
      )
      ORDER BY range_label
    ),
    '[]'::json
  ) AS distribution
  FROM global_distribution_rows
),
type_distributions AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COALESCE(
      json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        )
        ORDER BY range_label
      ),
      '[]'::json
    ) AS distribution
  FROM type_distribution_rows
  GROUP BY classified_pool_type
),
global_avg_pity AS MATERIALIZED (
  SELECT ROUND(AVG(pity)::numeric, 1) AS avg_pity
  FROM six_pity
),
type_pity_stats AS MATERIALIZED (
  SELECT
    classified_pool_type,
    ROUND(AVG(pity)::numeric, 1) AS avg_pity,
    ROUND(AVG(pity) FILTER (WHERE is_standard_calc = false)::numeric, 1) AS avg_pity_up,
    ROUND(AVG(pity) FILTER (WHERE is_target_calc = true)::numeric, 1) AS avg_pity_target
  FROM six_pity
  GROUP BY classified_pool_type
),
limited_pity_stats AS MATERIALIZED (
  SELECT
    ROUND(AVG(pity)::numeric, 1) AS avg_pity,
    ROUND(AVG(pity) FILTER (WHERE is_standard_calc = false AND NOT is_spark)::numeric, 1) AS avg_pity_up,
    ROUND(AVG(pity) FILTER (WHERE is_target_calc = true AND NOT is_spark)::numeric, 1) AS avg_pity_target,
    COUNT(DISTINCT user_id) FILTER (WHERE is_spark = true) AS spark_count
  FROM limited_six_pity
),
total_users AS MATERIALIZED (
  SELECT COUNT(*) AS total_users
  FROM public.profiles
)
SELECT json_build_object(
  'totalPulls', COALESCE(vc.total_pulls, 0),
  'totalPullsWithFree', COALESCE(hc.total_pulls_with_free, 0),
  'freePullCount', COALESCE(hc.free_pull_count, 0),
  'chargedCharacterPulls', COALESCE(cc.charged_character_pulls, 0),
  'chargedWeaponPulls', COALESCE(cc.charged_weapon_pulls, 0),
  'infoBookPullCount', COALESCE(cc.info_book_pull_count, 0),
  'totalUsers', COALESCE(tu.total_users, 0),
  'totalContributors', COALESCE(vc.total_contributors, 0),
  'contributorsByRegion', json_build_object(
    'cn', COALESCE(crc.cn_contributors, 0),
    'intl', COALESCE(crc.intl_contributors, 0)
  ),
  'sixStarTotal', COALESCE(vc.six_star_total, 0),
  'sixStarLimited', COALESCE(vc.six_star_limited, 0),
  'sixStarStandard', COALESCE(vc.six_star_standard, 0),
  'fiveStar', COALESCE(vc.five_star, 0),
  'fourStar', COALESCE(vc.four_star, 0),
  'avgPity', COALESCE(gap.avg_pity, 0),
  'counts', json_build_object(
    '6', COALESCE(vc.six_star_limited, 0),
    '6_std', COALESCE(vc.six_star_standard, 0),
    '5', COALESCE(vc.five_star, 0),
    '4', COALESCE(vc.four_star, 0)
  ),
  'distribution', COALESCE(gd.distribution, '[]'::json),
  'byType', json_build_object(
    'limited', json_build_object(
      'total', COALESCE(tc_limited.total, 0),
      'chargedPulls', COALESCE(cc.charged_limited_pulls, 0),
      'six', COALESCE(tc_limited.six, 0),
      'sixStarLimited', COALESCE(tc_limited.six_star_limited, 0),
      'sixStarStandard', COALESCE(tc_limited.six_star_standard, 0),
      'avgPity', COALESCE(lps.avg_pity, 0),
      'avgPityUp', COALESCE(lps.avg_pity_target, lps.avg_pity_up, 0),
      'avgPityTarget', COALESCE(lps.avg_pity_target, lps.avg_pity_up, 0),
      'sparkCount', COALESCE(lps.spark_count, 0),
      'counts', json_build_object(
        '6', COALESCE(tc_limited.six_star_limited, 0),
        '6_std', COALESCE(tc_limited.six_star_standard, 0),
        '5', COALESCE(tc_limited.five, 0),
        '4', COALESCE(tc_limited.four, 0)
      ),
      'distribution', COALESCE(td_limited.distribution, '[]'::json)
    ),
    'weapon', json_build_object(
      'total', COALESCE(tc_weapon.total, 0),
      'chargedPulls', COALESCE(cc.charged_weapon_type_pulls, 0),
      'six', COALESCE(tc_weapon.six, 0),
      'sixStarLimited', COALESCE(tc_weapon.six_star_limited, 0),
      'sixStarStandard', COALESCE(tc_weapon.six_star_standard, 0),
      'avgPity', COALESCE(tps_weapon.avg_pity, 0),
      'avgPityUp', COALESCE(tps_weapon.avg_pity_target, tps_weapon.avg_pity_up, 0),
      'avgPityTarget', COALESCE(tps_weapon.avg_pity_target, tps_weapon.avg_pity_up, 0),
      'counts', json_build_object(
        '6', COALESCE(tc_weapon.six_star_limited, 0),
        '6_std', COALESCE(tc_weapon.six_star_standard, 0),
        '5', COALESCE(tc_weapon.five, 0),
        '4', COALESCE(tc_weapon.four, 0)
      ),
      'distribution', COALESCE(td_weapon.distribution, '[]'::json)
    ),
    'standard', json_build_object(
      'total', COALESCE(tc_standard.total, 0),
      'chargedPulls', COALESCE(cc.charged_standard_pulls, 0),
      'six', COALESCE(tc_standard.six, 0),
      'sixStarLimited', 0,
      'sixStarStandard', COALESCE(tc_standard.six, 0),
      'avgPity', COALESCE(tps_standard.avg_pity, 0),
      'counts', json_build_object(
        '6', 0,
        '6_std', COALESCE(tc_standard.six, 0),
        '5', COALESCE(tc_standard.five, 0),
        '4', COALESCE(tc_standard.four, 0)
      ),
      'distribution', COALESCE(td_standard.distribution, '[]'::json)
    )
  ),
  'charGift', COALESCE(hc.char_gift, 0),
  'weaponGiftLimited', COALESCE(hc.weapon_gift_limited, 0),
  'weaponGiftStandard', COALESCE(hc.weapon_gift_standard, 0),
  'giftTotal', COALESCE(hc.gift_total, 0)
)
FROM valid_counts AS vc
CROSS JOIN history_counts AS hc
CROSS JOIN charged_counts AS cc
CROSS JOIN global_avg_pity AS gap
CROSS JOIN global_distribution AS gd
CROSS JOIN limited_pity_stats AS lps
CROSS JOIN total_users AS tu
CROSS JOIN contributor_region_counts AS crc
LEFT JOIN type_counts AS tc_limited
  ON tc_limited.classified_pool_type = 'limited'
LEFT JOIN type_counts AS tc_weapon
  ON tc_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_counts AS tc_standard
  ON tc_standard.classified_pool_type = 'standard'
LEFT JOIN type_pity_stats AS tps_weapon
  ON tps_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_pity_stats AS tps_standard
  ON tps_standard.classified_pool_type = 'standard'
LEFT JOIN type_distributions AS td_limited
  ON td_limited.classified_pool_type = 'limited'
LEFT JOIN type_distributions AS td_weapon
  ON td_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_distributions AS td_standard
  ON td_standard.classified_pool_type = 'standard';
$$;

GRANT EXECUTE ON FUNCTION public.get_global_stats() TO anon, authenticated;

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 088: get_global_stats 已优化目标 6★ 匹配成本';
END $$;
-- <<< END MIGRATION: archive/088_optimize_global_stats_target_matching.sql

-- >>> BEGIN MIGRATION: archive/089_create_ops_automation_runs_and_announcement_source_fields.sql
-- ============================================
-- 089: 运营自动化运行审计表 + 公告源元数据
--
-- 目标:
--   1. 为自动抓取任务保留可查询的运行记录、差异摘要与人工审核包
--   2. 给 announcements 增加 source_id / source_url / published_at / summary，
--      使自动导入公告与站内手工公告可以并存
-- ============================================

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS source_id TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS summary TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_announcements_source_id
  ON public.announcements(source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_announcements_published_at
  ON public.announcements(published_at DESC);

COMMENT ON COLUMN public.announcements.source_id IS
  '自动同步公告的外部源主键；手工公告可为空。';

COMMENT ON COLUMN public.announcements.source_url IS
  '自动同步公告的原始来源链接。';

COMMENT ON COLUMN public.announcements.published_at IS
  '自动同步公告的原始发布时间。';

COMMENT ON COLUMN public.announcements.summary IS
  '自动同步公告的摘要/导语；手工公告可为空。';

CREATE TABLE IF NOT EXISTS public.ops_automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT NOT NULL,
  job_label TEXT NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'api'
    CHECK (trigger_type IN ('cron', 'manual', 'api')),
  status TEXT NOT NULL
    CHECK (status IN ('success', 'failure', 'skipped')),
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  dedupe_key TEXT,
  source_tag TEXT,
  source_url TEXT,
  summary JSONB,
  top_changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  preview JSONB,
  review_bundle JSONB,
  error_message TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_automation_runs_job_dedupe
  ON public.ops_automation_runs(job_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ops_automation_runs_job_created_at
  ON public.ops_automation_runs(job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_automation_runs_status_created_at
  ON public.ops_automation_runs(status, created_at DESC);

ALTER TABLE public.ops_automation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can view ops automation runs" ON public.ops_automation_runs;
CREATE POLICY "Super admins can view ops automation runs"
  ON public.ops_automation_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

GRANT SELECT ON public.ops_automation_runs TO authenticated;

DROP TRIGGER IF EXISTS update_ops_automation_runs_updated_at ON public.ops_automation_runs;
CREATE TRIGGER update_ops_automation_runs_updated_at
  BEFORE UPDATE ON public.ops_automation_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.ops_automation_runs IS
  '运营自动化任务运行记录：保存 dry-run 差异摘要、人工审核包与失败原因。';

COMMENT ON COLUMN public.ops_automation_runs.dedupe_key IS
  '调度去重键；cron 任务按日去重，避免平台重复投递造成重复审计记录。';

COMMENT ON COLUMN public.ops_automation_runs.review_bundle IS
  '供人工审核/发布的完整审计包快照。';
-- <<< END MIGRATION: archive/089_create_ops_automation_runs_and_announcement_source_fields.sql

-- >>> BEGIN MIGRATION: archive/090_rewrite_global_stats_target_interval.sql
-- ============================================
-- 090: 重写 get_global_stats 的目标 6★ 平均出货口径 + 性能优化
--
-- BUG-035: avgPityTarget / avgPityUp 统一为 totalPulls / upCount
-- PERF-009: 消除 3 次全量排序/物化：
--   1. ordered_valid + six_pity 合并为 six_star_pity（只物化 6★ 行）
--   2. 情报书计数改为 LEAST(credit, actual_count) 聚合，
--      消除 limited_paid_pull_order / info_book_pulls / charged_valid_pulls
--   3. valid_counts 从 type_counts 派生，不再独立扫描
-- ============================================

CREATE OR REPLACE FUNCTION public.get_global_stats()
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH history_base AS MATERIALIZED (
  SELECT
    h.pool_id,
    h.user_id,
    h.record_id,
    h.rarity,
    h.server_id,
    h.region,
    h.special_type,
    h.is_free,
    h.is_standard,
    h.character_name,
    h.item_name,
    p.type AS pool_type,
    p.up_character
  FROM public.history AS h
  LEFT JOIN public.pools AS p ON p.pool_id = h.pool_id
),
six_star_target_matches AS MATERIALIZED (
  SELECT
    hb.pool_id,
    hb.user_id,
    hb.record_id,
    (
      lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) <> ''
      AND (
        lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) LIKE '%' || lower(trim(hb.up_character)) || '%'
        OR lower(trim(hb.up_character)) LIKE '%' || lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) || '%'
      )
    ) AS is_target
  FROM history_base AS hb
  WHERE hb.rarity = 6
    AND hb.up_character IS NOT NULL
    AND hb.up_character <> ''
    AND NOT (hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner'))
),
history_enriched AS MATERIALIZED (
  SELECT
    hb.pool_id,
    hb.user_id,
    hb.record_id,
    hb.rarity,
    hb.server_id,
    hb.region,
    hb.special_type,
    hb.is_free,
    CASE
      WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN true
      WHEN hb.rarity = 6 AND hb.up_character IS NOT NULL AND hb.up_character <> '' THEN NOT COALESCE(stm.is_target, false)
      ELSE COALESCE(hb.is_standard, false)
    END AS is_standard_calc,
    CASE
      WHEN hb.rarity <> 6 THEN false
      WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN false
      ELSE COALESCE(stm.is_target, false)
    END AS is_target_calc,
    CASE
      WHEN hb.pool_type IN ('limited', 'limited_character') THEN 'limited'
      WHEN hb.pool_type IN ('weapon', 'limited_weapon') THEN 'weapon'
      WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN 'standard'
      WHEN split_part(hb.pool_id, '_', 1) = 'special' THEN 'limited'
      WHEN split_part(hb.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
      WHEN COALESCE(hb.is_standard, false) THEN 'standard'
      ELSE 'limited'
    END AS classified_pool_type
  FROM history_base AS hb
  LEFT JOIN six_star_target_matches AS stm
    ON stm.pool_id = hb.pool_id
   AND stm.user_id = hb.user_id
   AND stm.record_id = hb.record_id
),
valid_pulls AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    record_id,
    rarity,
    server_id,
    region,
    is_standard_calc,
    is_target_calc,
    classified_pool_type
  FROM history_enriched
  WHERE special_type IS DISTINCT FROM 'gift'
    AND (is_free IS NOT TRUE)
),
contributor_regions AS MATERIALIZED (
  SELECT
    user_id,
    CASE
      WHEN bool_or(
        COALESCE(server_id, '') IN ('2', '3')
        OR lower(COALESCE(region, '')) IN ('asia', 'sea', 'jp', 'kr', 'tw', 'hk', 'mo', 'sg', 'global', 'international', 'eu', 'na', 'us')
        OR COALESCE(region, '') IN ('亚服', '亚洲', '海外', '欧服', '美服', '欧美')
      ) THEN 'intl'
      ELSE 'cn'
    END AS region_bucket
  FROM valid_pulls
  GROUP BY user_id
),
contributor_region_counts AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE region_bucket = 'cn') AS cn_contributors,
    COUNT(*) FILTER (WHERE region_bucket = 'intl') AS intl_contributors
  FROM contributor_regions
),
-- ── 情报书计数（PERF-009: 消除 ROW_NUMBER + LEFT JOIN 反模式）──
limited_pool_sequence AS MATERIALIZED (
  SELECT
    p.pool_id,
    LEAD(p.pool_id) OVER (
      ORDER BY COALESCE(p.start_time, p.created_at), p.pool_id
    ) AS next_pool_id
  FROM public.pools AS p
  WHERE p.type IN ('limited', 'limited_character')
),
limited_paid_pool_counts AS MATERIALIZED (
  SELECT
    vp.user_id,
    vp.pool_id,
    COUNT(*) AS paid_pull_count
  FROM valid_pulls AS vp
  WHERE vp.classified_pool_type = 'limited'
  GROUP BY vp.user_id, vp.pool_id
),
info_book_credits AS MATERIALIZED (
  SELECT
    lpc.user_id,
    lps.next_pool_id AS pool_id,
    SUM(10) AS credit_pull_count
  FROM limited_paid_pool_counts AS lpc
  JOIN limited_pool_sequence AS lps
    ON lps.pool_id = lpc.pool_id
  WHERE lps.next_pool_id IS NOT NULL
    AND lpc.paid_pull_count >= 60
  GROUP BY lpc.user_id, lps.next_pool_id
),
info_book_pull_total AS MATERIALIZED (
  SELECT COALESCE(SUM(
    LEAST(ibc.credit_pull_count, COALESCE(next_pool.paid_pull_count, 0))
  ), 0) AS info_book_pull_count
  FROM info_book_credits AS ibc
  LEFT JOIN limited_paid_pool_counts AS next_pool
    ON next_pool.user_id = ibc.user_id
   AND next_pool.pool_id = ibc.pool_id
),
-- ── 计数聚合 ──
history_counts AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE special_type IS DISTINCT FROM 'gift') AS total_pulls_with_free,
    COUNT(*) FILTER (WHERE special_type IS DISTINCT FROM 'gift' AND is_free = true) AS free_pull_count,
    COUNT(*) FILTER (WHERE special_type = 'gift') AS gift_total,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'limited'
    ) AS char_gift,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'weapon'
        AND is_standard_calc = false
    ) AS weapon_gift_limited,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'weapon'
        AND is_standard_calc = true
    ) AS weapon_gift_standard
  FROM history_enriched
),
type_counts AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE rarity = 6) AS six,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = false) AS six_star_limited,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = true) AS six_star_standard,
    COUNT(*) FILTER (WHERE rarity = 5) AS five,
    COUNT(*) FILTER (WHERE rarity <= 4) AS four
  FROM valid_pulls
  GROUP BY classified_pool_type
),
-- PERF-009: valid_counts 从 type_counts 派生，不再独立扫描 valid_pulls
valid_counts AS (
  SELECT
    COALESCE(SUM(total), 0) AS total_pulls,
    (SELECT COUNT(*) FROM contributor_regions) AS total_contributors,
    COALESCE(SUM(six), 0) AS six_star_total,
    COALESCE(SUM(six_star_limited), 0) AS six_star_limited,
    COALESCE(SUM(six_star_standard), 0) AS six_star_standard,
    COALESCE(SUM(five), 0) AS five_star,
    COALESCE(SUM(four), 0) AS four_star
  FROM type_counts
),
-- PERF-009: charged_counts 从 type_counts + info_book_pull_total 派生
charged_counts AS (
  SELECT
    COALESCE(tc_l.total, 0) - ibt.info_book_pull_count + COALESCE(tc_s.total, 0) AS charged_character_pulls,
    COALESCE(tc_w.total, 0) AS charged_weapon_pulls,
    COALESCE(tc_l.total, 0) - ibt.info_book_pull_count AS charged_limited_pulls,
    COALESCE(tc_s.total, 0) AS charged_standard_pulls,
    COALESCE(tc_w.total, 0) AS charged_weapon_type_pulls,
    ibt.info_book_pull_count
  FROM info_book_pull_total AS ibt
  LEFT JOIN type_counts AS tc_l ON tc_l.classified_pool_type = 'limited'
  LEFT JOIN type_counts AS tc_s ON tc_s.classified_pool_type = 'standard'
  LEFT JOIN type_counts AS tc_w ON tc_w.classified_pool_type = 'weapon'
),
-- PERF-009: 合并 ordered_valid + six_pity，只物化 6★ 行（~7K vs ~500K）
six_star_pity AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    is_standard_calc,
    is_target_calc,
    classified_pool_type,
    rn,
    LEAST(
      rn - COALESCE(LAG(rn) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0),
      80
    ) AS pity
  FROM (
    SELECT
      pool_id, user_id, rarity, is_standard_calc, is_target_calc, classified_pool_type,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) AS rn
    FROM valid_pulls
  ) AS all_numbered
  WHERE rarity = 6
),
target_hit_rows AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    classified_pool_type,
    rn
  FROM six_star_pity
  WHERE (classified_pool_type = 'limited' AND is_target_calc = true)
     OR (classified_pool_type = 'weapon' AND is_standard_calc = false)
),
limited_first_target AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    MIN(rn) AS first_target_rn
  FROM target_hit_rows
  WHERE classified_pool_type = 'limited'
  GROUP BY pool_id, user_id
),
limited_target_hits AS MATERIALIZED (
  SELECT
    thr.pool_id,
    thr.user_id,
    thr.rn,
    CASE
      WHEN thr.rn = 120
        AND COALESCE(lft.first_target_rn, 999999) = 120
      THEN true
      ELSE false
    END AS is_spark
  FROM target_hit_rows AS thr
  LEFT JOIN limited_first_target AS lft
    ON lft.pool_id = thr.pool_id
   AND lft.user_id = thr.user_id
  WHERE thr.classified_pool_type = 'limited'
),
target_hit_counts AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COUNT(*) AS target_count
  FROM target_hit_rows
  GROUP BY classified_pool_type
),
-- ── 分布 ──
pity_ranges AS MATERIALIZED (
  SELECT
    classified_pool_type,
    is_standard_calc,
    CASE
      WHEN pity BETWEEN 1 AND 10 THEN '01-10'
      WHEN pity BETWEEN 11 AND 20 THEN '11-20'
      WHEN pity BETWEEN 21 AND 30 THEN '21-30'
      WHEN pity BETWEEN 31 AND 40 THEN '31-40'
      WHEN pity BETWEEN 41 AND 50 THEN '41-50'
      WHEN pity BETWEEN 51 AND 60 THEN '51-60'
      WHEN pity BETWEEN 61 AND 70 THEN '61-70'
      WHEN pity BETWEEN 71 AND 80 THEN '71-80'
      WHEN pity BETWEEN 81 AND 90 THEN '81-90'
      ELSE '91+'
    END AS range_label
  FROM six_star_pity
),
global_distribution_rows AS MATERIALIZED (
  SELECT
    range_label,
    COUNT(*) FILTER (WHERE is_standard_calc = false) AS limited_count,
    COUNT(*) FILTER (WHERE is_standard_calc = true) AS standard_count
  FROM pity_ranges
  GROUP BY range_label
),
type_distribution_rows AS MATERIALIZED (
  SELECT
    classified_pool_type,
    range_label,
    COUNT(*) FILTER (WHERE is_standard_calc = false) AS limited_count,
    COUNT(*) FILTER (WHERE is_standard_calc = true) AS standard_count
  FROM pity_ranges
  GROUP BY classified_pool_type, range_label
),
global_distribution AS MATERIALIZED (
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'range', REPLACE(range_label, '01-10', '1-10'),
        'limited', limited_count,
        'standard', standard_count
      )
      ORDER BY range_label
    ),
    '[]'::json
  ) AS distribution
  FROM global_distribution_rows
),
type_distributions AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COALESCE(
      json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        )
        ORDER BY range_label
      ),
      '[]'::json
    ) AS distribution
  FROM type_distribution_rows
  GROUP BY classified_pool_type
),
-- ── 均值 ──
global_avg_pity AS MATERIALIZED (
  SELECT ROUND(AVG(pity)::numeric, 1) AS avg_pity
  FROM six_star_pity
),
type_pity_stats AS MATERIALIZED (
  SELECT
    classified_pool_type,
    ROUND(AVG(pity)::numeric, 1) AS avg_pity
  FROM six_star_pity
  GROUP BY classified_pool_type
),
-- BUG-035: avgPityTarget = totalPulls / upCount
target_pity_stats AS MATERIALIZED (
  SELECT
    tc.classified_pool_type,
    ROUND(
      tc.total::numeric / NULLIF(thc.target_count, 0),
      1
    ) AS avg_pity_target
  FROM type_counts AS tc
  JOIN target_hit_counts AS thc
    ON thc.classified_pool_type = tc.classified_pool_type
  WHERE tc.classified_pool_type IN ('limited', 'weapon')
),
limited_spark_stats AS MATERIALIZED (
  SELECT
    COUNT(DISTINCT user_id) FILTER (WHERE is_spark = true) AS spark_count
  FROM limited_target_hits
),
total_users AS MATERIALIZED (
  SELECT COUNT(*) AS total_users
  FROM public.profiles
)
SELECT json_build_object(
  'totalPulls', COALESCE(vc.total_pulls, 0),
  'totalPullsWithFree', COALESCE(hc.total_pulls_with_free, 0),
  'freePullCount', COALESCE(hc.free_pull_count, 0),
  'chargedCharacterPulls', COALESCE(cc.charged_character_pulls, 0),
  'chargedWeaponPulls', COALESCE(cc.charged_weapon_pulls, 0),
  'infoBookPullCount', COALESCE(cc.info_book_pull_count, 0),
  'totalUsers', COALESCE(tu.total_users, 0),
  'totalContributors', COALESCE(vc.total_contributors, 0),
  'contributorsByRegion', json_build_object(
    'cn', COALESCE(crc.cn_contributors, 0),
    'intl', COALESCE(crc.intl_contributors, 0)
  ),
  'sixStarTotal', COALESCE(vc.six_star_total, 0),
  'sixStarLimited', COALESCE(vc.six_star_limited, 0),
  'sixStarStandard', COALESCE(vc.six_star_standard, 0),
  'fiveStar', COALESCE(vc.five_star, 0),
  'fourStar', COALESCE(vc.four_star, 0),
  'avgPity', COALESCE(gap.avg_pity, 0),
  'counts', json_build_object(
    '6', COALESCE(vc.six_star_limited, 0),
    '6_std', COALESCE(vc.six_star_standard, 0),
    '5', COALESCE(vc.five_star, 0),
    '4', COALESCE(vc.four_star, 0)
  ),
  'distribution', COALESCE(gd.distribution, '[]'::json),
  'byType', json_build_object(
    'limited', json_build_object(
      'total', COALESCE(tc_limited.total, 0),
      'chargedPulls', COALESCE(cc.charged_limited_pulls, 0),
      'six', COALESCE(tc_limited.six, 0),
      'sixStarLimited', COALESCE(tc_limited.six_star_limited, 0),
      'sixStarStandard', COALESCE(tc_limited.six_star_standard, 0),
      'avgPity', COALESCE(tps_limited.avg_pity, 0),
      'avgPityUp', COALESCE(tgt_limited.avg_pity_target, 0),
      'avgPityTarget', COALESCE(tgt_limited.avg_pity_target, 0),
      'sparkCount', COALESCE(lss.spark_count, 0),
      'counts', json_build_object(
        '6', COALESCE(tc_limited.six_star_limited, 0),
        '6_std', COALESCE(tc_limited.six_star_standard, 0),
        '5', COALESCE(tc_limited.five, 0),
        '4', COALESCE(tc_limited.four, 0)
      ),
      'distribution', COALESCE(td_limited.distribution, '[]'::json)
    ),
    'weapon', json_build_object(
      'total', COALESCE(tc_weapon.total, 0),
      'chargedPulls', COALESCE(cc.charged_weapon_type_pulls, 0),
      'six', COALESCE(tc_weapon.six, 0),
      'sixStarLimited', COALESCE(tc_weapon.six_star_limited, 0),
      'sixStarStandard', COALESCE(tc_weapon.six_star_standard, 0),
      'avgPity', COALESCE(tps_weapon.avg_pity, 0),
      'avgPityUp', COALESCE(tgt_weapon.avg_pity_target, 0),
      'avgPityTarget', COALESCE(tgt_weapon.avg_pity_target, 0),
      'counts', json_build_object(
        '6', COALESCE(tc_weapon.six_star_limited, 0),
        '6_std', COALESCE(tc_weapon.six_star_standard, 0),
        '5', COALESCE(tc_weapon.five, 0),
        '4', COALESCE(tc_weapon.four, 0)
      ),
      'distribution', COALESCE(td_weapon.distribution, '[]'::json)
    ),
    'standard', json_build_object(
      'total', COALESCE(tc_standard.total, 0),
      'chargedPulls', COALESCE(cc.charged_standard_pulls, 0),
      'six', COALESCE(tc_standard.six, 0),
      'sixStarLimited', 0,
      'sixStarStandard', COALESCE(tc_standard.six, 0),
      'avgPity', COALESCE(tps_standard.avg_pity, 0),
      'counts', json_build_object(
        '6', 0,
        '6_std', COALESCE(tc_standard.six, 0),
        '5', COALESCE(tc_standard.five, 0),
        '4', COALESCE(tc_standard.four, 0)
      ),
      'distribution', COALESCE(td_standard.distribution, '[]'::json)
    )
  ),
  'charGift', COALESCE(hc.char_gift, 0),
  'weaponGiftLimited', COALESCE(hc.weapon_gift_limited, 0),
  'weaponGiftStandard', COALESCE(hc.weapon_gift_standard, 0),
  'giftTotal', COALESCE(hc.gift_total, 0)
)
FROM valid_counts AS vc
CROSS JOIN history_counts AS hc
CROSS JOIN charged_counts AS cc
CROSS JOIN global_avg_pity AS gap
CROSS JOIN global_distribution AS gd
CROSS JOIN total_users AS tu
CROSS JOIN contributor_region_counts AS crc
CROSS JOIN limited_spark_stats AS lss
LEFT JOIN type_counts AS tc_limited
  ON tc_limited.classified_pool_type = 'limited'
LEFT JOIN type_counts AS tc_weapon
  ON tc_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_counts AS tc_standard
  ON tc_standard.classified_pool_type = 'standard'
LEFT JOIN type_pity_stats AS tps_limited
  ON tps_limited.classified_pool_type = 'limited'
LEFT JOIN type_pity_stats AS tps_weapon
  ON tps_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_pity_stats AS tps_standard
  ON tps_standard.classified_pool_type = 'standard'
LEFT JOIN target_pity_stats AS tgt_limited
  ON tgt_limited.classified_pool_type = 'limited'
LEFT JOIN target_pity_stats AS tgt_weapon
  ON tgt_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_distributions AS td_limited
  ON td_limited.classified_pool_type = 'limited'
LEFT JOIN type_distributions AS td_weapon
  ON td_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_distributions AS td_standard
  ON td_standard.classified_pool_type = 'standard';
$$;

GRANT EXECUTE ON FUNCTION public.get_global_stats() TO anon, authenticated;

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 090: get_global_stats — BUG-035 口径修复 + PERF-009 消除 3 次全量排序';
END $$;
-- <<< END MIGRATION: archive/090_rewrite_global_stats_target_interval.sql

-- >>> BEGIN MIGRATION: archive/091_stats_cache_infrastructure.sql
-- ============================================
-- 091: 统计缓存基础设施 (PERF-009)
--
-- 背景:
--   get_global_stats / get_character_ranking_stats / get_user_ranking_stats
--   每次调用都全量扫描 ~60 万行 history 表，即使数据没有变化。
--
-- 目标:
--   1. 创建 stats_cache 表存储预计算结果
--   2. 创建 cached wrapper RPC，通过 count(*) 变更检测 + 缓冲期
--      避免无意义的重复计算
--   3. 全服统计/排名缓冲期 300s，用户排名缓冲期 120s
--   4. 最大 TTL 兜底（全服 24h，用户 6h），防止永不刷新
-- ============================================

-- ── stats_cache 表 ──
CREATE TABLE IF NOT EXISTS public.stats_cache (
  cache_key       TEXT PRIMARY KEY,
  cached_data     JSONB NOT NULL,
  row_fingerprint BIGINT NOT NULL DEFAULT 0,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stats_cache ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.stats_cache IS 'PERF-009: 统计 RPC 结果缓存，通过 history 行数变更检测避免重复计算';

-- ── get_global_stats_cached ──
CREATE OR REPLACE FUNCTION public.get_global_stats_cached(
  p_buffer_seconds INT DEFAULT 300
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count BIGINT;
  v_cached_data   JSONB;
  v_cached_fp     BIGINT;
  v_cached_at     TIMESTAMPTZ;
  v_result        JSON;
  v_max_ttl       INTERVAL := INTERVAL '24 hours';
BEGIN
  SELECT count(*) INTO v_current_count FROM public.history;

  SELECT cached_data, row_fingerprint, computed_at
    INTO v_cached_data, v_cached_fp, v_cached_at
    FROM public.stats_cache
   WHERE cache_key = 'global_stats';

  IF v_cached_data IS NOT NULL THEN
    IF v_cached_fp = v_current_count
       AND v_cached_at + v_max_ttl > now() THEN
      RETURN v_cached_data::JSON;
    END IF;

    IF v_cached_fp <> v_current_count
       AND v_cached_at + (p_buffer_seconds || ' seconds')::INTERVAL > now() THEN
      RETURN v_cached_data::JSON;
    END IF;
  END IF;

  SELECT public.get_global_stats() INTO v_result;

  INSERT INTO public.stats_cache (cache_key, cached_data, row_fingerprint, computed_at)
  VALUES ('global_stats', v_result::JSONB, v_current_count, now())
  ON CONFLICT (cache_key) DO UPDATE SET
    cached_data     = EXCLUDED.cached_data,
    row_fingerprint = EXCLUDED.row_fingerprint,
    computed_at     = EXCLUDED.computed_at;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_global_stats_cached(INT)
  SET statement_timeout = '120s';

GRANT EXECUTE ON FUNCTION public.get_global_stats_cached(INT) TO anon, authenticated;

-- ── get_character_ranking_stats_cached ──
CREATE OR REPLACE FUNCTION public.get_character_ranking_stats_cached(
  p_buffer_seconds INT DEFAULT 300
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count BIGINT;
  v_cached_data   JSONB;
  v_cached_fp     BIGINT;
  v_cached_at     TIMESTAMPTZ;
  v_result        JSON;
  v_max_ttl       INTERVAL := INTERVAL '24 hours';
BEGIN
  SELECT count(*) INTO v_current_count FROM public.history;

  SELECT cached_data, row_fingerprint, computed_at
    INTO v_cached_data, v_cached_fp, v_cached_at
    FROM public.stats_cache
   WHERE cache_key = 'character_ranking';

  IF v_cached_data IS NOT NULL THEN
    IF v_cached_fp = v_current_count
       AND v_cached_at + v_max_ttl > now() THEN
      RETURN v_cached_data::JSON;
    END IF;

    IF v_cached_fp <> v_current_count
       AND v_cached_at + (p_buffer_seconds || ' seconds')::INTERVAL > now() THEN
      RETURN v_cached_data::JSON;
    END IF;
  END IF;

  SELECT public.get_character_ranking_stats() INTO v_result;

  INSERT INTO public.stats_cache (cache_key, cached_data, row_fingerprint, computed_at)
  VALUES ('character_ranking', v_result::JSONB, v_current_count, now())
  ON CONFLICT (cache_key) DO UPDATE SET
    cached_data     = EXCLUDED.cached_data,
    row_fingerprint = EXCLUDED.row_fingerprint,
    computed_at     = EXCLUDED.computed_at;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_character_ranking_stats_cached(INT)
  SET statement_timeout = '90s';

GRANT EXECUTE ON FUNCTION public.get_character_ranking_stats_cached(INT) TO anon, authenticated;

-- ── get_user_ranking_stats_cached ──
CREATE OR REPLACE FUNCTION public.get_user_ranking_stats_cached(
  p_user_id UUID,
  p_buffer_seconds INT DEFAULT 120
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count BIGINT;
  v_cache_key     TEXT;
  v_cached_data   JSONB;
  v_cached_fp     BIGINT;
  v_cached_at     TIMESTAMPTZ;
  v_result        JSON;
  v_max_ttl       INTERVAL := INTERVAL '6 hours';
BEGIN
  SELECT count(*) INTO v_current_count
    FROM public.history
   WHERE user_id = p_user_id;

  v_cache_key := 'user_ranking:' || p_user_id::TEXT;

  SELECT cached_data, row_fingerprint, computed_at
    INTO v_cached_data, v_cached_fp, v_cached_at
    FROM public.stats_cache
   WHERE cache_key = v_cache_key;

  IF v_cached_data IS NOT NULL THEN
    IF v_cached_fp = v_current_count
       AND v_cached_at + v_max_ttl > now() THEN
      RETURN v_cached_data::JSON;
    END IF;

    IF v_cached_fp <> v_current_count
       AND v_cached_at + (p_buffer_seconds || ' seconds')::INTERVAL > now() THEN
      RETURN v_cached_data::JSON;
    END IF;
  END IF;

  SELECT public.get_user_ranking_stats(p_user_id) INTO v_result;

  INSERT INTO public.stats_cache (cache_key, cached_data, row_fingerprint, computed_at)
  VALUES (v_cache_key, v_result::JSONB, v_current_count, now())
  ON CONFLICT (cache_key) DO UPDATE SET
    cached_data     = EXCLUDED.cached_data,
    row_fingerprint = EXCLUDED.row_fingerprint,
    computed_at     = EXCLUDED.computed_at;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_user_ranking_stats_cached(UUID, INT)
  SET statement_timeout = '90s';

GRANT EXECUTE ON FUNCTION public.get_user_ranking_stats_cached(UUID, INT) TO anon, authenticated;

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 091: stats_cache 基础设施 — PERF-009 变更感知缓存';
END $$;
-- <<< END MIGRATION: archive/091_stats_cache_infrastructure.sql

-- >>> BEGIN MIGRATION: archive/092_pool_alias_source_official_notice.sql
-- ============================================
-- 092: 扩展 pool_id_aliases.source 枚举
-- ============================================
-- 增加 'official_notice' 来源，用于自动化从官方公告解析出的卡池 ID

ALTER TABLE public.pool_id_aliases
  DROP CONSTRAINT IF EXISTS pool_id_aliases_source_check;

ALTER TABLE public.pool_id_aliases
  ADD CONSTRAINT pool_id_aliases_source_check CHECK (
    source IN (
      'internal',
      'official_api',
      'official_notice',
      'legacy_manual',
      'manual_placeholder',
      'import_raw',
      'custom'
    )
  );

COMMENT ON COLUMN public.pool_id_aliases.source IS
  'alias 来源：internal / official_api / official_notice / legacy_manual / manual_placeholder / import_raw / custom';
-- <<< END MIGRATION: archive/092_pool_alias_source_official_notice.sql

-- >>> BEGIN MIGRATION: archive/093_site_config_content_blocks.sql
-- 093: 将硬编码的首页/关于页运营内容迁移到 site_config (ARCH-023)

INSERT INTO site_config (key, value, label, category) VALUES
  (
    'home_roadmap_items',
    '[{"id":"sim-inherit","icon":"RefreshCw","title":"模拟器状态继承","description":"卡池模拟器支持继承游戏内的真实抽卡与保底状态","status":"completed","priority":"high"},{"id":"puzzle-captcha","icon":"Shield","title":"拼图验证码","description":"主站验证码已切换为简单拼图玩法，并保留备用方式","status":"completed","priority":"high"},{"id":"global-support","icon":"Globe","title":"国际服支持","description":"现已支持国际服抽卡记录的解析与导入","status":"completed","priority":"high"},{"id":"currency-calc","icon":"Calculator","title":"资源消耗换算","description":"现已支持换算已消耗合成玉、源石数量及武库配额","status":"completed","priority":"medium"},{"id":"sim-currency","icon":"Database","title":"模拟器资源机制","description":"模拟器已加入合成玉、源石与武库配额机制","status":"completed","priority":"medium"},{"id":"share","icon":"Share2","title":"分享功能","description":"模拟器支持脱敏分享卡图片、系统分享与文本复制","status":"completed","priority":"medium"},{"id":"i18n","icon":"Languages","title":"国际化支持","description":"支持英语、日语等多语言界面，服务更多玩家","status":"planned","priority":"low"},{"id":"a11y","icon":"Accessibility","title":"无障碍优化","description":"完善ARIA标签和键盘导航，提升可访问性","status":"planned","priority":"low"},{"id":"virtual-scroll","icon":"Database","title":"虚拟滚动","description":"优化长列表性能，支持更大数据量的流畅浏览","status":"planned","priority":"low"}]',
    '首页路线图条目',
    'content'
  ),
  (
    'home_friendly_links',
    '[{"title":"一图流攒抽计算器","url":"https://ef.yituliu.cn/tools/gacha-calculator","icon":"BarChart3","label":"RESOURCE PLANNER"},{"title":"终末地地图（1）","url":"https://opendfieldmap.cn/","icon":"Map","label":"OPEN WORLD MAP"},{"title":"终末地地图（笋干）","url":"https://www.zmdmap.com/","icon":"Map","label":"GAME MAP WIKI"},{"title":"同样优秀的抽卡记录分析（还有舟本体的）","url":"https://endgacha.kwer.top/","icon":"BarChart3","label":"GACHA ANALYZER"}]',
    '首页友情链接',
    'content'
  ),
  (
    'about_features',
    '[{"icon":"Star","label":"卡池管理","desc":"限定/常驻/武器池"},{"icon":"Calculator","label":"抽卡模拟","desc":"真实概率 + 机制复刻"},{"icon":"BarChart3","label":"欧非分析","desc":"不歪率/平均出货"},{"icon":"Cloud","label":"云端缓存","desc":"三级降级策略加速"},{"icon":"Download","label":"数据导入","desc":"批量粘贴 + OCR预告"},{"icon":"Shield","label":"全球统计","desc":"\"急\"按钮实时同步"}]',
    '关于页功能特性列表',
    'content'
  ),
  (
    'about_disclaimer',
    '非官方工具。与 Gryphline / HyperGryph 无关。',
    '关于页免责声明',
    'content'
  ),
  (
    'home_hero_slogan',
    '记录抽卡历程，查看卡池分析、统计汇总与模拟器数据。',
    '首页 Hero 标语',
    'content'
  ),
  (
    'qq_group_number',
    '1080983185',
    'QQ 群号',
    'social'
  )
ON CONFLICT (key) DO NOTHING;
-- <<< END MIGRATION: archive/093_site_config_content_blocks.sql

-- >>> BEGIN MIGRATION: archive/094_backfill_history_server_id.sql
-- 094: backfill history.server_id / region and invalidate stats cache

-- 1) INTL: game_uid does not start with '1', is not empty
UPDATE public.history
SET server_id = '2',
    region    = 'intl'
WHERE server_id IS NULL
  AND game_uid IS NOT NULL
  AND game_uid <> ''
  AND NOT (game_uid ~ '^1[0-9]+$');

-- 2) Remaining NULL records default to CN
UPDATE public.history
SET server_id = '1',
    region    = 'cn'
WHERE server_id IS NULL;

-- 3) Invalidate global stats cache
DELETE FROM public.stats_cache WHERE cache_key = 'global_stats';
-- <<< END MIGRATION: archive/094_backfill_history_server_id.sql

-- >>> BEGIN MIGRATION: archive/095_spark_count_to_occurrences.sql
-- 095: Change sparkCount from distinct users to total occurrences
--
-- Previously: COUNT(DISTINCT user_id) FILTER (WHERE is_spark = true)
--   = number of users who hit 120-pity at least once
-- Now:        COUNT(*) FILTER (WHERE is_spark = true)
--   = total number of 120-pity spark events across all users
--
-- Minimal patch: identical to 090 except limited_spark_stats CTE.

CREATE OR REPLACE FUNCTION public.get_global_stats()
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH history_base AS MATERIALIZED (
  SELECT
    h.pool_id,
    h.user_id,
    h.record_id,
    h.rarity,
    h.server_id,
    h.region,
    h.special_type,
    h.is_free,
    h.is_standard,
    h.character_name,
    h.item_name,
    p.type AS pool_type,
    p.up_character
  FROM public.history AS h
  LEFT JOIN public.pools AS p ON p.pool_id = h.pool_id
),
six_star_target_matches AS MATERIALIZED (
  SELECT
    hb.pool_id,
    hb.user_id,
    hb.record_id,
    (
      lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) <> ''
      AND (
        lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) LIKE '%' || lower(trim(hb.up_character)) || '%'
        OR lower(trim(hb.up_character)) LIKE '%' || lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) || '%'
      )
    ) AS is_target
  FROM history_base AS hb
  WHERE hb.rarity = 6
    AND hb.up_character IS NOT NULL
    AND hb.up_character <> ''
    AND NOT (hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner'))
),
history_enriched AS MATERIALIZED (
  SELECT
    hb.pool_id,
    hb.user_id,
    hb.record_id,
    hb.rarity,
    hb.server_id,
    hb.region,
    hb.special_type,
    hb.is_free,
    CASE
      WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN true
      WHEN hb.rarity = 6 AND hb.up_character IS NOT NULL AND hb.up_character <> '' THEN NOT COALESCE(stm.is_target, false)
      ELSE COALESCE(hb.is_standard, false)
    END AS is_standard_calc,
    CASE
      WHEN hb.rarity <> 6 THEN false
      WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN false
      ELSE COALESCE(stm.is_target, false)
    END AS is_target_calc,
    CASE
      WHEN hb.pool_type IN ('limited', 'limited_character') THEN 'limited'
      WHEN hb.pool_type IN ('weapon', 'limited_weapon') THEN 'weapon'
      WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN 'standard'
      WHEN split_part(hb.pool_id, '_', 1) = 'special' THEN 'limited'
      WHEN split_part(hb.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
      WHEN COALESCE(hb.is_standard, false) THEN 'standard'
      ELSE 'limited'
    END AS classified_pool_type
  FROM history_base AS hb
  LEFT JOIN six_star_target_matches AS stm
    ON stm.pool_id = hb.pool_id
   AND stm.user_id = hb.user_id
   AND stm.record_id = hb.record_id
),
valid_pulls AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    record_id,
    rarity,
    server_id,
    region,
    is_standard_calc,
    is_target_calc,
    classified_pool_type
  FROM history_enriched
  WHERE special_type IS DISTINCT FROM 'gift'
    AND (is_free IS NOT TRUE)
),
contributor_regions AS MATERIALIZED (
  SELECT
    user_id,
    CASE
      WHEN bool_or(
        COALESCE(server_id, '') IN ('2', '3')
        OR lower(COALESCE(region, '')) IN ('asia', 'sea', 'jp', 'kr', 'tw', 'hk', 'mo', 'sg', 'global', 'international', 'eu', 'na', 'us')
        OR COALESCE(region, '') IN ('intl')
      ) THEN 'intl'
      ELSE 'cn'
    END AS region_bucket
  FROM valid_pulls
  GROUP BY user_id
),
contributor_region_counts AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE region_bucket = 'cn') AS cn_contributors,
    COUNT(*) FILTER (WHERE region_bucket = 'intl') AS intl_contributors
  FROM contributor_regions
),
limited_pool_sequence AS MATERIALIZED (
  SELECT
    p.pool_id,
    LEAD(p.pool_id) OVER (
      ORDER BY COALESCE(p.start_time, p.created_at), p.pool_id
    ) AS next_pool_id
  FROM public.pools AS p
  WHERE p.type IN ('limited', 'limited_character')
),
limited_paid_pool_counts AS MATERIALIZED (
  SELECT
    vp.user_id,
    vp.pool_id,
    COUNT(*) AS paid_pull_count
  FROM valid_pulls AS vp
  WHERE vp.classified_pool_type = 'limited'
  GROUP BY vp.user_id, vp.pool_id
),
info_book_credits AS MATERIALIZED (
  SELECT
    lpc.user_id,
    lps.next_pool_id AS pool_id,
    SUM(10) AS credit_pull_count
  FROM limited_paid_pool_counts AS lpc
  JOIN limited_pool_sequence AS lps
    ON lps.pool_id = lpc.pool_id
  WHERE lps.next_pool_id IS NOT NULL
    AND lpc.paid_pull_count >= 60
  GROUP BY lpc.user_id, lps.next_pool_id
),
info_book_pull_total AS MATERIALIZED (
  SELECT COALESCE(SUM(
    LEAST(ibc.credit_pull_count, COALESCE(next_pool.paid_pull_count, 0))
  ), 0) AS info_book_pull_count
  FROM info_book_credits AS ibc
  LEFT JOIN limited_paid_pool_counts AS next_pool
    ON next_pool.user_id = ibc.user_id
   AND next_pool.pool_id = ibc.pool_id
),
history_counts AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE special_type IS DISTINCT FROM 'gift') AS total_pulls_with_free,
    COUNT(*) FILTER (WHERE special_type IS DISTINCT FROM 'gift' AND is_free = true) AS free_pull_count,
    COUNT(*) FILTER (WHERE special_type = 'gift') AS gift_total,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'limited'
    ) AS char_gift,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'weapon'
        AND is_standard_calc = false
    ) AS weapon_gift_limited,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'weapon'
        AND is_standard_calc = true
    ) AS weapon_gift_standard
  FROM history_enriched
),
type_counts AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE rarity = 6) AS six,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = false) AS six_star_limited,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = true) AS six_star_standard,
    COUNT(*) FILTER (WHERE rarity = 5) AS five,
    COUNT(*) FILTER (WHERE rarity <= 4) AS four
  FROM valid_pulls
  GROUP BY classified_pool_type
),
valid_counts AS (
  SELECT
    COALESCE(SUM(total), 0) AS total_pulls,
    (SELECT COUNT(*) FROM contributor_regions) AS total_contributors,
    COALESCE(SUM(six), 0) AS six_star_total,
    COALESCE(SUM(six_star_limited), 0) AS six_star_limited,
    COALESCE(SUM(six_star_standard), 0) AS six_star_standard,
    COALESCE(SUM(five), 0) AS five_star,
    COALESCE(SUM(four), 0) AS four_star
  FROM type_counts
),
charged_counts AS (
  SELECT
    COALESCE(tc_l.total, 0) - ibt.info_book_pull_count + COALESCE(tc_s.total, 0) AS charged_character_pulls,
    COALESCE(tc_w.total, 0) AS charged_weapon_pulls,
    COALESCE(tc_l.total, 0) - ibt.info_book_pull_count AS charged_limited_pulls,
    COALESCE(tc_s.total, 0) AS charged_standard_pulls,
    COALESCE(tc_w.total, 0) AS charged_weapon_type_pulls,
    ibt.info_book_pull_count
  FROM info_book_pull_total AS ibt
  LEFT JOIN type_counts AS tc_l ON tc_l.classified_pool_type = 'limited'
  LEFT JOIN type_counts AS tc_s ON tc_s.classified_pool_type = 'standard'
  LEFT JOIN type_counts AS tc_w ON tc_w.classified_pool_type = 'weapon'
),
six_star_pity AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    is_standard_calc,
    is_target_calc,
    classified_pool_type,
    rn,
    LEAST(
      rn - COALESCE(LAG(rn) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0),
      80
    ) AS pity
  FROM (
    SELECT
      pool_id, user_id, rarity, is_standard_calc, is_target_calc, classified_pool_type,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) AS rn
    FROM valid_pulls
  ) AS all_numbered
  WHERE rarity = 6
),
target_hit_rows AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    classified_pool_type,
    rn
  FROM six_star_pity
  WHERE (classified_pool_type = 'limited' AND is_target_calc = true)
     OR (classified_pool_type = 'weapon' AND is_standard_calc = false)
),
limited_first_target AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    MIN(rn) AS first_target_rn
  FROM target_hit_rows
  WHERE classified_pool_type = 'limited'
  GROUP BY pool_id, user_id
),
limited_target_hits AS MATERIALIZED (
  SELECT
    thr.pool_id,
    thr.user_id,
    thr.rn,
    CASE
      WHEN thr.rn = 120
        AND COALESCE(lft.first_target_rn, 999999) = 120
      THEN true
      ELSE false
    END AS is_spark
  FROM target_hit_rows AS thr
  LEFT JOIN limited_first_target AS lft
    ON lft.pool_id = thr.pool_id
   AND lft.user_id = thr.user_id
  WHERE thr.classified_pool_type = 'limited'
),
target_hit_counts AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COUNT(*) AS target_count
  FROM target_hit_rows
  GROUP BY classified_pool_type
),
pity_ranges AS MATERIALIZED (
  SELECT
    classified_pool_type,
    is_standard_calc,
    CASE
      WHEN pity BETWEEN 1 AND 10 THEN '01-10'
      WHEN pity BETWEEN 11 AND 20 THEN '11-20'
      WHEN pity BETWEEN 21 AND 30 THEN '21-30'
      WHEN pity BETWEEN 31 AND 40 THEN '31-40'
      WHEN pity BETWEEN 41 AND 50 THEN '41-50'
      WHEN pity BETWEEN 51 AND 60 THEN '51-60'
      WHEN pity BETWEEN 61 AND 70 THEN '61-70'
      WHEN pity BETWEEN 71 AND 80 THEN '71-80'
      WHEN pity BETWEEN 81 AND 90 THEN '81-90'
      ELSE '91+'
    END AS range_label
  FROM six_star_pity
),
global_distribution_rows AS MATERIALIZED (
  SELECT
    range_label,
    COUNT(*) FILTER (WHERE is_standard_calc = false) AS limited_count,
    COUNT(*) FILTER (WHERE is_standard_calc = true) AS standard_count
  FROM pity_ranges
  GROUP BY range_label
),
type_distribution_rows AS MATERIALIZED (
  SELECT
    classified_pool_type,
    range_label,
    COUNT(*) FILTER (WHERE is_standard_calc = false) AS limited_count,
    COUNT(*) FILTER (WHERE is_standard_calc = true) AS standard_count
  FROM pity_ranges
  GROUP BY classified_pool_type, range_label
),
global_distribution AS MATERIALIZED (
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'range', REPLACE(range_label, '01-10', '1-10'),
        'limited', limited_count,
        'standard', standard_count
      )
      ORDER BY range_label
    ),
    '[]'::json
  ) AS distribution
  FROM global_distribution_rows
),
type_distributions AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COALESCE(
      json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        )
        ORDER BY range_label
      ),
      '[]'::json
    ) AS distribution
  FROM type_distribution_rows
  GROUP BY classified_pool_type
),
global_avg_pity AS MATERIALIZED (
  SELECT ROUND(AVG(pity)::numeric, 1) AS avg_pity
  FROM six_star_pity
),
type_pity_stats AS MATERIALIZED (
  SELECT
    classified_pool_type,
    ROUND(AVG(pity)::numeric, 1) AS avg_pity
  FROM six_star_pity
  GROUP BY classified_pool_type
),
target_pity_stats AS MATERIALIZED (
  SELECT
    tc.classified_pool_type,
    ROUND(
      tc.total::numeric / NULLIF(thc.target_count, 0),
      1
    ) AS avg_pity_target
  FROM type_counts AS tc
  JOIN target_hit_counts AS thc
    ON thc.classified_pool_type = tc.classified_pool_type
  WHERE tc.classified_pool_type IN ('limited', 'weapon')
),
-- 095: Changed from COUNT(DISTINCT user_id) to COUNT(*) for spark occurrences
limited_spark_stats AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE is_spark = true) AS spark_count
  FROM limited_target_hits
),
total_users AS MATERIALIZED (
  SELECT COUNT(*) AS total_users
  FROM public.profiles
)
SELECT json_build_object(
  'totalPulls', COALESCE(vc.total_pulls, 0),
  'totalPullsWithFree', COALESCE(hc.total_pulls_with_free, 0),
  'freePullCount', COALESCE(hc.free_pull_count, 0),
  'chargedCharacterPulls', COALESCE(cc.charged_character_pulls, 0),
  'chargedWeaponPulls', COALESCE(cc.charged_weapon_pulls, 0),
  'infoBookPullCount', COALESCE(cc.info_book_pull_count, 0),
  'totalUsers', COALESCE(tu.total_users, 0),
  'totalContributors', COALESCE(vc.total_contributors, 0),
  'contributorsByRegion', json_build_object(
    'cn', COALESCE(crc.cn_contributors, 0),
    'intl', COALESCE(crc.intl_contributors, 0)
  ),
  'sixStarTotal', COALESCE(vc.six_star_total, 0),
  'sixStarLimited', COALESCE(vc.six_star_limited, 0),
  'sixStarStandard', COALESCE(vc.six_star_standard, 0),
  'fiveStar', COALESCE(vc.five_star, 0),
  'fourStar', COALESCE(vc.four_star, 0),
  'avgPity', COALESCE(gap.avg_pity, 0),
  'counts', json_build_object(
    '6', COALESCE(vc.six_star_limited, 0),
    '6_std', COALESCE(vc.six_star_standard, 0),
    '5', COALESCE(vc.five_star, 0),
    '4', COALESCE(vc.four_star, 0)
  ),
  'distribution', COALESCE(gd.distribution, '[]'::json),
  'byType', json_build_object(
    'limited', json_build_object(
      'total', COALESCE(tc_limited.total, 0),
      'chargedPulls', COALESCE(cc.charged_limited_pulls, 0),
      'six', COALESCE(tc_limited.six, 0),
      'sixStarLimited', COALESCE(tc_limited.six_star_limited, 0),
      'sixStarStandard', COALESCE(tc_limited.six_star_standard, 0),
      'avgPity', COALESCE(tps_limited.avg_pity, 0),
      'avgPityUp', COALESCE(tgt_limited.avg_pity_target, 0),
      'avgPityTarget', COALESCE(tgt_limited.avg_pity_target, 0),
      'sparkCount', COALESCE(lss.spark_count, 0),
      'counts', json_build_object(
        '6', COALESCE(tc_limited.six_star_limited, 0),
        '6_std', COALESCE(tc_limited.six_star_standard, 0),
        '5', COALESCE(tc_limited.five, 0),
        '4', COALESCE(tc_limited.four, 0)
      ),
      'distribution', COALESCE(td_limited.distribution, '[]'::json)
    ),
    'weapon', json_build_object(
      'total', COALESCE(tc_weapon.total, 0),
      'chargedPulls', COALESCE(cc.charged_weapon_type_pulls, 0),
      'six', COALESCE(tc_weapon.six, 0),
      'sixStarLimited', COALESCE(tc_weapon.six_star_limited, 0),
      'sixStarStandard', COALESCE(tc_weapon.six_star_standard, 0),
      'avgPity', COALESCE(tps_weapon.avg_pity, 0),
      'avgPityUp', COALESCE(tgt_weapon.avg_pity_target, 0),
      'avgPityTarget', COALESCE(tgt_weapon.avg_pity_target, 0),
      'counts', json_build_object(
        '6', COALESCE(tc_weapon.six_star_limited, 0),
        '6_std', COALESCE(tc_weapon.six_star_standard, 0),
        '5', COALESCE(tc_weapon.five, 0),
        '4', COALESCE(tc_weapon.four, 0)
      ),
      'distribution', COALESCE(td_weapon.distribution, '[]'::json)
    ),
    'standard', json_build_object(
      'total', COALESCE(tc_standard.total, 0),
      'chargedPulls', COALESCE(cc.charged_standard_pulls, 0),
      'six', COALESCE(tc_standard.six, 0),
      'sixStarLimited', 0,
      'sixStarStandard', COALESCE(tc_standard.six, 0),
      'avgPity', COALESCE(tps_standard.avg_pity, 0),
      'counts', json_build_object(
        '6', 0,
        '6_std', COALESCE(tc_standard.six, 0),
        '5', COALESCE(tc_standard.five, 0),
        '4', COALESCE(tc_standard.four, 0)
      ),
      'distribution', COALESCE(td_standard.distribution, '[]'::json)
    )
  ),
  'charGift', COALESCE(hc.char_gift, 0),
  'weaponGiftLimited', COALESCE(hc.weapon_gift_limited, 0),
  'weaponGiftStandard', COALESCE(hc.weapon_gift_standard, 0),
  'giftTotal', COALESCE(hc.gift_total, 0)
)
FROM valid_counts AS vc
CROSS JOIN history_counts AS hc
CROSS JOIN charged_counts AS cc
CROSS JOIN global_avg_pity AS gap
CROSS JOIN global_distribution AS gd
CROSS JOIN total_users AS tu
CROSS JOIN contributor_region_counts AS crc
CROSS JOIN limited_spark_stats AS lss
LEFT JOIN type_counts AS tc_limited
  ON tc_limited.classified_pool_type = 'limited'
LEFT JOIN type_counts AS tc_weapon
  ON tc_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_counts AS tc_standard
  ON tc_standard.classified_pool_type = 'standard'
LEFT JOIN type_pity_stats AS tps_limited
  ON tps_limited.classified_pool_type = 'limited'
LEFT JOIN type_pity_stats AS tps_weapon
  ON tps_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_pity_stats AS tps_standard
  ON tps_standard.classified_pool_type = 'standard'
LEFT JOIN target_pity_stats AS tgt_limited
  ON tgt_limited.classified_pool_type = 'limited'
LEFT JOIN target_pity_stats AS tgt_weapon
  ON tgt_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_distributions AS td_limited
  ON td_limited.classified_pool_type = 'limited'
LEFT JOIN type_distributions AS td_weapon
  ON td_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_distributions AS td_standard
  ON td_standard.classified_pool_type = 'standard';
$$;

GRANT EXECUTE ON FUNCTION public.get_global_stats() TO anon, authenticated;

-- Invalidate both caches
DELETE FROM public.stats_cache WHERE cache_key IN ('global_stats', 'character_ranking');
-- <<< END MIGRATION: archive/095_spark_count_to_occurrences.sql

-- >>> BEGIN MIGRATION: archive/096_retire_history_character_id_and_legacy_pool_id.sql
-- ============================================
-- 096: 退役 history.character_id 与 legacy_pool_id 兼容字段
--
-- 背景:
--   canonical id / alias 主链已经落地，公开仓库运行时也已支持
--   history.character_id / history.legacy_pool_id / pools.legacy_pool_id 缺列降级。
--   真实库审计确认 alias-backed / unresolved 引用均为 0。
--
-- 目标:
--   1. 让标准迁移链与真实库现状一致，不再继续携带已退役兼容字段
--   2. 同步清理 legacy_pool_id 索引与历史迁移辅助函数
--   3. 为 baseline 生成提供明确的最终 schema 信号
-- ============================================

DROP INDEX IF EXISTS public.idx_history_character_id;
DROP INDEX IF EXISTS public.idx_pools_legacy_id;
DROP INDEX IF EXISTS public.idx_history_legacy_pool_id;

ALTER TABLE public.history
  DROP COLUMN IF EXISTS character_id,
  DROP COLUMN IF EXISTS legacy_pool_id;

ALTER TABLE public.pools
  DROP COLUMN IF EXISTS legacy_pool_id;

DROP FUNCTION IF EXISTS public.migrate_pool_id(TEXT, TEXT, UUID);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'history'
      AND column_name = 'character_id'
  ) THEN
    RAISE EXCEPTION 'Migration 096 failed: history.character_id is still present';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'history'
      AND column_name = 'legacy_pool_id'
  ) THEN
    RAISE EXCEPTION 'Migration 096 failed: history.legacy_pool_id is still present';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pools'
      AND column_name = 'legacy_pool_id'
  ) THEN
    RAISE EXCEPTION 'Migration 096 failed: pools.legacy_pool_id is still present';
  END IF;

  RAISE NOTICE '✅ Migration 096: retired history.character_id and legacy_pool_id compatibility fields';
END $$;
-- <<< END MIGRATION: archive/096_retire_history_character_id_and_legacy_pool_id.sql

-- >>> BEGIN MIGRATION: archive/097_add_announcement_i18n_and_bump_site_version.sql
ALTER TABLE public.announcements
ADD COLUMN IF NOT EXISTS title_en TEXT;

ALTER TABLE public.announcements
ADD COLUMN IF NOT EXISTS content_en TEXT;

UPDATE public.site_config
SET value = 'v4.0.0'
WHERE key = 'site_version';
-- <<< END MIGRATION: archive/097_add_announcement_i18n_and_bump_site_version.sql

-- >>> BEGIN MIGRATION: archive/098_add_pool_name_en.sql
-- 098: pool English name support
-- Purpose:
--   1. Add explicit English pool title storage to public.pools
--   2. Expose name_en through get_app_visible_pools
--   3. Allow admin_upsert_pool_with_aliases to write name_en

ALTER TABLE public.pools
  ADD COLUMN IF NOT EXISTS name_en TEXT;

COMMENT ON COLUMN public.pools.name_en IS
  '卡池英文译名；英文界面优先使用该字段，留空则回退到自动推导。';

DROP FUNCTION IF EXISTS public.get_app_visible_pools();

CREATE OR REPLACE FUNCTION public.get_app_visible_pools()
RETURNS TABLE (
  pool_id TEXT,
  name TEXT,
  name_en TEXT,
  type TEXT,
  locked BOOLEAN,
  is_limited_weapon BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  user_id UUID,
  creator_username TEXT,
  creator_role TEXT,
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
      p.locked,
      p.is_limited_weapon,
      p.created_at,
      p.updated_at,
      p.user_id,
      prof.username AS creator_username,
      prof.role AS creator_role,
      p.up_character,
      p.description,
      p.banner_url,
      p.start_time,
      p.end_time,
      p.featured_characters,
      ROW_NUMBER() OVER (
        PARTITION BY p.pool_id
        ORDER BY
          CASE
            WHEN prof.role = 'super_admin' THEN 3
            WHEN prof.role = 'admin' THEN 2
            ELSE 1
          END DESC,
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
    LEFT JOIN public.profiles AS prof
      ON prof.id = p.user_id
  )
  SELECT
    pool_id,
    name,
    name_en,
    type,
    locked,
    is_limited_weapon,
    created_at,
    updated_at,
    user_id,
    creator_username,
    creator_role,
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
  '返回 app 端可见的卡池集合：公开共享卡池 + 当前用户自有卡池，并在服务端完成 pool_id 级别去重与共享池优先级排序。';

CREATE OR REPLACE FUNCTION public.admin_upsert_pool_with_aliases(
  p_pool_id TEXT,
  p_insert_payload JSONB,
  p_update_payload JSONB DEFAULT '{}'::jsonb,
  p_alias_rows JSONB DEFAULT '[]'::jsonb,
  p_pool_character_rows JSONB DEFAULT '[]'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'only super_admin can manage pools';
  END IF;

  IF COALESCE(BTRIM(p_pool_id), '') = '' THEN
    RAISE EXCEPTION 'p_pool_id is required';
  END IF;

  IF p_insert_payload IS NULL OR jsonb_typeof(p_insert_payload) <> 'object' THEN
    RAISE EXCEPTION 'p_insert_payload must be a JSON object';
  END IF;

  IF p_update_payload IS NULL THEN
    p_update_payload := '{}'::jsonb;
  END IF;

  IF jsonb_typeof(p_update_payload) <> 'object' THEN
    RAISE EXCEPTION 'p_update_payload must be a JSON object';
  END IF;

  IF p_alias_rows IS NULL THEN
    p_alias_rows := '[]'::jsonb;
  END IF;

  IF jsonb_typeof(p_alias_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_alias_rows must be a JSON array';
  END IF;

  IF p_pool_character_rows IS NULL THEN
    p_pool_character_rows := '[]'::jsonb;
  END IF;

  IF jsonb_typeof(p_pool_character_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_pool_character_rows must be a JSON array';
  END IF;

  INSERT INTO public.pools (
    user_id,
    pool_id,
    name,
    name_en,
    type,
    locked,
    is_limited_weapon,
    description,
    start_time,
    end_time,
    banner_url,
    featured_characters,
    up_character
  )
  VALUES (
    auth.uid(),
    BTRIM(p_pool_id),
    BTRIM(p_insert_payload->>'name'),
    NULLIF(BTRIM(p_insert_payload->>'name_en'), ''),
    COALESCE(NULLIF(BTRIM(p_insert_payload->>'type'), ''), 'limited'),
    COALESCE((p_insert_payload->>'locked')::BOOLEAN, FALSE),
    CASE
      WHEN p_insert_payload ? 'is_limited_weapon'
        AND jsonb_typeof(p_insert_payload->'is_limited_weapon') = 'boolean'
      THEN (p_insert_payload->>'is_limited_weapon')::BOOLEAN
      ELSE NULL
    END,
    NULLIF(BTRIM(p_insert_payload->>'description'), ''),
    NULLIF(BTRIM(p_insert_payload->>'start_time'), '')::TIMESTAMPTZ,
    NULLIF(BTRIM(p_insert_payload->>'end_time'), '')::TIMESTAMPTZ,
    NULLIF(BTRIM(p_insert_payload->>'banner_url'), ''),
    CASE
      WHEN p_insert_payload ? 'featured_characters'
        AND jsonb_typeof(p_insert_payload->'featured_characters') = 'array'
      THEN ARRAY(
        SELECT jsonb_array_elements_text(p_insert_payload->'featured_characters')
      )
      ELSE NULL
    END,
    NULLIF(BTRIM(p_insert_payload->>'up_character'), '')
  )
  ON CONFLICT (pool_id) DO UPDATE
  SET
    name = CASE
      WHEN p_update_payload ? 'name'
      THEN COALESCE(NULLIF(BTRIM(p_update_payload->>'name'), ''), public.pools.name)
      ELSE public.pools.name
    END,
    name_en = CASE
      WHEN p_update_payload ? 'name_en'
      THEN NULLIF(BTRIM(p_update_payload->>'name_en'), '')
      ELSE public.pools.name_en
    END,
    type = CASE
      WHEN p_update_payload ? 'type'
      THEN COALESCE(NULLIF(BTRIM(p_update_payload->>'type'), ''), public.pools.type)
      ELSE public.pools.type
    END,
    locked = CASE
      WHEN p_update_payload ? 'locked'
        AND jsonb_typeof(p_update_payload->'locked') = 'boolean'
      THEN (p_update_payload->>'locked')::BOOLEAN
      ELSE public.pools.locked
    END,
    is_limited_weapon = CASE
      WHEN p_update_payload ? 'is_limited_weapon'
        AND jsonb_typeof(p_update_payload->'is_limited_weapon') = 'boolean'
      THEN (p_update_payload->>'is_limited_weapon')::BOOLEAN
      WHEN p_update_payload ? 'is_limited_weapon'
        AND jsonb_typeof(p_update_payload->'is_limited_weapon') = 'null'
      THEN NULL
      ELSE public.pools.is_limited_weapon
    END,
    description = CASE
      WHEN p_update_payload ? 'description'
      THEN NULLIF(BTRIM(p_update_payload->>'description'), '')
      ELSE public.pools.description
    END,
    start_time = CASE
      WHEN p_update_payload ? 'start_time'
      THEN NULLIF(BTRIM(p_update_payload->>'start_time'), '')::TIMESTAMPTZ
      ELSE public.pools.start_time
    END,
    end_time = CASE
      WHEN p_update_payload ? 'end_time'
      THEN NULLIF(BTRIM(p_update_payload->>'end_time'), '')::TIMESTAMPTZ
      ELSE public.pools.end_time
    END,
    banner_url = CASE
      WHEN p_update_payload ? 'banner_url'
      THEN NULLIF(BTRIM(p_update_payload->>'banner_url'), '')
      ELSE public.pools.banner_url
    END,
    featured_characters = CASE
      WHEN p_update_payload ? 'featured_characters'
        AND jsonb_typeof(p_update_payload->'featured_characters') = 'array'
      THEN ARRAY(
        SELECT jsonb_array_elements_text(p_update_payload->'featured_characters')
      )
      WHEN p_update_payload ? 'featured_characters'
        AND jsonb_typeof(p_update_payload->'featured_characters') = 'null'
      THEN NULL
      ELSE public.pools.featured_characters
    END,
    up_character = CASE
      WHEN p_update_payload ? 'up_character'
      THEN NULLIF(BTRIM(p_update_payload->>'up_character'), '')
      ELSE public.pools.up_character
    END;

  INSERT INTO public.pool_id_aliases (
    source,
    alias_id,
    pool_id,
    is_primary,
    note
  )
  SELECT
    BTRIM(alias_entry.value->>'source'),
    BTRIM(alias_entry.value->>'alias_id'),
    BTRIM(p_pool_id),
    COALESCE((alias_entry.value->>'is_primary')::BOOLEAN, FALSE),
    NULLIF(BTRIM(alias_entry.value->>'note'), '')
  FROM jsonb_array_elements(p_alias_rows) AS alias_entry(value)
  WHERE
    jsonb_typeof(alias_entry.value) = 'object'
    AND COALESCE(BTRIM(alias_entry.value->>'source'), '') <> ''
    AND COALESCE(BTRIM(alias_entry.value->>'alias_id'), '') <> ''
  ON CONFLICT (source, alias_id) DO UPDATE
  SET
    pool_id = EXCLUDED.pool_id,
    is_primary = EXCLUDED.is_primary,
    note = EXCLUDED.note,
    updated_at = NOW();

  IF jsonb_array_length(p_pool_character_rows) > 0 THEN
    DELETE FROM public.pool_characters
    WHERE pool_id = BTRIM(p_pool_id);

    INSERT INTO public.pool_characters (
      pool_id,
      character_id,
      is_up
    )
    SELECT
      BTRIM(p_pool_id),
      BTRIM(character_entry.value->>'character_id'),
      COALESCE((character_entry.value->>'is_up')::BOOLEAN, FALSE)
    FROM jsonb_array_elements(p_pool_character_rows) AS character_entry(value)
    WHERE
      jsonb_typeof(character_entry.value) = 'object'
      AND COALESCE(BTRIM(character_entry.value->>'character_id'), '') <> ''
    ON CONFLICT (pool_id, character_id) DO UPDATE
    SET is_up = EXCLUDED.is_up;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_pool_with_aliases(TEXT, JSONB, JSONB, JSONB, JSONB) TO authenticated;
-- <<< END MIGRATION: archive/098_add_pool_name_en.sql

-- >>> BEGIN MIGRATION: archive/099_expand_limited_up_six_star_to_six.sql
-- 将限定池 UP 6★ 排名扩展到前 6 名，供统计页左侧两列卡片展示。
-- 仅调整 limited_six_star_up；其他排行榜仍保持现有 Top 5 / Top 3 设计。

CREATE OR REPLACE FUNCTION public.get_character_ranking_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  WITH
  history_with_info AS (
    SELECT
      h.rarity,
      h.item_name,
      h.is_free,
      h.special_type,
      h.pool_id,
      COALESCE(c.type, 'character') as item_type,
      COALESCE(c.is_limited, false) as char_is_limited,
      p.up_character as pool_up_character,
      CASE
        WHEN h.pool_id LIKE 'special_%' THEN 'limited'
        WHEN h.pool_id LIKE 'weapon%' OR h.pool_id LIKE 'wepon%' THEN 'weapon'
        WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
        WHEN p.type IS NOT NULL THEN
          CASE
            WHEN p.type IN ('limited', 'limited_character') THEN 'limited'
            WHEN p.type IN ('weapon', 'limited_weapon') THEN 'weapon'
            ELSE 'standard'
          END
        ELSE 'standard'
      END as pool_type
    FROM public.history h
    LEFT JOIN public.characters c ON c.name = h.item_name
    LEFT JOIN public.pools p ON p.pool_id = h.pool_id
    WHERE h.special_type IS DISTINCT FROM 'gift'
      AND h.item_name IS NOT NULL
      AND h.item_name != ''
  ),
  history_classified AS (
    SELECT *,
      CASE
        WHEN rarity = 6 AND char_is_limited = true THEN
          CASE
            WHEN pool_up_character IS NOT NULL
              AND (
                LOWER(item_name) = LOWER(pool_up_character)
                OR LOWER(item_name) LIKE '%' || LOWER(pool_up_character) || '%'
                OR LOWER(pool_up_character) LIKE '%' || LOWER(item_name) || '%'
              )
            THEN 'up'
            ELSE 'off_limited'
          END
        WHEN rarity = 6 AND char_is_limited = false THEN 'off_standard'
        ELSE 'other'
      END as six_star_category
    FROM history_with_info
  ),
  limited_six_star_up AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited'
      AND rarity = 6
      AND item_type = 'character'
      AND six_star_category = 'up'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 6
  ),
  limited_six_star_off_standard AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited'
      AND rarity = 6
      AND item_type = 'character'
      AND six_star_category = 'off_standard'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 5
  ),
  limited_six_star_off_limited AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited'
      AND rarity = 6
      AND item_type = 'character'
      AND six_star_category = 'off_limited'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 5
  ),
  limited_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited'
      AND rarity = 5
      AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  standard_six_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'standard'
      AND rarity = 6
      AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 5
  ),
  standard_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'standard'
      AND rarity = 5
      AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  weapon_six_star_up AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'weapon'
      AND rarity = 6
      AND item_type = 'weapon'
      AND six_star_category = 'up'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  weapon_six_star_off AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'weapon'
      AND rarity = 6
      AND item_type = 'weapon'
      AND six_star_category IN ('off_standard', 'off_limited')
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  weapon_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'weapon'
      AND rarity = 5
      AND item_type = 'weapon'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  limited_six_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE is_free = false OR is_free IS NULL) as excluding_free,
      COUNT(*) FILTER (WHERE six_star_category = 'up') as up_count,
      COUNT(*) FILTER (WHERE six_star_category IN ('off_standard', 'off_limited')) as off_count,
      COUNT(*) FILTER (WHERE six_star_category = 'off_standard') as off_standard_count,
      COUNT(*) FILTER (WHERE six_star_category = 'off_limited') as off_limited_count,
      COUNT(*) FILTER (WHERE six_star_category = 'up' AND (is_free = false OR is_free IS NULL)) as up_excluding_free,
      COUNT(*) FILTER (WHERE six_star_category IN ('off_standard', 'off_limited') AND (is_free = false OR is_free IS NULL)) as off_excluding_free,
      COUNT(*) FILTER (WHERE six_star_category = 'off_standard' AND (is_free = false OR is_free IS NULL)) as off_standard_excluding_free,
      COUNT(*) FILTER (WHERE six_star_category = 'off_limited' AND (is_free = false OR is_free IS NULL)) as off_limited_excluding_free
    FROM history_classified
    WHERE pool_type = 'limited'
      AND rarity = 6
      AND item_type = 'character'
  ),
  standard_six_counts AS (
    SELECT COUNT(*) as total
    FROM history_classified
    WHERE pool_type = 'standard'
      AND rarity = 6
      AND item_type = 'character'
  ),
  weapon_six_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE six_star_category = 'up') as up_count,
      COUNT(*) FILTER (WHERE six_star_category IN ('off_standard', 'off_limited')) as off_count
    FROM history_classified
    WHERE pool_type = 'weapon'
      AND rarity = 6
      AND item_type = 'weapon'
  )
  SELECT json_build_object(
    'limited', json_build_object(
      'sixStarUp', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_up),
      'sixStarOff', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_off_standard),
      'sixStarOffLimited', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_off_limited),
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_up),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_five_star),
      'sixStarTotal', (SELECT COALESCE(total, 0) FROM limited_six_counts),
      'sixStarExcludingFree', (SELECT COALESCE(excluding_free, 0) FROM limited_six_counts),
      'sixStarUpCount', (SELECT COALESCE(up_count, 0) FROM limited_six_counts),
      'sixStarOffCount', (SELECT COALESCE(off_count, 0) FROM limited_six_counts),
      'sixStarOffStandardCount', (SELECT COALESCE(off_standard_count, 0) FROM limited_six_counts),
      'sixStarOffLimitedCount', (SELECT COALESCE(off_limited_count, 0) FROM limited_six_counts),
      'sixStarUpExcludingFree', (SELECT COALESCE(up_excluding_free, 0) FROM limited_six_counts),
      'sixStarOffExcludingFree', (SELECT COALESCE(off_excluding_free, 0) FROM limited_six_counts),
      'sixStarOffStandardExcludingFree', (SELECT COALESCE(off_standard_excluding_free, 0) FROM limited_six_counts),
      'sixStarOffLimitedExcludingFree', (SELECT COALESCE(off_limited_excluding_free, 0) FROM limited_six_counts)
    ),
    'standard', json_build_object(
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_six_star),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_five_star),
      'sixStarTotal', (SELECT COALESCE(total, 0) FROM standard_six_counts)
    ),
    'weapon', json_build_object(
      'sixStarUp', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_up),
      'sixStarOff', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_off),
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_up),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_five_star),
      'sixStarTotal', (SELECT COALESCE(total, 0) FROM weapon_six_counts),
      'sixStarUpCount', (SELECT COALESCE(up_count, 0) FROM weapon_six_counts),
      'sixStarOffCount', (SELECT COALESCE(off_count, 0) FROM weapon_six_counts)
    )
  ) INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.get_character_ranking_stats() IS 'FEAT-013: 歪出六星分类统计 - 区分歪常驻/歪非当期限定';
GRANT EXECUTE ON FUNCTION public.get_character_ranking_stats() TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.get_user_ranking_stats(p_user_id uuid)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  WITH
  history_with_info AS (
    SELECT
      h.rarity,
      h.item_name,
      h.is_free,
      h.special_type,
      h.pool_id,
      COALESCE(c.type, 'character') as item_type,
      COALESCE(c.is_limited, false) as char_is_limited,
      p.up_character as pool_up_character,
      CASE
        WHEN h.pool_id LIKE 'special_%' THEN 'limited'
        WHEN h.pool_id LIKE 'weapon%' OR h.pool_id LIKE 'wepon%' THEN 'weapon'
        WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
        WHEN p.type IS NOT NULL THEN
          CASE
            WHEN p.type IN ('limited', 'limited_character') THEN 'limited'
            WHEN p.type IN ('weapon', 'limited_weapon') THEN 'weapon'
            ELSE 'standard'
          END
        ELSE 'standard'
      END as pool_type
    FROM public.history h
    LEFT JOIN public.characters c ON c.name = h.item_name
    LEFT JOIN public.pools p ON p.pool_id = h.pool_id
    WHERE h.user_id = p_user_id
      AND h.special_type IS DISTINCT FROM 'gift'
      AND h.item_name IS NOT NULL
      AND h.item_name != ''
  ),
  history_classified AS (
    SELECT *,
      CASE
        WHEN rarity = 6 AND char_is_limited = true THEN
          CASE
            WHEN pool_up_character IS NOT NULL
              AND (
                LOWER(item_name) = LOWER(pool_up_character)
                OR LOWER(item_name) LIKE '%' || LOWER(pool_up_character) || '%'
                OR LOWER(pool_up_character) LIKE '%' || LOWER(item_name) || '%'
              )
            THEN 'up'
            ELSE 'off_limited'
          END
        WHEN rarity = 6 AND char_is_limited = false THEN 'off_standard'
        ELSE 'other'
      END as six_star_category
    FROM history_with_info
  ),
  limited_six_star_up AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited' AND rarity = 6 AND item_type = 'character'
      AND six_star_category = 'up'
    GROUP BY item_name ORDER BY count DESC LIMIT 6
  ),
  limited_six_star_off_standard AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited' AND rarity = 6 AND item_type = 'character'
      AND six_star_category = 'off_standard'
    GROUP BY item_name ORDER BY count DESC LIMIT 5
  ),
  limited_six_star_off_limited AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited' AND rarity = 6 AND item_type = 'character'
      AND six_star_category = 'off_limited'
    GROUP BY item_name ORDER BY count DESC LIMIT 5
  ),
  limited_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited' AND rarity = 5 AND item_type = 'character'
    GROUP BY item_name ORDER BY count DESC LIMIT 3
  ),
  standard_six_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'standard' AND rarity = 6 AND item_type = 'character'
    GROUP BY item_name ORDER BY count DESC LIMIT 5
  ),
  standard_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'standard' AND rarity = 5 AND item_type = 'character'
    GROUP BY item_name ORDER BY count DESC LIMIT 3
  ),
  weapon_six_star_up AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'weapon' AND rarity = 6 AND item_type = 'weapon'
      AND six_star_category = 'up'
    GROUP BY item_name ORDER BY count DESC LIMIT 3
  ),
  weapon_six_star_off AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'weapon' AND rarity = 6 AND item_type = 'weapon'
      AND six_star_category IN ('off_standard', 'off_limited')
    GROUP BY item_name ORDER BY count DESC LIMIT 3
  ),
  weapon_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'weapon' AND rarity = 5 AND item_type = 'weapon'
    GROUP BY item_name ORDER BY count DESC LIMIT 3
  ),
  limited_six_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE six_star_category = 'up') as up_count,
      COUNT(*) FILTER (WHERE six_star_category IN ('off_standard', 'off_limited')) as off_count,
      COUNT(*) FILTER (WHERE six_star_category = 'off_standard') as off_standard_count,
      COUNT(*) FILTER (WHERE six_star_category = 'off_limited') as off_limited_count
    FROM history_classified
    WHERE pool_type = 'limited' AND rarity = 6 AND item_type = 'character'
  ),
  weapon_six_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE six_star_category = 'up') as up_count,
      COUNT(*) FILTER (WHERE six_star_category IN ('off_standard', 'off_limited')) as off_count
    FROM history_classified
    WHERE pool_type = 'weapon' AND rarity = 6 AND item_type = 'weapon'
  )
  SELECT json_build_object(
    'limited', json_build_object(
      'sixStarUp', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_up),
      'sixStarOff', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_off_standard),
      'sixStarOffLimited', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_off_limited),
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_up),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_five_star),
      'sixStarUpCount', (SELECT COALESCE(up_count, 0) FROM limited_six_counts),
      'sixStarOffCount', (SELECT COALESCE(off_count, 0) FROM limited_six_counts),
      'sixStarOffStandardCount', (SELECT COALESCE(off_standard_count, 0) FROM limited_six_counts),
      'sixStarOffLimitedCount', (SELECT COALESCE(off_limited_count, 0) FROM limited_six_counts)
    ),
    'standard', json_build_object(
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_six_star),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_five_star)
    ),
    'weapon', json_build_object(
      'sixStarUp', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_up),
      'sixStarOff', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_off),
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_up),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_five_star),
      'sixStarUpCount', (SELECT COALESCE(up_count, 0) FROM weapon_six_counts),
      'sixStarOffCount', (SELECT COALESCE(off_count, 0) FROM weapon_six_counts)
    )
  ) INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.get_user_ranking_stats(uuid) IS 'FEAT-013: 用户个人排名 - 歪出六星分类统计';
GRANT EXECUTE ON FUNCTION public.get_user_ranking_stats(uuid) TO anon, authenticated;
-- <<< END MIGRATION: archive/099_expand_limited_up_six_star_to_six.sql

-- >>> BEGIN MIGRATION: archive/100_bust_ranking_cache_for_six_item_layout.sql
-- 排行榜缓存之前只按 history 行数判断是否失效。
-- 当统计函数本身的聚合逻辑变化（例如限定池 UP 6★ 从前 5 扩展到前 6）时，
-- 旧缓存仍可能在很长时间内持续返回陈旧结果。

DELETE FROM public.stats_cache
WHERE cache_key = 'character_ranking'
   OR cache_key = 'character_ranking:v2'
   OR cache_key LIKE 'user_ranking:%'
   OR cache_key LIKE 'user_ranking:v2:%';

CREATE OR REPLACE FUNCTION public.get_character_ranking_stats_cached(
  p_buffer_seconds INT DEFAULT 300
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count BIGINT;
  v_cached_data   JSONB;
  v_cached_fp     BIGINT;
  v_cached_at     TIMESTAMPTZ;
  v_result        JSON;
  v_max_ttl       INTERVAL := INTERVAL '24 hours';
  v_cache_key     TEXT := 'character_ranking:v2';
BEGIN
  SELECT count(*) INTO v_current_count FROM public.history;

  SELECT cached_data, row_fingerprint, computed_at
    INTO v_cached_data, v_cached_fp, v_cached_at
    FROM public.stats_cache
   WHERE cache_key = v_cache_key;

  IF v_cached_data IS NOT NULL THEN
    IF v_cached_fp = v_current_count
       AND v_cached_at + v_max_ttl > now() THEN
      RETURN v_cached_data::JSON;
    END IF;

    IF v_cached_fp <> v_current_count
       AND v_cached_at + (p_buffer_seconds || ' seconds')::INTERVAL > now() THEN
      RETURN v_cached_data::JSON;
    END IF;
  END IF;

  SELECT public.get_character_ranking_stats() INTO v_result;

  INSERT INTO public.stats_cache (cache_key, cached_data, row_fingerprint, computed_at)
  VALUES (v_cache_key, v_result::JSONB, v_current_count, now())
  ON CONFLICT (cache_key) DO UPDATE SET
    cached_data     = EXCLUDED.cached_data,
    row_fingerprint = EXCLUDED.row_fingerprint,
    computed_at     = EXCLUDED.computed_at;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_character_ranking_stats_cached(INT)
  SET statement_timeout = '90s';

GRANT EXECUTE ON FUNCTION public.get_character_ranking_stats_cached(INT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_user_ranking_stats_cached(
  p_user_id UUID,
  p_buffer_seconds INT DEFAULT 120
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count BIGINT;
  v_cache_key     TEXT;
  v_cached_data   JSONB;
  v_cached_fp     BIGINT;
  v_cached_at     TIMESTAMPTZ;
  v_result        JSON;
  v_max_ttl       INTERVAL := INTERVAL '6 hours';
BEGIN
  SELECT count(*) INTO v_current_count
    FROM public.history
   WHERE user_id = p_user_id;

  v_cache_key := 'user_ranking:v2:' || p_user_id::TEXT;

  SELECT cached_data, row_fingerprint, computed_at
    INTO v_cached_data, v_cached_fp, v_cached_at
    FROM public.stats_cache
   WHERE cache_key = v_cache_key;

  IF v_cached_data IS NOT NULL THEN
    IF v_cached_fp = v_current_count
       AND v_cached_at + v_max_ttl > now() THEN
      RETURN v_cached_data::JSON;
    END IF;

    IF v_cached_fp <> v_current_count
       AND v_cached_at + (p_buffer_seconds || ' seconds')::INTERVAL > now() THEN
      RETURN v_cached_data::JSON;
    END IF;
  END IF;

  SELECT public.get_user_ranking_stats(p_user_id) INTO v_result;

  INSERT INTO public.stats_cache (cache_key, cached_data, row_fingerprint, computed_at)
  VALUES (v_cache_key, v_result::JSONB, v_current_count, now())
  ON CONFLICT (cache_key) DO UPDATE SET
    cached_data     = EXCLUDED.cached_data,
    row_fingerprint = EXCLUDED.row_fingerprint,
    computed_at     = EXCLUDED.computed_at;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_user_ranking_stats_cached(UUID, INT)
  SET statement_timeout = '90s';

GRANT EXECUTE ON FUNCTION public.get_user_ranking_stats_cached(UUID, INT) TO anon, authenticated;
-- <<< END MIGRATION: archive/100_bust_ranking_cache_for_six_item_layout.sql

-- >>> BEGIN MIGRATION: archive/101_add_extra_pool_type.sql
-- 101: allow explicit extra pool type for the one-off 2026-05 banner family.
-- Notes:
--   1. Keep historical special_* / limited logic untouched.
--   2. Only extend pools.type validation to accept `extra`.

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT tc.constraint_name
    INTO v_constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc
      ON cc.constraint_name = tc.constraint_name
   WHERE tc.table_schema = 'public'
     AND tc.table_name = 'pools'
     AND tc.constraint_type = 'CHECK'
     AND cc.check_clause LIKE '%type%'
     AND cc.check_clause LIKE '%limited%'
     AND cc.check_clause LIKE '%weapon%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.pools DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE public.pools
  ADD CONSTRAINT pools_type_check
  CHECK (type IN ('extra', 'limited', 'standard', 'weapon', 'beginner'));

COMMENT ON CONSTRAINT pools_type_check ON public.pools IS
  '允许 extra / limited / standard / weapon / beginner 五类卡池。';
-- <<< END MIGRATION: archive/101_add_extra_pool_type.sql

-- >>> BEGIN MIGRATION: archive/102_add_private_bindings_and_dev_api_clients.sql
-- 102: add private platform bindings and developer API client infrastructure
--
-- Goals:
--   1. Keep profiles/public_profiles focused on public site identity
--   2. Add private binding tables for Discord / Telegram / QQ
--   3. Add developer API client + key model for approved integrations
--   4. Seed official bot clients without exposing private identifiers publicly

-- ---------- user_platform_bindings ----------

CREATE TABLE IF NOT EXISTS public.user_platform_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('discord', 'telegram', 'qq')),
  platform_user_id TEXT,
  display_handle TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'revoked')),
  verified_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_platform_bindings_provider_platform_verified
  ON public.user_platform_bindings(provider, platform_user_id)
  WHERE platform_user_id IS NOT NULL AND status = 'verified';

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_platform_bindings_user_provider_active
  ON public.user_platform_bindings(user_id, provider)
  WHERE status <> 'revoked';

CREATE INDEX IF NOT EXISTS idx_user_platform_bindings_user_provider
  ON public.user_platform_bindings(user_id, provider);

ALTER TABLE public.user_platform_bindings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_platform_bindings_select_own_or_super" ON public.user_platform_bindings;
CREATE POLICY "user_platform_bindings_select_own_or_super" ON public.user_platform_bindings
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "user_platform_bindings_manage_super" ON public.user_platform_bindings;
CREATE POLICY "user_platform_bindings_manage_super" ON public.user_platform_bindings
  FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP TRIGGER IF EXISTS update_user_platform_bindings_updated_at ON public.user_platform_bindings;
CREATE TRIGGER update_user_platform_bindings_updated_at
  BEFORE UPDATE ON public.user_platform_bindings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.user_platform_bindings IS
  '用户私密平台绑定关系，仅供本人、超管与受控后端接口读取。';

COMMENT ON COLUMN public.user_platform_bindings.platform_user_id IS
  '平台侧用户标识；不进入 public_profiles 或公开 API。';

-- ---------- platform_binding_challenges ----------

CREATE TABLE IF NOT EXISTS public.platform_binding_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_id UUID REFERENCES public.user_platform_bindings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('discord', 'telegram', 'qq')),
  challenge_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'consumed', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  verified_platform_user_id TEXT,
  verified_display_handle TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_binding_challenges_code
  ON public.platform_binding_challenges(challenge_code);

CREATE INDEX IF NOT EXISTS idx_platform_binding_challenges_user_provider_status
  ON public.platform_binding_challenges(user_id, provider, status, created_at DESC);

ALTER TABLE public.platform_binding_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_binding_challenges_select_own_or_super" ON public.platform_binding_challenges;
CREATE POLICY "platform_binding_challenges_select_own_or_super" ON public.platform_binding_challenges
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "platform_binding_challenges_manage_super" ON public.platform_binding_challenges;
CREATE POLICY "platform_binding_challenges_manage_super" ON public.platform_binding_challenges
  FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP TRIGGER IF EXISTS update_platform_binding_challenges_updated_at ON public.platform_binding_challenges;
CREATE TRIGGER update_platform_binding_challenges_updated_at
  BEFORE UPDATE ON public.platform_binding_challenges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.platform_binding_challenges IS
  '短期平台绑定验证码挑战，仅供本人查看与受控验证接口消费。';

-- ---------- api_clients ----------

CREATE TABLE IF NOT EXISTS public.api_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  client_type TEXT NOT NULL CHECK (client_type IN ('developer', 'official_bot')),
  provider TEXT CHECK (provider IN ('discord', 'telegram', 'qq')),
  name TEXT NOT NULL,
  use_case TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected', 'revoked')),
  requested_scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  granted_scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  rate_limit_tier TEXT NOT NULL DEFAULT 'default',
  review_note TEXT,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  verifier_secret_prefix TEXT,
  verifier_secret_hash TEXT,
  verifier_last_used_at TIMESTAMPTZ,
  verifier_rotated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT api_clients_shape_check CHECK (
    (client_type = 'developer' AND owner_user_id IS NOT NULL AND provider IS NULL)
    OR (client_type = 'official_bot' AND provider IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_clients_official_provider
  ON public.api_clients(provider)
  WHERE client_type = 'official_bot';

CREATE INDEX IF NOT EXISTS idx_api_clients_owner_created_at
  ON public.api_clients(owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_clients_status_created_at
  ON public.api_clients(status, created_at DESC);

ALTER TABLE public.api_clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_clients_manage_super" ON public.api_clients;
CREATE POLICY "api_clients_manage_super" ON public.api_clients
  FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP TRIGGER IF EXISTS update_api_clients_updated_at ON public.api_clients;
CREATE TRIGGER update_api_clients_updated_at
  BEFORE UPDATE ON public.api_clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.api_clients IS
  '开发者接口接入应用与官方 BOT 客户端的审核主表。';

-- ---------- api_client_keys ----------

CREATE TABLE IF NOT EXISTS public.api_client_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.api_clients(id) ON DELETE CASCADE,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  encrypted_secret TEXT,
  secret_revealed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_client_keys_prefix
  ON public.api_client_keys(key_prefix);

CREATE INDEX IF NOT EXISTS idx_api_client_keys_client_created_at
  ON public.api_client_keys(client_id, created_at DESC);

ALTER TABLE public.api_client_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_client_keys_manage_super" ON public.api_client_keys;
CREATE POLICY "api_client_keys_manage_super" ON public.api_client_keys
  FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

COMMENT ON TABLE public.api_client_keys IS
  'API 客户端密钥，仅保存 hash；encrypted_secret 只用于一次性交付待领取密钥。';

-- ---------- rate limit actions ----------

INSERT INTO public.rate_limit_config (action, max_attempts, window_minutes, lockout_minutes) VALUES
  ('binding_challenge_create', 6, 60, 30),
  ('binding_verify', 20, 60, 30),
  ('dev_api_public', 600, 60, 5),
  ('dev_api_bot_self', 240, 60, 5),
  ('dev_api_application', 10, 60, 15)
ON CONFLICT (action) DO NOTHING;

-- ---------- seed official bot clients ----------

INSERT INTO public.api_clients (
  owner_user_id,
  client_type,
  provider,
  name,
  use_case,
  status,
  requested_scopes,
  granted_scopes,
  rate_limit_tier,
  review_note,
  approved_at
)
VALUES
  (
    NULL,
    'official_bot',
    'discord',
    'Official Discord Bot',
    'Official read-only Discord bot for binding, self summary and public rankings',
    'active',
    '["public.read","bot.self.read"]'::jsonb,
    '["public.read","bot.self.read"]'::jsonb,
    'official_bot',
    'Seeded official bot client',
    NOW()
  ),
  (
    NULL,
    'official_bot',
    'telegram',
    'Official Telegram Bot',
    'Official read-only Telegram bot for binding, self summary and public rankings',
    'active',
    '["public.read","bot.self.read"]'::jsonb,
    '["public.read","bot.self.read"]'::jsonb,
    'official_bot',
    'Seeded official bot client',
    NOW()
  ),
  (
    NULL,
    'official_bot',
    'qq',
    'Official QQ Bot',
    'Official read-only QQ bot for binding, self summary and public rankings',
    'active',
    '["public.read","bot.self.read"]'::jsonb,
    '["public.read","bot.self.read"]'::jsonb,
    'official_bot',
    'Seeded official bot client',
    NOW()
  )
ON CONFLICT (provider) WHERE client_type = 'official_bot' DO NOTHING;
-- <<< END MIGRATION: archive/102_add_private_bindings_and_dev_api_clients.sql

-- >>> BEGIN MIGRATION: archive/103_add_public_analytics_api_rate_limits.sql
-- 103: rate limit buckets for Public Analytics API v1.
-- Existing dev_api_public remains as a compatibility fallback.

INSERT INTO public.rate_limit_config (action, max_attempts, window_minutes, lockout_minutes) VALUES
  ('dev_api_catalog', 1200, 60, 5),
  ('dev_api_stats_light', 600, 60, 5),
  ('dev_api_stats_heavy', 120, 60, 10)
ON CONFLICT (action) DO NOTHING;
-- <<< END MIGRATION: archive/103_add_public_analytics_api_rate_limits.sql

-- >>> BEGIN MIGRATION: archive/104_add_announcement_type_and_severity.sql
-- 104: distinguish update announcements from temporary status-style notices.
-- Existing rows remain update announcements.

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS announcement_type TEXT NOT NULL DEFAULT 'update',
  ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'info';

ALTER TABLE public.announcements
  DROP CONSTRAINT IF EXISTS announcements_type_check;

ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_type_check
  CHECK (announcement_type IN ('update', 'temporary'));

ALTER TABLE public.announcements
  DROP CONSTRAINT IF EXISTS announcements_severity_check;

ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_severity_check
  CHECK (severity IN ('info', 'maintenance', 'warning', 'critical'));

UPDATE public.announcements
   SET announcement_type = 'update'
 WHERE announcement_type IS NULL;

UPDATE public.announcements
   SET severity = 'info'
 WHERE severity IS NULL;

COMMENT ON COLUMN public.announcements.announcement_type IS
  '站点公告类型：update 为更新公告，temporary 为临时公告。';

COMMENT ON COLUMN public.announcements.severity IS
  '临时公告重要程度：info / maintenance / warning / critical。更新公告默认 info。';
-- <<< END MIGRATION: archive/104_add_announcement_type_and_severity.sql

-- >>> BEGIN MIGRATION: archive/105_add_success_announcement_severity.sql
-- 105: add a green resolved/recovery severity for temporary notices.

ALTER TABLE public.announcements
  DROP CONSTRAINT IF EXISTS announcements_severity_check;

ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_severity_check
  CHECK (severity IN ('info', 'success', 'maintenance', 'warning', 'critical'));

COMMENT ON COLUMN public.announcements.severity IS
  '临时公告重要程度：info / success / maintenance / warning / critical。更新公告默认 info。';
-- <<< END MIGRATION: archive/105_add_success_announcement_severity.sql

-- >>> BEGIN MIGRATION: archive/106_character_catalog_stats.sql
-- 106: 全服角色图鉴聚合统计
-- 输出按角色聚合后的拥有率、满潜率、拷贝分布与配额汇总；不返回用户级明细。

CREATE OR REPLACE FUNCTION public.get_character_catalog_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  WITH
  valid_history AS (
    SELECT
      h.user_id,
      h.pool_id,
      h.item_name,
      h.rarity
    FROM public.history h
    WHERE h.special_type IS DISTINCT FROM 'gift'
      AND h.item_name IS NOT NULL
      AND h.item_name <> ''
      AND h.user_id IS NOT NULL
  ),
  contributors AS (
    SELECT COUNT(DISTINCT user_id)::BIGINT AS total_contributors
    FROM valid_history
  ),
  catalog AS (
    SELECT
      c.id,
      c.name,
      c.avatar_url,
      c.rarity,
      c.type,
      COALESCE(c.is_limited, false) AS is_limited,
      c.release_date
    FROM public.characters c
    WHERE c.type = 'character'
  ),
  user_copies AS (
    SELECT
      c.id AS character_id,
      h.user_id,
      COUNT(*)::BIGINT AS copies
    FROM valid_history h
    JOIN public.characters c
      ON LOWER(c.name) = LOWER(h.item_name)
     AND c.type = 'character'
    GROUP BY c.id, h.user_id
  ),
  per_character AS (
    SELECT
      c.id,
      c.name,
      c.avatar_url,
      c.rarity,
      c.type,
      c.is_limited,
      c.release_date,
      COALESCE(COUNT(uc.user_id), 0)::BIGINT AS owner_users,
      GREATEST((SELECT total_contributors FROM contributors) - COALESCE(COUNT(uc.user_id), 0), 0)::BIGINT AS unowned_users,
      CASE
        WHEN (SELECT total_contributors FROM contributors) > 0
        THEN ROUND((COALESCE(COUNT(uc.user_id), 0)::NUMERIC / (SELECT total_contributors FROM contributors)::NUMERIC), 6)
        ELSE 0
      END AS ownership_rate,
      COALESCE(COUNT(uc.user_id) FILTER (WHERE uc.copies >= 6), 0)::BIGINT AS full_potential_users,
      CASE
        WHEN COALESCE(COUNT(uc.user_id), 0) > 0
        THEN ROUND((COALESCE(COUNT(uc.user_id) FILTER (WHERE uc.copies >= 6), 0)::NUMERIC / COALESCE(COUNT(uc.user_id), 0)::NUMERIC), 6)
        ELSE 0
      END AS full_potential_rate_of_owners,
      CASE
        WHEN (SELECT total_contributors FROM contributors) > 0
        THEN ROUND((COALESCE(COUNT(uc.user_id) FILTER (WHERE uc.copies >= 6), 0)::NUMERIC / (SELECT total_contributors FROM contributors)::NUMERIC), 6)
        ELSE 0
      END AS full_potential_rate_of_contributors,
      COALESCE(SUM(uc.copies), 0)::BIGINT AS total_copies,
      CASE
        WHEN COALESCE(COUNT(uc.user_id), 0) > 0
        THEN ROUND((COALESCE(SUM(uc.copies), 0)::NUMERIC / COALESCE(COUNT(uc.user_id), 0)::NUMERIC), 2)
        ELSE 0
      END AS avg_copies_per_owner,
      COALESCE(COUNT(uc.user_id) FILTER (WHERE uc.copies = 1), 0)::BIGINT AS copies_1,
      COALESCE(COUNT(uc.user_id) FILTER (WHERE uc.copies = 2), 0)::BIGINT AS copies_2,
      COALESCE(COUNT(uc.user_id) FILTER (WHERE uc.copies = 3), 0)::BIGINT AS copies_3,
      COALESCE(COUNT(uc.user_id) FILTER (WHERE uc.copies = 4), 0)::BIGINT AS copies_4,
      COALESCE(COUNT(uc.user_id) FILTER (WHERE uc.copies = 5), 0)::BIGINT AS copies_5,
      COALESCE(COUNT(uc.user_id) FILTER (WHERE uc.copies = 6), 0)::BIGINT AS copies_6,
      COALESCE(COUNT(uc.user_id) FILTER (WHERE uc.copies >= 7), 0)::BIGINT AS copies_7_plus,
      COALESCE(SUM(GREATEST(uc.copies - 1, 0)), 0)::BIGINT AS duplicate_copies,
      COALESCE(SUM(GREATEST(uc.copies - 6, 0)), 0)::BIGINT AS excess_copies
    FROM catalog c
    LEFT JOIN user_copies uc ON uc.character_id = c.id
    GROUP BY c.id, c.name, c.avatar_url, c.rarity, c.type, c.is_limited, c.release_date
  ),
  enriched AS (
    SELECT
      *,
      CASE WHEN rarity BETWEEN 4 AND 6 THEN owner_users * 30 ELSE 0 END AS aic_quota_direct,
      CASE
        WHEN rarity = 5 THEN excess_copies * 20
        WHEN rarity = 4 THEN excess_copies * 5
        ELSE 0
      END AS aic_quota_convertible,
      CASE
        WHEN rarity >= 6 THEN duplicate_copies * 50
        WHEN rarity = 5 THEN duplicate_copies * 10
        ELSE 0
      END AS bond_quota_direct,
      CASE WHEN rarity >= 6 THEN excess_copies * 10 ELSE 0 END AS endpoint_quota_convertible
    FROM per_character
  ),
  weapon_quota AS (
    SELECT
      COALESCE(SUM(
        CASE
          WHEN h.rarity >= 6 THEN 50
          WHEN h.rarity = 5 THEN 10
          ELSE 0
        END
      ), 0)::BIGINT AS aic_quota_direct
    FROM valid_history h
    JOIN public.pools p
      ON p.pool_id = h.pool_id
     AND p.user_id = h.user_id
    LEFT JOIN public.characters c
      ON LOWER(c.name) = LOWER(h.item_name)
    WHERE COALESCE(p.type, '') = 'weapon'
       OR COALESCE(c.type, '') = 'weapon'
  ),
  extra_pull_quota AS (
    SELECT
      COUNT(*)::BIGINT AS bond_quota_direct
    FROM valid_history h
    JOIN public.pools p
      ON p.pool_id = h.pool_id
     AND p.user_id = h.user_id
    WHERE COALESCE(p.type, '') = 'extra'
  ),
  summary AS (
    SELECT
      COUNT(*)::BIGINT AS total_characters,
      COALESCE(COUNT(*) FILTER (WHERE owner_users > 0), 0)::BIGINT AS owned_characters,
      COALESCE(COUNT(*) FILTER (WHERE owner_users = 0), 0)::BIGINT AS unowned_characters,
      CASE
        WHEN COUNT(*) > 0
        THEN ROUND((COALESCE(COUNT(*) FILTER (WHERE owner_users > 0), 0)::NUMERIC / COUNT(*)::NUMERIC), 6)
        ELSE 0
      END AS ownership_rate,
      COALESCE(COUNT(*) FILTER (WHERE full_potential_users > 0), 0)::BIGINT AS full_potential_characters,
      COALESCE(SUM(aic_quota_direct), 0)::BIGINT AS character_aic_quota_direct,
      COALESCE(SUM(aic_quota_convertible), 0)::BIGINT AS character_aic_quota_convertible,
      (COALESCE(SUM(bond_quota_direct), 0) + COALESCE((SELECT bond_quota_direct FROM extra_pull_quota), 0))::BIGINT AS character_bond_quota_direct,
      COALESCE(SUM(endpoint_quota_convertible), 0)::BIGINT AS character_endpoint_quota_convertible,
      COALESCE((SELECT aic_quota_direct FROM weapon_quota), 0)::BIGINT AS weapon_aic_quota_direct,
      COALESCE(SUM(duplicate_copies), 0)::BIGINT AS trust_tokens_gained,
      COALESCE(SUM(excess_copies), 0)::BIGINT AS excess_trust_tokens
    FROM enriched
  )
  SELECT json_build_object(
    'totalContributors', (SELECT total_contributors FROM contributors),
    'summary', json_build_object(
      'totalCharacters', (SELECT total_characters FROM summary),
      'ownedCharacters', (SELECT owned_characters FROM summary),
      'unownedCharacters', (SELECT unowned_characters FROM summary),
      'ownershipRate', (SELECT ownership_rate FROM summary),
      'fullPotentialCharacters', (SELECT full_potential_characters FROM summary),
      'excessTrustTokens', (SELECT excess_trust_tokens FROM summary),
      'quotaAggregate', json_build_object(
        'aicQuotaDirect', (SELECT character_aic_quota_direct + weapon_aic_quota_direct FROM summary),
        'aicQuotaConvertible', (SELECT character_aic_quota_convertible FROM summary),
        'aicQuotaTotalPotential', (SELECT character_aic_quota_direct + weapon_aic_quota_direct + character_aic_quota_convertible FROM summary),
        'bondQuotaDirect', (SELECT character_bond_quota_direct FROM summary),
        'endpointQuotaConvertible', (SELECT character_endpoint_quota_convertible FROM summary),
        'trustTokensGained', (SELECT trust_tokens_gained FROM summary),
        'excessTrustTokens', (SELECT excess_trust_tokens FROM summary)
      ),
      'characterQuotaAggregate', json_build_object(
        'aicQuotaDirect', (SELECT character_aic_quota_direct FROM summary),
        'aicQuotaConvertible', (SELECT character_aic_quota_convertible FROM summary),
        'aicQuotaTotalPotential', (SELECT character_aic_quota_direct + character_aic_quota_convertible FROM summary),
        'bondQuotaDirect', (SELECT character_bond_quota_direct FROM summary),
        'endpointQuotaConvertible', (SELECT character_endpoint_quota_convertible FROM summary),
        'trustTokensGained', (SELECT trust_tokens_gained FROM summary),
        'excessTrustTokens', (SELECT excess_trust_tokens FROM summary)
      ),
      'weaponQuotaAggregate', json_build_object(
        'aicQuotaDirect', (SELECT weapon_aic_quota_direct FROM summary),
        'aicQuotaConvertible', 0,
        'aicQuotaTotalPotential', (SELECT weapon_aic_quota_direct FROM summary),
        'bondQuotaDirect', 0,
        'endpointQuotaConvertible', 0,
        'trustTokensGained', 0,
        'excessTrustTokens', 0
      )
    ),
    'characters', COALESCE((
      SELECT json_agg(json_build_object(
        'id', id,
        'name', name,
        'avatarUrl', avatar_url,
        'rarity', rarity,
        'type', type,
        'isLimited', is_limited,
        'releaseDate', release_date,
        'ownerUsers', owner_users,
        'unownedUsers', unowned_users,
        'ownershipRate', ownership_rate,
        'fullPotentialUsers', full_potential_users,
        'fullPotentialRateOfOwners', full_potential_rate_of_owners,
        'fullPotentialRateOfContributors', full_potential_rate_of_contributors,
        'totalCopies', total_copies,
        'avgCopiesPerOwner', avg_copies_per_owner,
        'copyDistribution', json_build_object(
          '0', unowned_users,
          '1', copies_1,
          '2', copies_2,
          '3', copies_3,
          '4', copies_4,
          '5', copies_5,
          '6', copies_6,
          '7plus', copies_7_plus
        ),
        'quotaAggregate', json_build_object(
          'aicQuotaDirect', aic_quota_direct,
          'aicQuotaConvertible', aic_quota_convertible,
          'aicQuotaTotalPotential', aic_quota_direct + aic_quota_convertible,
          'bondQuotaDirect', bond_quota_direct,
          'endpointQuotaConvertible', endpoint_quota_convertible,
          'trustTokensGained', duplicate_copies,
          'excessTrustTokens', excess_copies
        )
      ) ORDER BY rarity DESC, owner_users DESC, name)
      FROM enriched
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;

ALTER FUNCTION public.get_character_catalog_stats()
  SET statement_timeout = '120s';

GRANT EXECUTE ON FUNCTION public.get_character_catalog_stats() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_character_catalog_stats_cached(
  p_buffer_seconds INT DEFAULT 300
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count BIGINT;
  v_cached_data   JSONB;
  v_cached_fp     BIGINT;
  v_cached_at     TIMESTAMPTZ;
  v_result        JSON;
  v_max_ttl       INTERVAL := INTERVAL '24 hours';
BEGIN
  SELECT count(*) INTO v_current_count FROM public.history;

  SELECT cached_data, row_fingerprint, computed_at
    INTO v_cached_data, v_cached_fp, v_cached_at
    FROM public.stats_cache
   WHERE cache_key = 'character_catalog';

  IF v_cached_data IS NOT NULL THEN
    IF v_cached_fp = v_current_count
       AND v_cached_at + v_max_ttl > now() THEN
      RETURN v_cached_data::JSON;
    END IF;

    IF v_cached_fp <> v_current_count
       AND v_cached_at + (p_buffer_seconds || ' seconds')::INTERVAL > now() THEN
      RETURN v_cached_data::JSON;
    END IF;
  END IF;

  SELECT public.get_character_catalog_stats() INTO v_result;

  INSERT INTO public.stats_cache (cache_key, cached_data, row_fingerprint, computed_at)
  VALUES ('character_catalog', v_result::JSONB, v_current_count, now())
  ON CONFLICT (cache_key) DO UPDATE SET
    cached_data     = EXCLUDED.cached_data,
    row_fingerprint = EXCLUDED.row_fingerprint,
    computed_at     = EXCLUDED.computed_at;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_character_catalog_stats_cached(INT)
  SET statement_timeout = '120s';

GRANT EXECUTE ON FUNCTION public.get_character_catalog_stats_cached(INT) TO anon, authenticated;

DELETE FROM public.stats_cache WHERE cache_key = 'character_catalog';
-- <<< END MIGRATION: archive/106_character_catalog_stats.sql

-- >>> BEGIN MIGRATION: archive/107_bump_site_version_420.sql
UPDATE public.site_config
SET value = 'v4.2.0'
WHERE key = 'site_version';
-- <<< END MIGRATION: archive/107_bump_site_version_420.sql

-- >>> BEGIN MIGRATION: archive/108_seed_fest_of_brilliance_joint_pool.sql
-- 108: seed the 2026-05-14 "辉光庆典" Joint / extra recruitment pool.
-- The official record API exposes this banner as:
--   pool_type = E_CharacterGachaPoolType_Joint
--   poolId    = joint_1_2_2

DO $$
DECLARE
  v_admin_uuid UUID;
  v_pool_id TEXT := 'joint_1_2_2';
  v_featured_refs TEXT[];
BEGIN
  SELECT id
    INTO v_admin_uuid
    FROM public.profiles
   WHERE role = 'super_admin'
   ORDER BY created_at ASC NULLS LAST
   LIMIT 1;

  IF v_admin_uuid IS NULL THEN
    RAISE NOTICE '108_seed_fest_of_brilliance_joint_pool skipped: no super_admin profile found';
    RETURN;
  END IF;

  WITH featured(source_id, legacy_id, fallback_name, sort_order) AS (
    VALUES
      ('chr_0016_laevat', 'char_levantin', '莱万汀', 1),
      ('chr_0013_aglina', 'char_jerpeta', '洁尔佩塔', 2),
      ('chr_0025_ardelia', 'char_eldelra', '艾尔黛拉', 3),
      ('chr_0029_pograni', 'char_junwei', '骏卫', 4)
  )
  SELECT ARRAY_AGG(COALESCE(source_match.id, legacy_match.id, featured.fallback_name) ORDER BY featured.sort_order)
    INTO v_featured_refs
    FROM featured
    LEFT JOIN public.characters AS source_match
      ON source_match.id = featured.source_id
    LEFT JOIN public.characters AS legacy_match
      ON legacy_match.id = featured.legacy_id;

  INSERT INTO public.pools (
    user_id,
    pool_id,
    name,
    name_en,
    type,
    locked,
    is_limited_weapon,
    up_character,
    description,
    featured_characters,
    created_at,
    updated_at
  )
  VALUES (
    v_admin_uuid,
    v_pool_id,
    '辉光庆典',
    'Fest of Brilliance',
    'extra',
    TRUE,
    NULL,
    '莱万汀',
    '2026-05-14 附加寻访。全部可能出现的 6 星为莱万汀、洁尔佩塔、艾尔黛拉、骏卫；保底独立计算。',
    v_featured_refs,
    NOW(),
    NOW()
  )
  ON CONFLICT (pool_id) DO UPDATE
  SET
    name = EXCLUDED.name,
    name_en = EXCLUDED.name_en,
    type = 'extra',
    locked = TRUE,
    is_limited_weapon = NULL,
    up_character = EXCLUDED.up_character,
    description = COALESCE(NULLIF(public.pools.description, ''), EXCLUDED.description),
    featured_characters = EXCLUDED.featured_characters,
    updated_at = NOW();

  INSERT INTO public.pool_id_aliases (source, alias_id, pool_id, is_primary, note)
  VALUES
    ('official_api', v_pool_id, v_pool_id, TRUE, 'Official Joint recruitment pool id for 2026-05-14 辉光庆典'),
    ('official_notice', v_pool_id, v_pool_id, TRUE, 'Official notice pool id for 2026-05-14 辉光庆典'),
    ('official_notice', '辉光庆典', v_pool_id, FALSE, 'Official Chinese banner name for 2026-05-14 Joint recruitment')
  ON CONFLICT (source, alias_id) DO UPDATE
  SET
    pool_id = EXCLUDED.pool_id,
    is_primary = EXCLUDED.is_primary,
    note = EXCLUDED.note,
    updated_at = NOW();

  WITH featured(source_id, legacy_id, sort_order) AS (
    VALUES
      ('chr_0016_laevat', 'char_levantin', 1),
      ('chr_0013_aglina', 'char_jerpeta', 2),
      ('chr_0025_ardelia', 'char_eldelra', 3),
      ('chr_0029_pograni', 'char_junwei', 4)
  ),
  resolved AS (
    SELECT
      COALESCE(source_match.id, legacy_match.id) AS character_id,
      featured.sort_order
    FROM featured
    LEFT JOIN public.characters AS source_match
      ON source_match.id = featured.source_id
    LEFT JOIN public.characters AS legacy_match
      ON legacy_match.id = featured.legacy_id
  )
  INSERT INTO public.pool_characters (pool_id, character_id, is_up)
  SELECT v_pool_id, character_id, TRUE
    FROM resolved
   WHERE character_id IS NOT NULL
   ORDER BY sort_order
  ON CONFLICT (pool_id, character_id) DO UPDATE
  SET is_up = TRUE;
END $$;
-- <<< END MIGRATION: archive/108_seed_fest_of_brilliance_joint_pool.sql

-- >>> BEGIN MIGRATION: archive/109_include_extra_pool_in_stats.sql
-- 109: include extra / Joint recruitment pools in stats RPCs.
--
-- FEAT-028 introduced the explicit `extra` pool type for the 2026-05-14
-- Joint recruitment banner. Earlier stats RPCs still classified unknown
-- pool IDs as limited/standard and only returned limited/weapon/standard
-- buckets. This migration makes the reporting contract explicit:
--   - pools.type = 'extra', pool_id joint_*, and pool_id extra_* => extra
--   - every 6-star character in extra pools is counted as a target 6-star
--   - extra remains a separate byType/ranking bucket and also contributes
--     to aggregate character-pool stats on the client
--   - 120-pull spark/info-book logic remains limited-pool only

CREATE OR REPLACE FUNCTION public.get_global_stats()
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH history_base AS MATERIALIZED (
  SELECT
    h.pool_id,
    h.user_id,
    h.record_id,
    h.rarity,
    h.server_id,
    h.region,
    h.special_type,
    h.is_free,
    h.is_standard,
    h.character_name,
    h.item_name,
    p.type AS pool_type,
    p.up_character
  FROM public.history AS h
  LEFT JOIN public.pools AS p ON p.pool_id = h.pool_id
),
six_star_target_matches AS MATERIALIZED (
  SELECT
    hb.pool_id,
    hb.user_id,
    hb.record_id,
    (
      lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) <> ''
      AND (
        lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) LIKE '%' || lower(trim(hb.up_character)) || '%'
        OR lower(trim(hb.up_character)) LIKE '%' || lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) || '%'
      )
    ) AS is_target
  FROM history_base AS hb
  WHERE hb.rarity = 6
    AND hb.up_character IS NOT NULL
    AND hb.up_character <> ''
    AND NOT (hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner'))
    AND NOT (hb.pool_type = 'extra' OR hb.pool_id LIKE 'joint_%' OR hb.pool_id LIKE 'extra_%')
),
history_enriched AS MATERIALIZED (
  SELECT
    hb.pool_id,
    hb.user_id,
    hb.record_id,
    hb.rarity,
    hb.server_id,
    hb.region,
    hb.special_type,
    hb.is_free,
    CASE
      WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN true
      WHEN hb.rarity = 6 AND (hb.pool_type = 'extra' OR hb.pool_id LIKE 'joint_%' OR hb.pool_id LIKE 'extra_%') THEN false
      WHEN hb.rarity = 6 AND hb.up_character IS NOT NULL AND hb.up_character <> '' THEN NOT COALESCE(stm.is_target, false)
      ELSE COALESCE(hb.is_standard, false)
    END AS is_standard_calc,
    CASE
      WHEN hb.rarity <> 6 THEN false
      WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN false
      WHEN hb.pool_type = 'extra' OR hb.pool_id LIKE 'joint_%' OR hb.pool_id LIKE 'extra_%' THEN true
      ELSE COALESCE(stm.is_target, false)
    END AS is_target_calc,
    CASE
      WHEN hb.pool_type = 'extra' OR hb.pool_id LIKE 'joint_%' OR hb.pool_id LIKE 'extra_%' THEN 'extra'
      WHEN hb.pool_type IN ('limited', 'limited_character') THEN 'limited'
      WHEN hb.pool_type IN ('weapon', 'limited_weapon') THEN 'weapon'
      WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN 'standard'
      WHEN split_part(hb.pool_id, '_', 1) = 'special' THEN 'limited'
      WHEN split_part(hb.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
      WHEN COALESCE(hb.is_standard, false) THEN 'standard'
      ELSE 'limited'
    END AS classified_pool_type
  FROM history_base AS hb
  LEFT JOIN six_star_target_matches AS stm
    ON stm.pool_id = hb.pool_id
   AND stm.user_id = hb.user_id
   AND stm.record_id = hb.record_id
),
valid_pulls AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    record_id,
    rarity,
    server_id,
    region,
    is_standard_calc,
    is_target_calc,
    classified_pool_type
  FROM history_enriched
  WHERE special_type IS DISTINCT FROM 'gift'
    AND (is_free IS NOT TRUE)
),
contributor_regions AS MATERIALIZED (
  SELECT
    user_id,
    CASE
      WHEN bool_or(
        COALESCE(server_id, '') IN ('2', '3')
        OR lower(COALESCE(region, '')) IN ('asia', 'sea', 'jp', 'kr', 'tw', 'hk', 'mo', 'sg', 'global', 'international', 'eu', 'na', 'us')
        OR COALESCE(region, '') IN ('intl')
      ) THEN 'intl'
      ELSE 'cn'
    END AS region_bucket
  FROM valid_pulls
  GROUP BY user_id
),
contributor_region_counts AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE region_bucket = 'cn') AS cn_contributors,
    COUNT(*) FILTER (WHERE region_bucket = 'intl') AS intl_contributors
  FROM contributor_regions
),
limited_pool_sequence AS MATERIALIZED (
  SELECT
    p.pool_id,
    LEAD(p.pool_id) OVER (
      ORDER BY COALESCE(p.start_time, p.created_at), p.pool_id
    ) AS next_pool_id
  FROM public.pools AS p
  WHERE p.type IN ('limited', 'limited_character')
),
limited_paid_pool_counts AS MATERIALIZED (
  SELECT
    vp.user_id,
    vp.pool_id,
    COUNT(*) AS paid_pull_count
  FROM valid_pulls AS vp
  WHERE vp.classified_pool_type = 'limited'
  GROUP BY vp.user_id, vp.pool_id
),
info_book_credits AS MATERIALIZED (
  SELECT
    lpc.user_id,
    lps.next_pool_id AS pool_id,
    SUM(10) AS credit_pull_count
  FROM limited_paid_pool_counts AS lpc
  JOIN limited_pool_sequence AS lps
    ON lps.pool_id = lpc.pool_id
  WHERE lps.next_pool_id IS NOT NULL
    AND lpc.paid_pull_count >= 60
  GROUP BY lpc.user_id, lps.next_pool_id
),
info_book_pull_total AS MATERIALIZED (
  SELECT COALESCE(SUM(
    LEAST(ibc.credit_pull_count, COALESCE(next_pool.paid_pull_count, 0))
  ), 0) AS info_book_pull_count
  FROM info_book_credits AS ibc
  LEFT JOIN limited_paid_pool_counts AS next_pool
    ON next_pool.user_id = ibc.user_id
   AND next_pool.pool_id = ibc.pool_id
),
history_counts AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE special_type IS DISTINCT FROM 'gift') AS total_pulls_with_free,
    COUNT(*) FILTER (WHERE special_type IS DISTINCT FROM 'gift' AND is_free = true) AS free_pull_count,
    COUNT(*) FILTER (WHERE special_type = 'gift') AS gift_total,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'limited'
    ) AS char_gift,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'weapon'
        AND is_standard_calc = false
    ) AS weapon_gift_limited,
    COUNT(*) FILTER (
      WHERE special_type = 'gift'
        AND rarity = 6
        AND classified_pool_type = 'weapon'
        AND is_standard_calc = true
    ) AS weapon_gift_standard
  FROM history_enriched
),
type_counts AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE rarity = 6) AS six,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = false) AS six_star_limited,
    COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = true) AS six_star_standard,
    COUNT(*) FILTER (WHERE rarity = 5) AS five,
    COUNT(*) FILTER (WHERE rarity <= 4) AS four
  FROM valid_pulls
  GROUP BY classified_pool_type
),
valid_counts AS (
  SELECT
    COALESCE(SUM(total), 0) AS total_pulls,
    (SELECT COUNT(*) FROM contributor_regions) AS total_contributors,
    COALESCE(SUM(six), 0) AS six_star_total,
    COALESCE(SUM(six_star_limited), 0) AS six_star_limited,
    COALESCE(SUM(six_star_standard), 0) AS six_star_standard,
    COALESCE(SUM(five), 0) AS five_star,
    COALESCE(SUM(four), 0) AS four_star
  FROM type_counts
),
charged_counts AS (
  SELECT
    COALESCE(tc_extra.total, 0) + COALESCE(tc_l.total, 0) - ibt.info_book_pull_count + COALESCE(tc_s.total, 0) AS charged_character_pulls,
    COALESCE(tc_w.total, 0) AS charged_weapon_pulls,
    COALESCE(tc_extra.total, 0) AS charged_extra_pulls,
    COALESCE(tc_l.total, 0) - ibt.info_book_pull_count AS charged_limited_pulls,
    COALESCE(tc_s.total, 0) AS charged_standard_pulls,
    COALESCE(tc_w.total, 0) AS charged_weapon_type_pulls,
    ibt.info_book_pull_count
  FROM info_book_pull_total AS ibt
  LEFT JOIN type_counts AS tc_extra ON tc_extra.classified_pool_type = 'extra'
  LEFT JOIN type_counts AS tc_l ON tc_l.classified_pool_type = 'limited'
  LEFT JOIN type_counts AS tc_s ON tc_s.classified_pool_type = 'standard'
  LEFT JOIN type_counts AS tc_w ON tc_w.classified_pool_type = 'weapon'
),
six_star_pity AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    is_standard_calc,
    is_target_calc,
    classified_pool_type,
    rn,
    LEAST(
      rn - COALESCE(LAG(rn) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0),
      80
    ) AS pity
  FROM (
    SELECT
      pool_id, user_id, rarity, is_standard_calc, is_target_calc, classified_pool_type,
      ROW_NUMBER() OVER (PARTITION BY pool_id, user_id ORDER BY record_id) AS rn
    FROM valid_pulls
  ) AS all_numbered
  WHERE rarity = 6
),
target_hit_rows AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    classified_pool_type,
    rn
  FROM six_star_pity
  WHERE (classified_pool_type IN ('extra', 'limited') AND is_target_calc = true)
     OR (classified_pool_type = 'weapon' AND is_standard_calc = false)
),
limited_first_target AS MATERIALIZED (
  SELECT
    pool_id,
    user_id,
    MIN(rn) AS first_target_rn
  FROM target_hit_rows
  WHERE classified_pool_type = 'limited'
  GROUP BY pool_id, user_id
),
limited_target_hits AS MATERIALIZED (
  SELECT
    thr.pool_id,
    thr.user_id,
    thr.rn,
    CASE
      WHEN thr.rn = 120
        AND COALESCE(lft.first_target_rn, 999999) = 120
      THEN true
      ELSE false
    END AS is_spark
  FROM target_hit_rows AS thr
  LEFT JOIN limited_first_target AS lft
    ON lft.pool_id = thr.pool_id
   AND lft.user_id = thr.user_id
  WHERE thr.classified_pool_type = 'limited'
),
target_hit_counts AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COUNT(*) AS target_count
  FROM target_hit_rows
  GROUP BY classified_pool_type
),
pity_ranges AS MATERIALIZED (
  SELECT
    classified_pool_type,
    is_standard_calc,
    CASE
      WHEN pity BETWEEN 1 AND 10 THEN '01-10'
      WHEN pity BETWEEN 11 AND 20 THEN '11-20'
      WHEN pity BETWEEN 21 AND 30 THEN '21-30'
      WHEN pity BETWEEN 31 AND 40 THEN '31-40'
      WHEN pity BETWEEN 41 AND 50 THEN '41-50'
      WHEN pity BETWEEN 51 AND 60 THEN '51-60'
      WHEN pity BETWEEN 61 AND 70 THEN '61-70'
      WHEN pity BETWEEN 71 AND 80 THEN '71-80'
      WHEN pity BETWEEN 81 AND 90 THEN '81-90'
      ELSE '91+'
    END AS range_label
  FROM six_star_pity
),
global_distribution_rows AS MATERIALIZED (
  SELECT
    range_label,
    COUNT(*) FILTER (WHERE is_standard_calc = false) AS limited_count,
    COUNT(*) FILTER (WHERE is_standard_calc = true) AS standard_count
  FROM pity_ranges
  GROUP BY range_label
),
type_distribution_rows AS MATERIALIZED (
  SELECT
    classified_pool_type,
    range_label,
    COUNT(*) FILTER (WHERE is_standard_calc = false) AS limited_count,
    COUNT(*) FILTER (WHERE is_standard_calc = true) AS standard_count
  FROM pity_ranges
  GROUP BY classified_pool_type, range_label
),
global_distribution AS MATERIALIZED (
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'range', REPLACE(range_label, '01-10', '1-10'),
        'limited', limited_count,
        'standard', standard_count
      )
      ORDER BY range_label
    ),
    '[]'::json
  ) AS distribution
  FROM global_distribution_rows
),
type_distributions AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COALESCE(
      json_agg(
        json_build_object(
          'range', REPLACE(range_label, '01-10', '1-10'),
          'limited', limited_count,
          'standard', standard_count
        )
        ORDER BY range_label
      ),
      '[]'::json
    ) AS distribution
  FROM type_distribution_rows
  GROUP BY classified_pool_type
),
global_avg_pity AS MATERIALIZED (
  SELECT ROUND(AVG(pity)::numeric, 1) AS avg_pity
  FROM six_star_pity
),
type_pity_stats AS MATERIALIZED (
  SELECT
    classified_pool_type,
    ROUND(AVG(pity)::numeric, 1) AS avg_pity
  FROM six_star_pity
  GROUP BY classified_pool_type
),
target_pity_stats AS MATERIALIZED (
  SELECT
    tc.classified_pool_type,
    ROUND(
      tc.total::numeric / NULLIF(thc.target_count, 0),
      1
    ) AS avg_pity_target
  FROM type_counts AS tc
  JOIN target_hit_counts AS thc
    ON thc.classified_pool_type = tc.classified_pool_type
  WHERE tc.classified_pool_type IN ('extra', 'limited', 'weapon')
),
limited_spark_stats AS MATERIALIZED (
  SELECT
    COUNT(*) FILTER (WHERE is_spark = true) AS spark_count
  FROM limited_target_hits
),
total_users AS MATERIALIZED (
  SELECT COUNT(*) AS total_users
  FROM public.profiles
)
SELECT json_build_object(
  'totalPulls', COALESCE(vc.total_pulls, 0),
  'totalPullsWithFree', COALESCE(hc.total_pulls_with_free, 0),
  'freePullCount', COALESCE(hc.free_pull_count, 0),
  'chargedCharacterPulls', COALESCE(cc.charged_character_pulls, 0),
  'chargedWeaponPulls', COALESCE(cc.charged_weapon_pulls, 0),
  'infoBookPullCount', COALESCE(cc.info_book_pull_count, 0),
  'totalUsers', COALESCE(tu.total_users, 0),
  'totalContributors', COALESCE(vc.total_contributors, 0),
  'contributorsByRegion', json_build_object(
    'cn', COALESCE(crc.cn_contributors, 0),
    'intl', COALESCE(crc.intl_contributors, 0)
  ),
  'sixStarTotal', COALESCE(vc.six_star_total, 0),
  'sixStarLimited', COALESCE(vc.six_star_limited, 0),
  'sixStarStandard', COALESCE(vc.six_star_standard, 0),
  'fiveStar', COALESCE(vc.five_star, 0),
  'fourStar', COALESCE(vc.four_star, 0),
  'avgPity', COALESCE(gap.avg_pity, 0),
  'counts', json_build_object(
    '6', COALESCE(vc.six_star_limited, 0),
    '6_std', COALESCE(vc.six_star_standard, 0),
    '5', COALESCE(vc.five_star, 0),
    '4', COALESCE(vc.four_star, 0)
  ),
  'distribution', COALESCE(gd.distribution, '[]'::json),
  'byType', json_build_object(
    'extra', json_build_object(
      'total', COALESCE(tc_extra.total, 0),
      'chargedPulls', COALESCE(cc.charged_extra_pulls, 0),
      'six', COALESCE(tc_extra.six, 0),
      'sixStarLimited', COALESCE(tc_extra.six_star_limited, 0),
      'sixStarStandard', COALESCE(tc_extra.six_star_standard, 0),
      'avgPity', COALESCE(tps_extra.avg_pity, 0),
      'avgPityUp', COALESCE(tgt_extra.avg_pity_target, 0),
      'avgPityTarget', COALESCE(tgt_extra.avg_pity_target, 0),
      'sparkCount', 0,
      'counts', json_build_object(
        '6', COALESCE(tc_extra.six_star_limited, 0),
        '6_std', COALESCE(tc_extra.six_star_standard, 0),
        '5', COALESCE(tc_extra.five, 0),
        '4', COALESCE(tc_extra.four, 0)
      ),
      'distribution', COALESCE(td_extra.distribution, '[]'::json)
    ),
    'limited', json_build_object(
      'total', COALESCE(tc_limited.total, 0),
      'chargedPulls', COALESCE(cc.charged_limited_pulls, 0),
      'six', COALESCE(tc_limited.six, 0),
      'sixStarLimited', COALESCE(tc_limited.six_star_limited, 0),
      'sixStarStandard', COALESCE(tc_limited.six_star_standard, 0),
      'avgPity', COALESCE(tps_limited.avg_pity, 0),
      'avgPityUp', COALESCE(tgt_limited.avg_pity_target, 0),
      'avgPityTarget', COALESCE(tgt_limited.avg_pity_target, 0),
      'sparkCount', COALESCE(lss.spark_count, 0),
      'counts', json_build_object(
        '6', COALESCE(tc_limited.six_star_limited, 0),
        '6_std', COALESCE(tc_limited.six_star_standard, 0),
        '5', COALESCE(tc_limited.five, 0),
        '4', COALESCE(tc_limited.four, 0)
      ),
      'distribution', COALESCE(td_limited.distribution, '[]'::json)
    ),
    'weapon', json_build_object(
      'total', COALESCE(tc_weapon.total, 0),
      'chargedPulls', COALESCE(cc.charged_weapon_type_pulls, 0),
      'six', COALESCE(tc_weapon.six, 0),
      'sixStarLimited', COALESCE(tc_weapon.six_star_limited, 0),
      'sixStarStandard', COALESCE(tc_weapon.six_star_standard, 0),
      'avgPity', COALESCE(tps_weapon.avg_pity, 0),
      'avgPityUp', COALESCE(tgt_weapon.avg_pity_target, 0),
      'avgPityTarget', COALESCE(tgt_weapon.avg_pity_target, 0),
      'counts', json_build_object(
        '6', COALESCE(tc_weapon.six_star_limited, 0),
        '6_std', COALESCE(tc_weapon.six_star_standard, 0),
        '5', COALESCE(tc_weapon.five, 0),
        '4', COALESCE(tc_weapon.four, 0)
      ),
      'distribution', COALESCE(td_weapon.distribution, '[]'::json)
    ),
    'standard', json_build_object(
      'total', COALESCE(tc_standard.total, 0),
      'chargedPulls', COALESCE(cc.charged_standard_pulls, 0),
      'six', COALESCE(tc_standard.six, 0),
      'sixStarLimited', 0,
      'sixStarStandard', COALESCE(tc_standard.six, 0),
      'avgPity', COALESCE(tps_standard.avg_pity, 0),
      'counts', json_build_object(
        '6', 0,
        '6_std', COALESCE(tc_standard.six, 0),
        '5', COALESCE(tc_standard.five, 0),
        '4', COALESCE(tc_standard.four, 0)
      ),
      'distribution', COALESCE(td_standard.distribution, '[]'::json)
    )
  ),
  'charGift', COALESCE(hc.char_gift, 0),
  'weaponGiftLimited', COALESCE(hc.weapon_gift_limited, 0),
  'weaponGiftStandard', COALESCE(hc.weapon_gift_standard, 0),
  'giftTotal', COALESCE(hc.gift_total, 0)
)
FROM valid_counts AS vc
CROSS JOIN history_counts AS hc
CROSS JOIN charged_counts AS cc
CROSS JOIN global_avg_pity AS gap
CROSS JOIN global_distribution AS gd
CROSS JOIN total_users AS tu
CROSS JOIN contributor_region_counts AS crc
CROSS JOIN limited_spark_stats AS lss
LEFT JOIN type_counts AS tc_extra
  ON tc_extra.classified_pool_type = 'extra'
LEFT JOIN type_counts AS tc_limited
  ON tc_limited.classified_pool_type = 'limited'
LEFT JOIN type_counts AS tc_weapon
  ON tc_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_counts AS tc_standard
  ON tc_standard.classified_pool_type = 'standard'
LEFT JOIN type_pity_stats AS tps_extra
  ON tps_extra.classified_pool_type = 'extra'
LEFT JOIN type_pity_stats AS tps_limited
  ON tps_limited.classified_pool_type = 'limited'
LEFT JOIN type_pity_stats AS tps_weapon
  ON tps_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_pity_stats AS tps_standard
  ON tps_standard.classified_pool_type = 'standard'
LEFT JOIN target_pity_stats AS tgt_extra
  ON tgt_extra.classified_pool_type = 'extra'
LEFT JOIN target_pity_stats AS tgt_limited
  ON tgt_limited.classified_pool_type = 'limited'
LEFT JOIN target_pity_stats AS tgt_weapon
  ON tgt_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_distributions AS td_extra
  ON td_extra.classified_pool_type = 'extra'
LEFT JOIN type_distributions AS td_limited
  ON td_limited.classified_pool_type = 'limited'
LEFT JOIN type_distributions AS td_weapon
  ON td_weapon.classified_pool_type = 'weapon'
LEFT JOIN type_distributions AS td_standard
  ON td_standard.classified_pool_type = 'standard';
$$;

GRANT EXECUTE ON FUNCTION public.get_global_stats() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_character_ranking_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  WITH
  history_with_info AS (
    SELECT
      h.rarity,
      COALESCE(NULLIF(h.item_name, ''), NULLIF(h.character_name, '')) AS item_name,
      h.is_free,
      h.special_type,
      h.pool_id,
      COALESCE(c.type, 'character') as item_type,
      COALESCE(c.is_limited, false) as char_is_limited,
      p.up_character as pool_up_character,
      CASE
        WHEN h.pool_id LIKE 'joint_%' OR h.pool_id LIKE 'extra_%' THEN 'extra'
        WHEN h.pool_id LIKE 'special_%' THEN 'limited'
        WHEN h.pool_id LIKE 'weapon%' OR h.pool_id LIKE 'wepon%' THEN 'weapon'
        WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
        WHEN p.type IS NOT NULL THEN
          CASE
            WHEN p.type = 'extra' THEN 'extra'
            WHEN p.type IN ('limited', 'limited_character') THEN 'limited'
            WHEN p.type IN ('weapon', 'limited_weapon') THEN 'weapon'
            ELSE 'standard'
          END
        ELSE 'standard'
      END as pool_type
    FROM public.history h
    LEFT JOIN public.pools p ON p.pool_id = h.pool_id
    LEFT JOIN public.characters c
      ON c.name = COALESCE(NULLIF(h.item_name, ''), NULLIF(h.character_name, ''))
    WHERE h.special_type IS DISTINCT FROM 'gift'
      AND COALESCE(NULLIF(h.item_name, ''), NULLIF(h.character_name, '')) IS NOT NULL
  ),
  history_classified AS (
    SELECT *,
      CASE
        WHEN pool_type = 'extra' AND rarity = 6 THEN 'up'
        WHEN rarity = 6 AND char_is_limited = true THEN
          CASE
            WHEN pool_up_character IS NOT NULL
              AND (
                LOWER(item_name) = LOWER(pool_up_character)
                OR LOWER(item_name) LIKE '%' || LOWER(pool_up_character) || '%'
                OR LOWER(pool_up_character) LIKE '%' || LOWER(item_name) || '%'
              )
            THEN 'up'
            ELSE 'off_limited'
          END
        WHEN rarity = 6 AND char_is_limited = false THEN 'off_standard'
        ELSE 'other'
      END as six_star_category
    FROM history_with_info
  ),
  extra_six_star_up AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'extra'
      AND rarity = 6
      AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 6
  ),
  extra_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'extra'
      AND rarity = 5
      AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  limited_six_star_up AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited'
      AND rarity = 6
      AND item_type = 'character'
      AND six_star_category = 'up'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 6
  ),
  limited_six_star_off_standard AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited'
      AND rarity = 6
      AND item_type = 'character'
      AND six_star_category = 'off_standard'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 5
  ),
  limited_six_star_off_limited AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited'
      AND rarity = 6
      AND item_type = 'character'
      AND six_star_category = 'off_limited'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 5
  ),
  limited_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited'
      AND rarity = 5
      AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  standard_six_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'standard'
      AND rarity = 6
      AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 5
  ),
  standard_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'standard'
      AND rarity = 5
      AND item_type = 'character'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  weapon_six_star_up AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'weapon'
      AND rarity = 6
      AND item_type = 'weapon'
      AND six_star_category = 'up'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  weapon_six_star_off AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'weapon'
      AND rarity = 6
      AND item_type = 'weapon'
      AND six_star_category IN ('off_standard', 'off_limited')
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  weapon_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'weapon'
      AND rarity = 5
      AND item_type = 'weapon'
    GROUP BY item_name
    ORDER BY count DESC
    LIMIT 3
  ),
  extra_six_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE is_free = false OR is_free IS NULL) as excluding_free
    FROM history_classified
    WHERE pool_type = 'extra'
      AND rarity = 6
      AND item_type = 'character'
  ),
  limited_six_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE is_free = false OR is_free IS NULL) as excluding_free,
      COUNT(*) FILTER (WHERE six_star_category = 'up') as up_count,
      COUNT(*) FILTER (WHERE six_star_category IN ('off_standard', 'off_limited')) as off_count,
      COUNT(*) FILTER (WHERE six_star_category = 'off_standard') as off_standard_count,
      COUNT(*) FILTER (WHERE six_star_category = 'off_limited') as off_limited_count,
      COUNT(*) FILTER (WHERE six_star_category = 'up' AND (is_free = false OR is_free IS NULL)) as up_excluding_free,
      COUNT(*) FILTER (WHERE six_star_category IN ('off_standard', 'off_limited') AND (is_free = false OR is_free IS NULL)) as off_excluding_free,
      COUNT(*) FILTER (WHERE six_star_category = 'off_standard' AND (is_free = false OR is_free IS NULL)) as off_standard_excluding_free,
      COUNT(*) FILTER (WHERE six_star_category = 'off_limited' AND (is_free = false OR is_free IS NULL)) as off_limited_excluding_free
    FROM history_classified
    WHERE pool_type = 'limited'
      AND rarity = 6
      AND item_type = 'character'
  ),
  standard_six_counts AS (
    SELECT COUNT(*) as total
    FROM history_classified
    WHERE pool_type = 'standard'
      AND rarity = 6
      AND item_type = 'character'
  ),
  weapon_six_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE six_star_category = 'up') as up_count,
      COUNT(*) FILTER (WHERE six_star_category IN ('off_standard', 'off_limited')) as off_count
    FROM history_classified
    WHERE pool_type = 'weapon'
      AND rarity = 6
      AND item_type = 'weapon'
  )
  SELECT json_build_object(
    'extra', json_build_object(
      'sixStarUp', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM extra_six_star_up),
      'sixStarOff', '[]'::json,
      'sixStarOffLimited', '[]'::json,
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM extra_six_star_up),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM extra_five_star),
      'sixStarTotal', (SELECT COALESCE(total, 0) FROM extra_six_counts),
      'sixStarExcludingFree', (SELECT COALESCE(excluding_free, 0) FROM extra_six_counts),
      'sixStarUpCount', (SELECT COALESCE(total, 0) FROM extra_six_counts),
      'sixStarOffCount', 0,
      'sixStarOffStandardCount', 0,
      'sixStarOffLimitedCount', 0,
      'sixStarUpExcludingFree', (SELECT COALESCE(excluding_free, 0) FROM extra_six_counts),
      'sixStarOffExcludingFree', 0,
      'sixStarOffStandardExcludingFree', 0,
      'sixStarOffLimitedExcludingFree', 0
    ),
    'limited', json_build_object(
      'sixStarUp', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_up),
      'sixStarOff', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_off_standard),
      'sixStarOffLimited', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_off_limited),
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_up),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_five_star),
      'sixStarTotal', (SELECT COALESCE(total, 0) FROM limited_six_counts),
      'sixStarExcludingFree', (SELECT COALESCE(excluding_free, 0) FROM limited_six_counts),
      'sixStarUpCount', (SELECT COALESCE(up_count, 0) FROM limited_six_counts),
      'sixStarOffCount', (SELECT COALESCE(off_count, 0) FROM limited_six_counts),
      'sixStarOffStandardCount', (SELECT COALESCE(off_standard_count, 0) FROM limited_six_counts),
      'sixStarOffLimitedCount', (SELECT COALESCE(off_limited_count, 0) FROM limited_six_counts),
      'sixStarUpExcludingFree', (SELECT COALESCE(up_excluding_free, 0) FROM limited_six_counts),
      'sixStarOffExcludingFree', (SELECT COALESCE(off_excluding_free, 0) FROM limited_six_counts),
      'sixStarOffStandardExcludingFree', (SELECT COALESCE(off_standard_excluding_free, 0) FROM limited_six_counts),
      'sixStarOffLimitedExcludingFree', (SELECT COALESCE(off_limited_excluding_free, 0) FROM limited_six_counts)
    ),
    'standard', json_build_object(
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_six_star),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_five_star),
      'sixStarTotal', (SELECT COALESCE(total, 0) FROM standard_six_counts)
    ),
    'weapon', json_build_object(
      'sixStarUp', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_up),
      'sixStarOff', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_off),
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_up),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_five_star),
      'sixStarTotal', (SELECT COALESCE(total, 0) FROM weapon_six_counts),
      'sixStarUpCount', (SELECT COALESCE(up_count, 0) FROM weapon_six_counts),
      'sixStarOffCount', (SELECT COALESCE(off_count, 0) FROM weapon_six_counts)
    )
  ) INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.get_character_ranking_stats() IS 'FEAT-028: character ranking stats include extra / Joint recruitment pools';
GRANT EXECUTE ON FUNCTION public.get_character_ranking_stats() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_user_ranking_stats(p_user_id uuid)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  WITH
  history_with_info AS (
    SELECT
      h.rarity,
      COALESCE(NULLIF(h.item_name, ''), NULLIF(h.character_name, '')) AS item_name,
      h.is_free,
      h.special_type,
      h.pool_id,
      COALESCE(c.type, 'character') as item_type,
      COALESCE(c.is_limited, false) as char_is_limited,
      p.up_character as pool_up_character,
      CASE
        WHEN h.pool_id LIKE 'joint_%' OR h.pool_id LIKE 'extra_%' THEN 'extra'
        WHEN h.pool_id LIKE 'special_%' THEN 'limited'
        WHEN h.pool_id LIKE 'weapon%' OR h.pool_id LIKE 'wepon%' THEN 'weapon'
        WHEN h.pool_id IN ('standard', 'beginner') THEN 'standard'
        WHEN p.type IS NOT NULL THEN
          CASE
            WHEN p.type = 'extra' THEN 'extra'
            WHEN p.type IN ('limited', 'limited_character') THEN 'limited'
            WHEN p.type IN ('weapon', 'limited_weapon') THEN 'weapon'
            ELSE 'standard'
          END
        ELSE 'standard'
      END as pool_type
    FROM public.history h
    LEFT JOIN public.pools p ON p.pool_id = h.pool_id
    LEFT JOIN public.characters c
      ON c.name = COALESCE(NULLIF(h.item_name, ''), NULLIF(h.character_name, ''))
    WHERE h.user_id = p_user_id
      AND h.special_type IS DISTINCT FROM 'gift'
      AND COALESCE(NULLIF(h.item_name, ''), NULLIF(h.character_name, '')) IS NOT NULL
  ),
  history_classified AS (
    SELECT *,
      CASE
        WHEN pool_type = 'extra' AND rarity = 6 THEN 'up'
        WHEN rarity = 6 AND char_is_limited = true THEN
          CASE
            WHEN pool_up_character IS NOT NULL
              AND (
                LOWER(item_name) = LOWER(pool_up_character)
                OR LOWER(item_name) LIKE '%' || LOWER(pool_up_character) || '%'
                OR LOWER(pool_up_character) LIKE '%' || LOWER(item_name) || '%'
              )
            THEN 'up'
            ELSE 'off_limited'
          END
        WHEN rarity = 6 AND char_is_limited = false THEN 'off_standard'
        ELSE 'other'
      END as six_star_category
    FROM history_with_info
  ),
  extra_six_star_up AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'extra' AND rarity = 6 AND item_type = 'character'
    GROUP BY item_name ORDER BY count DESC LIMIT 6
  ),
  extra_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'extra' AND rarity = 5 AND item_type = 'character'
    GROUP BY item_name ORDER BY count DESC LIMIT 3
  ),
  limited_six_star_up AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited' AND rarity = 6 AND item_type = 'character'
      AND six_star_category = 'up'
    GROUP BY item_name ORDER BY count DESC LIMIT 6
  ),
  limited_six_star_off_standard AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited' AND rarity = 6 AND item_type = 'character'
      AND six_star_category = 'off_standard'
    GROUP BY item_name ORDER BY count DESC LIMIT 5
  ),
  limited_six_star_off_limited AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited' AND rarity = 6 AND item_type = 'character'
      AND six_star_category = 'off_limited'
    GROUP BY item_name ORDER BY count DESC LIMIT 5
  ),
  limited_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'limited' AND rarity = 5 AND item_type = 'character'
    GROUP BY item_name ORDER BY count DESC LIMIT 3
  ),
  standard_six_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'standard' AND rarity = 6 AND item_type = 'character'
    GROUP BY item_name ORDER BY count DESC LIMIT 5
  ),
  standard_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'standard' AND rarity = 5 AND item_type = 'character'
    GROUP BY item_name ORDER BY count DESC LIMIT 3
  ),
  weapon_six_star_up AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'weapon' AND rarity = 6 AND item_type = 'weapon'
      AND six_star_category = 'up'
    GROUP BY item_name ORDER BY count DESC LIMIT 3
  ),
  weapon_six_star_off AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'weapon' AND rarity = 6 AND item_type = 'weapon'
      AND six_star_category IN ('off_standard', 'off_limited')
    GROUP BY item_name ORDER BY count DESC LIMIT 3
  ),
  weapon_five_star AS (
    SELECT item_name as name, COUNT(*) as count
    FROM history_classified
    WHERE pool_type = 'weapon' AND rarity = 5 AND item_type = 'weapon'
    GROUP BY item_name ORDER BY count DESC LIMIT 3
  ),
  extra_six_counts AS (
    SELECT COUNT(*) as total
    FROM history_classified
    WHERE pool_type = 'extra' AND rarity = 6 AND item_type = 'character'
  ),
  limited_six_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE six_star_category = 'up') as up_count,
      COUNT(*) FILTER (WHERE six_star_category IN ('off_standard', 'off_limited')) as off_count,
      COUNT(*) FILTER (WHERE six_star_category = 'off_standard') as off_standard_count,
      COUNT(*) FILTER (WHERE six_star_category = 'off_limited') as off_limited_count
    FROM history_classified
    WHERE pool_type = 'limited' AND rarity = 6 AND item_type = 'character'
  ),
  weapon_six_counts AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE six_star_category = 'up') as up_count,
      COUNT(*) FILTER (WHERE six_star_category IN ('off_standard', 'off_limited')) as off_count
    FROM history_classified
    WHERE pool_type = 'weapon' AND rarity = 6 AND item_type = 'weapon'
  )
  SELECT json_build_object(
    'extra', json_build_object(
      'sixStarUp', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM extra_six_star_up),
      'sixStarOff', '[]'::json,
      'sixStarOffLimited', '[]'::json,
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM extra_six_star_up),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM extra_five_star),
      'sixStarUpCount', (SELECT COALESCE(total, 0) FROM extra_six_counts),
      'sixStarOffCount', 0,
      'sixStarOffStandardCount', 0,
      'sixStarOffLimitedCount', 0
    ),
    'limited', json_build_object(
      'sixStarUp', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_up),
      'sixStarOff', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_off_standard),
      'sixStarOffLimited', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_off_limited),
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_six_star_up),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM limited_five_star),
      'sixStarUpCount', (SELECT COALESCE(up_count, 0) FROM limited_six_counts),
      'sixStarOffCount', (SELECT COALESCE(off_count, 0) FROM limited_six_counts),
      'sixStarOffStandardCount', (SELECT COALESCE(off_standard_count, 0) FROM limited_six_counts),
      'sixStarOffLimitedCount', (SELECT COALESCE(off_limited_count, 0) FROM limited_six_counts)
    ),
    'standard', json_build_object(
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_six_star),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM standard_five_star)
    ),
    'weapon', json_build_object(
      'sixStarUp', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_up),
      'sixStarOff', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_off),
      'sixStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_six_star_up),
      'fiveStar', (SELECT COALESCE(json_agg(json_build_object('name', name, 'count', count)), '[]'::json) FROM weapon_five_star),
      'sixStarUpCount', (SELECT COALESCE(up_count, 0) FROM weapon_six_counts),
      'sixStarOffCount', (SELECT COALESCE(off_count, 0) FROM weapon_six_counts)
    )
  ) INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.get_user_ranking_stats(uuid) IS 'FEAT-028: user ranking stats include extra / Joint recruitment pools';
GRANT EXECUTE ON FUNCTION public.get_user_ranking_stats(uuid) TO anon, authenticated;

DELETE FROM public.stats_cache
WHERE cache_key IN (
    'global_stats',
    'global_stats:v2',
    'character_ranking',
    'character_ranking:v2',
    'character_ranking:v3'
  )
   OR cache_key LIKE 'user_ranking:%'
   OR cache_key LIKE 'user_ranking:v2:%'
   OR cache_key LIKE 'user_ranking:v3:%';

CREATE OR REPLACE FUNCTION public.get_global_stats_cached(
  p_buffer_seconds INT DEFAULT 300
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count BIGINT;
  v_cached_data   JSONB;
  v_cached_fp     BIGINT;
  v_cached_at     TIMESTAMPTZ;
  v_result        JSON;
  v_max_ttl       INTERVAL := INTERVAL '24 hours';
  v_cache_key     TEXT := 'global_stats:v2';
BEGIN
  SELECT count(*) INTO v_current_count FROM public.history;

  SELECT cached_data, row_fingerprint, computed_at
    INTO v_cached_data, v_cached_fp, v_cached_at
    FROM public.stats_cache
   WHERE cache_key = v_cache_key;

  IF v_cached_data IS NOT NULL THEN
    IF v_cached_fp = v_current_count
       AND v_cached_at + v_max_ttl > now() THEN
      RETURN v_cached_data::JSON;
    END IF;

    IF v_cached_fp <> v_current_count
       AND v_cached_at + (p_buffer_seconds || ' seconds')::INTERVAL > now() THEN
      RETURN v_cached_data::JSON;
    END IF;
  END IF;

  SELECT public.get_global_stats() INTO v_result;

  INSERT INTO public.stats_cache (cache_key, cached_data, row_fingerprint, computed_at)
  VALUES (v_cache_key, v_result::JSONB, v_current_count, now())
  ON CONFLICT (cache_key) DO UPDATE SET
    cached_data     = EXCLUDED.cached_data,
    row_fingerprint = EXCLUDED.row_fingerprint,
    computed_at     = EXCLUDED.computed_at;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_global_stats_cached(INT)
  SET statement_timeout = '120s';

GRANT EXECUTE ON FUNCTION public.get_global_stats_cached(INT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_character_ranking_stats_cached(
  p_buffer_seconds INT DEFAULT 300
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count BIGINT;
  v_cached_data   JSONB;
  v_cached_fp     BIGINT;
  v_cached_at     TIMESTAMPTZ;
  v_result        JSON;
  v_max_ttl       INTERVAL := INTERVAL '24 hours';
  v_cache_key     TEXT := 'character_ranking:v3';
BEGIN
  SELECT count(*) INTO v_current_count FROM public.history;

  SELECT cached_data, row_fingerprint, computed_at
    INTO v_cached_data, v_cached_fp, v_cached_at
    FROM public.stats_cache
   WHERE cache_key = v_cache_key;

  IF v_cached_data IS NOT NULL THEN
    IF v_cached_fp = v_current_count
       AND v_cached_at + v_max_ttl > now() THEN
      RETURN v_cached_data::JSON;
    END IF;

    IF v_cached_fp <> v_current_count
       AND v_cached_at + (p_buffer_seconds || ' seconds')::INTERVAL > now() THEN
      RETURN v_cached_data::JSON;
    END IF;
  END IF;

  SELECT public.get_character_ranking_stats() INTO v_result;

  INSERT INTO public.stats_cache (cache_key, cached_data, row_fingerprint, computed_at)
  VALUES (v_cache_key, v_result::JSONB, v_current_count, now())
  ON CONFLICT (cache_key) DO UPDATE SET
    cached_data     = EXCLUDED.cached_data,
    row_fingerprint = EXCLUDED.row_fingerprint,
    computed_at     = EXCLUDED.computed_at;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_character_ranking_stats_cached(INT)
  SET statement_timeout = '90s';

GRANT EXECUTE ON FUNCTION public.get_character_ranking_stats_cached(INT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_user_ranking_stats_cached(
  p_user_id UUID,
  p_buffer_seconds INT DEFAULT 120
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count BIGINT;
  v_cache_key     TEXT;
  v_cached_data   JSONB;
  v_cached_fp     BIGINT;
  v_cached_at     TIMESTAMPTZ;
  v_result        JSON;
  v_max_ttl       INTERVAL := INTERVAL '6 hours';
BEGIN
  SELECT count(*) INTO v_current_count
    FROM public.history
   WHERE user_id = p_user_id;

  v_cache_key := 'user_ranking:v3:' || p_user_id::TEXT;

  SELECT cached_data, row_fingerprint, computed_at
    INTO v_cached_data, v_cached_fp, v_cached_at
    FROM public.stats_cache
   WHERE cache_key = v_cache_key;

  IF v_cached_data IS NOT NULL THEN
    IF v_cached_fp = v_current_count
       AND v_cached_at + v_max_ttl > now() THEN
      RETURN v_cached_data::JSON;
    END IF;

    IF v_cached_fp <> v_current_count
       AND v_cached_at + (p_buffer_seconds || ' seconds')::INTERVAL > now() THEN
      RETURN v_cached_data::JSON;
    END IF;
  END IF;

  SELECT public.get_user_ranking_stats(p_user_id) INTO v_result;

  INSERT INTO public.stats_cache (cache_key, cached_data, row_fingerprint, computed_at)
  VALUES (v_cache_key, v_result::JSONB, v_current_count, now())
  ON CONFLICT (cache_key) DO UPDATE SET
    cached_data     = EXCLUDED.cached_data,
    row_fingerprint = EXCLUDED.row_fingerprint,
    computed_at     = EXCLUDED.computed_at;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_user_ranking_stats_cached(UUID, INT)
  SET statement_timeout = '90s';

GRANT EXECUTE ON FUNCTION public.get_user_ranking_stats_cached(UUID, INT) TO anon, authenticated;
-- <<< END MIGRATION: archive/109_include_extra_pool_in_stats.sql

-- >>> BEGIN MIGRATION: archive/110_add_pool_type_quota_to_global_stats.sql
-- 110: add pool-type quota summaries to global stats cache.
--
-- Migration 109 made extra / Joint pools visible in global stats and rankings.
-- The global all-pool resource summary can still receive aggregate quota data
-- from the character catalog RPC, but pool-type views need per-type quota
-- summaries. This migration computes quota aggregates by classified pool type
-- and injects them into get_global_stats_cached().

CREATE OR REPLACE FUNCTION public.get_pool_type_quota_stats()
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH history_base AS MATERIALIZED (
  SELECT
    h.pool_id,
    h.user_id,
    h.rarity,
    h.special_type,
    h.is_standard,
    h.character_name,
    h.item_name,
    p.type AS pool_type
  FROM public.history AS h
  LEFT JOIN public.pools AS p ON p.pool_id = h.pool_id
  WHERE h.special_type IS DISTINCT FROM 'gift'
),
history_classified AS MATERIALIZED (
  SELECT
    hb.pool_id,
    hb.user_id,
    hb.rarity,
    COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), '') AS item_name,
    CASE
      WHEN hb.pool_type = 'extra' OR hb.pool_id LIKE 'joint_%' OR hb.pool_id LIKE 'extra_%' THEN 'extra'
      WHEN hb.pool_type IN ('limited', 'limited_character') THEN 'limited'
      WHEN hb.pool_type IN ('weapon', 'limited_weapon') THEN 'weapon'
      WHEN hb.pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN 'standard'
      WHEN split_part(hb.pool_id, '_', 1) = 'special' THEN 'limited'
      WHEN split_part(hb.pool_id, '_', 1) IN ('weaponbox', 'weponbox') THEN 'weapon'
      WHEN COALESCE(hb.is_standard, false) THEN 'standard'
      ELSE 'limited'
    END AS classified_pool_type
  FROM history_base AS hb
),
quota_rows AS MATERIALIZED (
  SELECT
    hc.classified_pool_type,
    hc.user_id,
    hc.rarity,
    COALESCE(c.type, CASE WHEN hc.classified_pool_type = 'weapon' THEN 'weapon' ELSE 'character' END) AS item_type,
    COALESCE(c.id::TEXT, lower(trim(hc.item_name))) AS item_key
  FROM history_classified AS hc
  LEFT JOIN public.characters AS c
    ON lower(c.name) = lower(trim(hc.item_name))
  WHERE hc.item_name <> ''
    AND hc.rarity >= 4
),
character_copies AS MATERIALIZED (
  SELECT
    classified_pool_type,
    user_id,
    item_key,
    MAX(rarity) AS rarity,
    COUNT(*)::BIGINT AS copies
  FROM quota_rows
  WHERE item_type IS DISTINCT FROM 'weapon'
  GROUP BY classified_pool_type, user_id, item_key
),
character_quota_by_type AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COALESCE(SUM(CASE WHEN rarity BETWEEN 4 AND 6 AND copies > 0 THEN 30 ELSE 0 END), 0)::BIGINT AS aic_quota_direct,
    COALESCE(SUM(CASE
      WHEN rarity = 5 THEN GREATEST(copies - 6, 0) * 20
      WHEN rarity = 4 THEN GREATEST(copies - 6, 0) * 5
      ELSE 0
    END), 0)::BIGINT AS aic_quota_convertible,
    COALESCE(SUM(CASE
      WHEN rarity >= 6 THEN GREATEST(copies - 1, 0) * 50
      WHEN rarity = 5 THEN GREATEST(copies - 1, 0) * 10
      ELSE 0
    END), 0)::BIGINT AS bond_quota_direct,
    COALESCE(SUM(CASE WHEN rarity >= 6 THEN GREATEST(copies - 6, 0) * 10 ELSE 0 END), 0)::BIGINT AS endpoint_quota_convertible,
    COALESCE(SUM(GREATEST(copies - 1, 0)), 0)::BIGINT AS trust_tokens_gained,
    COALESCE(SUM(GREATEST(copies - 6, 0)), 0)::BIGINT AS excess_trust_tokens
  FROM character_copies
  GROUP BY classified_pool_type
),
weapon_quota_by_type AS MATERIALIZED (
  SELECT
    classified_pool_type,
    COALESCE(SUM(CASE
      WHEN rarity >= 6 THEN 50
      WHEN rarity = 5 THEN 10
      ELSE 0
    END), 0)::BIGINT AS aic_quota_direct
  FROM quota_rows
  WHERE item_type = 'weapon'
  GROUP BY classified_pool_type
),
extra_pull_quota_by_type AS MATERIALIZED (
  SELECT
    'extra'::TEXT AS classified_pool_type,
    COUNT(*)::BIGINT AS bond_quota_direct
  FROM history_classified
  WHERE classified_pool_type = 'extra'
),
pool_types AS (
  SELECT 'extra'::TEXT AS classified_pool_type
  UNION ALL SELECT 'limited'
  UNION ALL SELECT 'standard'
  UNION ALL SELECT 'weapon'
)
SELECT json_object_agg(
  pt.classified_pool_type,
  json_build_object(
    'aicQuotaDirect',
      COALESCE(cq.aic_quota_direct, 0) + COALESCE(wq.aic_quota_direct, 0),
    'aicQuotaConvertible',
      COALESCE(cq.aic_quota_convertible, 0),
    'aicQuotaTotalPotential',
      COALESCE(cq.aic_quota_direct, 0) + COALESCE(wq.aic_quota_direct, 0) + COALESCE(cq.aic_quota_convertible, 0),
    'bondQuotaDirect',
      COALESCE(cq.bond_quota_direct, 0) + COALESCE(epq.bond_quota_direct, 0),
    'endpointQuotaConvertible',
      COALESCE(cq.endpoint_quota_convertible, 0),
    'trustTokensGained',
      COALESCE(cq.trust_tokens_gained, 0),
    'excessTrustTokens',
      COALESCE(cq.excess_trust_tokens, 0)
  )
) AS quota_by_type
FROM pool_types AS pt
LEFT JOIN character_quota_by_type AS cq
  ON cq.classified_pool_type = pt.classified_pool_type
LEFT JOIN weapon_quota_by_type AS wq
  ON wq.classified_pool_type = pt.classified_pool_type
LEFT JOIN extra_pull_quota_by_type AS epq
  ON epq.classified_pool_type = pt.classified_pool_type;
$$;

ALTER FUNCTION public.get_pool_type_quota_stats()
  SET statement_timeout = '120s';

GRANT EXECUTE ON FUNCTION public.get_pool_type_quota_stats() TO anon, authenticated;

DELETE FROM public.stats_cache
WHERE cache_key IN ('global_stats', 'global_stats:v2', 'global_stats:v3');

CREATE OR REPLACE FUNCTION public.get_global_stats_cached(
  p_buffer_seconds INT DEFAULT 300
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count BIGINT;
  v_cached_data   JSONB;
  v_cached_fp     BIGINT;
  v_cached_at     TIMESTAMPTZ;
  v_result        JSON;
  v_result_data   JSONB;
  v_quota_data    JSONB;
  v_max_ttl       INTERVAL := INTERVAL '24 hours';
  v_cache_key     TEXT := 'global_stats:v3';
BEGIN
  SELECT count(*) INTO v_current_count FROM public.history;

  SELECT cached_data, row_fingerprint, computed_at
    INTO v_cached_data, v_cached_fp, v_cached_at
    FROM public.stats_cache
   WHERE cache_key = v_cache_key;

  IF v_cached_data IS NOT NULL THEN
    IF v_cached_fp = v_current_count
       AND v_cached_at + v_max_ttl > now() THEN
      RETURN v_cached_data::JSON;
    END IF;

    IF v_cached_fp <> v_current_count
       AND v_cached_at + (p_buffer_seconds || ' seconds')::INTERVAL > now() THEN
      RETURN v_cached_data::JSON;
    END IF;
  END IF;

  SELECT public.get_global_stats() INTO v_result;
  SELECT COALESCE(public.get_pool_type_quota_stats()::JSONB, '{}'::JSONB) INTO v_quota_data;

  v_result_data := COALESCE(v_result::JSONB, '{}'::JSONB);
  v_result_data := jsonb_set(v_result_data, '{byType,extra,quotaSummary}', COALESCE(v_quota_data -> 'extra', '{}'::JSONB), true);
  v_result_data := jsonb_set(v_result_data, '{byType,limited,quotaSummary}', COALESCE(v_quota_data -> 'limited', '{}'::JSONB), true);
  v_result_data := jsonb_set(v_result_data, '{byType,standard,quotaSummary}', COALESCE(v_quota_data -> 'standard', '{}'::JSONB), true);
  v_result_data := jsonb_set(v_result_data, '{byType,weapon,quotaSummary}', COALESCE(v_quota_data -> 'weapon', '{}'::JSONB), true);
  v_result := v_result_data::JSON;

  INSERT INTO public.stats_cache (cache_key, cached_data, row_fingerprint, computed_at)
  VALUES (v_cache_key, v_result::JSONB, v_current_count, now())
  ON CONFLICT (cache_key) DO UPDATE SET
    cached_data     = EXCLUDED.cached_data,
    row_fingerprint = EXCLUDED.row_fingerprint,
    computed_at     = EXCLUDED.computed_at;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_global_stats_cached(INT)
  SET statement_timeout = '120s';

GRANT EXECUTE ON FUNCTION public.get_global_stats_cached(INT) TO anon, authenticated;
-- <<< END MIGRATION: archive/110_add_pool_type_quota_to_global_stats.sql

-- >>> BEGIN MIGRATION: archive/111_bump_site_version_430.sql
UPDATE public.site_config
SET value = 'v4.3.0'
WHERE key = 'site_version';
-- <<< END MIGRATION: archive/111_bump_site_version_430.sql

-- >>> BEGIN MIGRATION: archive/112_seed_public_cache_epoch.sql
-- 112: Seed the public cache epoch used by same-origin public API cache keys.

INSERT INTO public.site_config (key, value, label, category, updated_at)
VALUES (
  'public_cache_epoch',
  jsonb_build_object(
    'version', ((extract(epoch from now()) * 1000)::bigint)::text,
    'scope', 'migration',
    'reason', 'migration:112_seed_public_cache_epoch',
    'updatedAt', now()
  )::text,
  '公共缓存版本',
  'system',
  now()
)
ON CONFLICT (key) DO NOTHING;
-- <<< END MIGRATION: archive/112_seed_public_cache_epoch.sql

-- >>> BEGIN MIGRATION: active/113_update_home_roadmap_items.sql
-- 113: Refresh homepage roadmap defaults after v4.3.0 task reprioritization.

UPDATE public.site_config
SET
  value = '[
    {
      "id": "public-cache",
      "icon": "Globe",
      "title": "公共数据缓存",
      "description": "首屏公共数据已统一走同源 API，并支持公共缓存版本刷新。",
      "status": "completed",
      "priority": "high"
    },
    {
      "id": "ops-automation",
      "icon": "RefreshCw",
      "title": "运营自动化二期",
      "description": "自动化任务已具备 job graph、partial 状态、重跑和审计详情。",
      "status": "completed",
      "priority": "high"
    },
    {
      "id": "admin-data",
      "icon": "Database",
      "title": "卡池角色管理",
      "description": "卡池、角色与武器管理已完成重写，支持更安全的编辑流程。",
      "status": "completed",
      "priority": "high"
    },
    {
      "id": "performance-docs",
      "icon": "Rocket",
      "title": "项目瘦身与文档",
      "description": "README、架构文档、截图与入口拆包已完成本轮整理。",
      "status": "completed",
      "priority": "medium"
    },
    {
      "id": "heirlooms-preview",
      "icon": "Map",
      "title": "寻遗散记前瞻",
      "description": "首页版本前瞻内容正在同步真实更新摘要与后续版本信息。",
      "status": "in_progress",
      "priority": "high"
    },
    {
      "id": "official-id-backfill",
      "icon": "Shield",
      "title": "官方 ID 回填",
      "description": "后续将收口手动主键、官方 ID、别名和历史导出的兼容迁移。",
      "status": "planned",
      "priority": "high"
    },
    {
      "id": "public-api-metrics",
      "icon": "Calculator",
      "title": "公共 API 指标",
      "description": "卡池分析将补齐预聚合指标、趋势点、分布桶和口径说明。",
      "status": "planned",
      "priority": "high"
    },
    {
      "id": "account-notify",
      "icon": "Languages",
      "title": "账号与通知闭环",
      "description": "账号安全、自建邮件、防刷预算和持久通知中心进入后续主线。",
      "status": "planned",
      "priority": "high"
    }
  ]',
  label = COALESCE(label, '首页路线图'),
  category = COALESCE(category, 'home'),
  updated_at = now()
WHERE key = 'home_roadmap_items';

INSERT INTO public.site_config (key, value, label, category, updated_at)
SELECT
  'home_roadmap_items',
  '[
    {
      "id": "public-cache",
      "icon": "Globe",
      "title": "公共数据缓存",
      "description": "首屏公共数据已统一走同源 API，并支持公共缓存版本刷新。",
      "status": "completed",
      "priority": "high"
    },
    {
      "id": "ops-automation",
      "icon": "RefreshCw",
      "title": "运营自动化二期",
      "description": "自动化任务已具备 job graph、partial 状态、重跑和审计详情。",
      "status": "completed",
      "priority": "high"
    },
    {
      "id": "admin-data",
      "icon": "Database",
      "title": "卡池角色管理",
      "description": "卡池、角色与武器管理已完成重写，支持更安全的编辑流程。",
      "status": "completed",
      "priority": "high"
    },
    {
      "id": "performance-docs",
      "icon": "Rocket",
      "title": "项目瘦身与文档",
      "description": "README、架构文档、截图与入口拆包已完成本轮整理。",
      "status": "completed",
      "priority": "medium"
    },
    {
      "id": "heirlooms-preview",
      "icon": "Map",
      "title": "寻遗散记前瞻",
      "description": "首页版本前瞻内容正在同步真实更新摘要与后续版本信息。",
      "status": "in_progress",
      "priority": "high"
    },
    {
      "id": "official-id-backfill",
      "icon": "Shield",
      "title": "官方 ID 回填",
      "description": "后续将收口手动主键、官方 ID、别名和历史导出的兼容迁移。",
      "status": "planned",
      "priority": "high"
    },
    {
      "id": "public-api-metrics",
      "icon": "Calculator",
      "title": "公共 API 指标",
      "description": "卡池分析将补齐预聚合指标、趋势点、分布桶和口径说明。",
      "status": "planned",
      "priority": "high"
    },
    {
      "id": "account-notify",
      "icon": "Languages",
      "title": "账号与通知闭环",
      "description": "账号安全、自建邮件、防刷预算和持久通知中心进入后续主线。",
      "status": "planned",
      "priority": "high"
    }
  ]',
  '首页路线图',
  'home',
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.site_config WHERE key = 'home_roadmap_items'
);

UPDATE public.site_config
SET value = jsonb_build_object(
  'version', ((extract(epoch from now()) * 1000)::bigint)::text,
  'scope', 'site-config',
  'reason', 'migration:113_update_home_roadmap_items',
  'updatedAt', now()
)::text,
updated_at = now()
WHERE key = 'public_cache_epoch';
-- <<< END MIGRATION: active/113_update_home_roadmap_items.sql

-- >>> BEGIN MIGRATION: active/114_add_public_pool_analytics_cache.sql
-- 114: add public per-pool analytics cache for developer API v1.
--
-- The public API must not compute target/off-rate, average pity, or pity
-- distribution buckets by scanning raw history during request handling. This
-- cache is refreshed by controlled admin/ops jobs and read by same-origin API
-- handlers. The table stores anonymous aggregate data only.

CREATE TABLE IF NOT EXISTS public.public_pool_analytics_cache (
  pool_id TEXT PRIMARY KEY,
  pool_type TEXT NOT NULL CHECK (pool_type IN ('extra', 'limited', 'standard', 'weapon', 'beginner')),
  total_pulls BIGINT NOT NULL DEFAULT 0,
  total_pulls_with_free BIGINT NOT NULL DEFAULT 0,
  free_pull_count BIGINT NOT NULL DEFAULT 0,
  rarity_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_six_star BIGINT NOT NULL DEFAULT 0,
  offrate_six_star BIGINT NOT NULL DEFAULT 0,
  avg_pity_six_star NUMERIC(10, 2),
  avg_pity_five_star NUMERIC(10, 2),
  avg_pity_target_six_star NUMERIC(10, 2),
  distribution JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_pull_at TIMESTAMPTZ,
  last_pull_at TIMESTAMPTZ,
  source_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_pool_analytics_cache_type
  ON public.public_pool_analytics_cache(pool_type);

CREATE INDEX IF NOT EXISTS idx_public_pool_analytics_cache_last_pull
  ON public.public_pool_analytics_cache(last_pull_at DESC NULLS LAST);

ALTER TABLE public.public_pool_analytics_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_pool_analytics_cache_select_policy
  ON public.public_pool_analytics_cache;

CREATE POLICY public_pool_analytics_cache_select_policy
  ON public.public_pool_analytics_cache
  FOR SELECT
  USING (true);

GRANT SELECT ON public.public_pool_analytics_cache TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_public_pool_analytics_cache()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_refreshed_count INTEGER := 0;
BEGIN
  TRUNCATE public.public_pool_analytics_cache;

  WITH history_base AS MATERIALIZED (
    SELECT
      h.pool_id,
      h.user_id,
      h.record_id,
      h.seq_id,
      h.rarity,
      h.special_type,
      h.is_free,
      h.is_standard,
      h.character_name,
      h.item_name,
      h.timestamp,
      h.updated_at,
      p.type AS raw_pool_type,
      p.up_character
    FROM public.history AS h
    LEFT JOIN public.pools AS p
      ON p.pool_id = h.pool_id
    WHERE h.pool_id IS NOT NULL
  ),
  history_enriched AS MATERIALIZED (
    SELECT
      hb.*,
      CASE
        WHEN hb.raw_pool_type = 'extra' OR hb.pool_id LIKE 'joint_%' OR hb.pool_id LIKE 'extra_%' THEN 'extra'
        WHEN hb.raw_pool_type IN ('limited', 'limited_character') OR hb.pool_id LIKE 'special_%' THEN 'limited'
        WHEN hb.raw_pool_type IN ('weapon', 'limited_weapon') OR hb.pool_id LIKE 'weapon%' OR hb.pool_id LIKE 'wepon%' THEN 'weapon'
        WHEN hb.raw_pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN 'standard'
        WHEN COALESCE(hb.is_standard, false) THEN 'standard'
        ELSE 'limited'
      END AS pool_type,
      CASE
        WHEN hb.raw_pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN true
        WHEN hb.rarity = 6 AND (hb.raw_pool_type = 'extra' OR hb.pool_id LIKE 'joint_%' OR hb.pool_id LIKE 'extra_%') THEN false
        WHEN hb.rarity = 6
          AND hb.up_character IS NOT NULL
          AND hb.up_character <> ''
          AND lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) <> ''
        THEN NOT (
          lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) LIKE '%' || lower(trim(hb.up_character)) || '%'
          OR lower(trim(hb.up_character)) LIKE '%' || lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) || '%'
        )
        ELSE COALESCE(hb.is_standard, false)
      END AS is_standard_calc,
      CASE
        WHEN hb.rarity <> 6 THEN false
        WHEN hb.raw_pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN false
        WHEN hb.raw_pool_type = 'extra' OR hb.pool_id LIKE 'joint_%' OR hb.pool_id LIKE 'extra_%' THEN true
        WHEN hb.up_character IS NOT NULL
          AND hb.up_character <> ''
          AND lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) <> ''
        THEN (
          lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) LIKE '%' || lower(trim(hb.up_character)) || '%'
          OR lower(trim(hb.up_character)) LIKE '%' || lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) || '%'
        )
        ELSE COALESCE(hb.is_standard, false) IS NOT TRUE
      END AS is_target_calc
    FROM history_base AS hb
  ),
  visible_history AS MATERIALIZED (
    SELECT *
    FROM history_enriched
    WHERE special_type IS DISTINCT FROM 'gift'
  ),
  paid_history AS MATERIALIZED (
    SELECT *
    FROM visible_history
    WHERE is_free IS NOT TRUE
  ),
  numbered_paid_history AS MATERIALIZED (
    SELECT
      *,
      ROW_NUMBER() OVER (
        PARTITION BY pool_id, user_id
        ORDER BY timestamp NULLS LAST, COALESCE(seq_id, record_id), record_id
      ) AS rn
    FROM paid_history
  ),
  six_star_pity AS MATERIALIZED (
    SELECT
      pool_id,
      user_id,
      pool_type,
      is_standard_calc,
      is_target_calc,
      LEAST(
        rn - COALESCE(LAG(rn) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0),
        80
      ) AS pity
    FROM numbered_paid_history
    WHERE rarity = 6
  ),
  five_star_pity AS MATERIALIZED (
    SELECT
      pool_id,
      user_id,
      LEAST(
        rn - COALESCE(LAG(rn) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0),
        10
      ) AS pity
    FROM numbered_paid_history
    WHERE rarity = 5
  ),
  pity_ranges AS MATERIALIZED (
    SELECT
      pool_id,
      is_standard_calc,
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END AS range_label
    FROM six_star_pity
  ),
  distribution_rows AS MATERIALIZED (
    SELECT
      pool_id,
      range_label,
      COUNT(*) FILTER (WHERE is_standard_calc = false) AS limited_count,
      COUNT(*) FILTER (WHERE is_standard_calc = true) AS standard_count
    FROM pity_ranges
    GROUP BY pool_id, range_label
  ),
  pool_distributions AS MATERIALIZED (
    SELECT
      pool_id,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'range', REPLACE(range_label, '01-10', '1-10'),
            'limited', limited_count,
            'standard', standard_count
          )
          ORDER BY range_label
        ),
        '[]'::jsonb
      ) AS distribution
    FROM distribution_rows
    GROUP BY pool_id
  ),
  pool_counts AS MATERIALIZED (
    SELECT
      pool_id,
      MAX(pool_type) AS pool_type,
      COUNT(*) AS total_pulls,
      COUNT(*) FILTER (WHERE rarity <= 4) AS four_star,
      COUNT(*) FILTER (WHERE rarity = 5) AS five_star,
      COUNT(*) FILTER (WHERE rarity = 6) AS six_star,
      COUNT(*) FILTER (WHERE rarity = 6 AND is_target_calc = true) AS target_six_star,
      COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = true) AS offrate_six_star,
      MIN(timestamp) AS first_pull_at,
      MAX(timestamp) AS last_pull_at,
      MAX(updated_at) AS latest_history_update
    FROM paid_history
    GROUP BY pool_id
  ),
  pool_free_counts AS MATERIALIZED (
    SELECT
      pool_id,
      COUNT(*) AS total_pulls_with_free,
      COUNT(*) FILTER (WHERE is_free = true) AS free_pull_count
    FROM visible_history
    GROUP BY pool_id
  ),
  six_star_avg AS MATERIALIZED (
    SELECT
      pool_id,
      ROUND(AVG(pity)::numeric, 2) AS avg_pity_six_star
    FROM six_star_pity
    GROUP BY pool_id
  ),
  five_star_avg AS MATERIALIZED (
    SELECT
      pool_id,
      ROUND(AVG(pity)::numeric, 2) AS avg_pity_five_star
    FROM five_star_pity
    GROUP BY pool_id
  )
  INSERT INTO public.public_pool_analytics_cache (
    pool_id,
    pool_type,
    total_pulls,
    total_pulls_with_free,
    free_pull_count,
    rarity_counts,
    target_six_star,
    offrate_six_star,
    avg_pity_six_star,
    avg_pity_five_star,
    avg_pity_target_six_star,
    distribution,
    first_pull_at,
    last_pull_at,
    source_version,
    updated_at
  )
  SELECT
    pc.pool_id,
    pc.pool_type,
    pc.total_pulls,
    COALESCE(pfc.total_pulls_with_free, pc.total_pulls),
    COALESCE(pfc.free_pull_count, 0),
    jsonb_build_object(
      '4', COALESCE(pc.four_star, 0),
      '5', COALESCE(pc.five_star, 0),
      '6', COALESCE(pc.six_star, 0)
    ),
    COALESCE(pc.target_six_star, 0),
    COALESCE(pc.offrate_six_star, 0),
    ssa.avg_pity_six_star,
    fsa.avg_pity_five_star,
    CASE
      WHEN COALESCE(pc.target_six_star, 0) > 0
      THEN ROUND((pc.total_pulls::numeric / NULLIF(pc.target_six_star, 0)), 2)
      ELSE NULL
    END AS avg_pity_target_six_star,
    COALESCE(pd.distribution, '[]'::jsonb),
    pc.first_pull_at,
    pc.last_pull_at,
    md5(CONCAT_WS(':', pc.pool_id, pc.total_pulls::text, COALESCE(pc.latest_history_update::text, ''))),
    NOW()
  FROM pool_counts AS pc
  LEFT JOIN pool_free_counts AS pfc
    ON pfc.pool_id = pc.pool_id
  LEFT JOIN six_star_avg AS ssa
    ON ssa.pool_id = pc.pool_id
  LEFT JOIN five_star_avg AS fsa
    ON fsa.pool_id = pc.pool_id
  LEFT JOIN pool_distributions AS pd
    ON pd.pool_id = pc.pool_id;

  GET DIAGNOSTICS v_refreshed_count = ROW_COUNT;

  UPDATE public.site_config
  SET value = jsonb_build_object(
    'version', ((extract(epoch from now()) * 1000)::bigint)::text,
    'scope', 'stats',
    'reason', 'refresh_public_pool_analytics_cache',
    'updatedAt', now()
  )::text,
  updated_at = now()
  WHERE key = 'public_cache_epoch';

  RETURN jsonb_build_object(
    'success', true,
    'refreshedPools', v_refreshed_count,
    'updatedAt', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_public_pool_analytics_cache() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.refresh_public_pool_analytics_cache() TO service_role;
  END IF;
END $$;

COMMENT ON TABLE public.public_pool_analytics_cache IS
  'Anonymous public per-pool analytics cache for API v1. Does not contain user ids, game uid, or raw history ids.';

COMMENT ON FUNCTION public.refresh_public_pool_analytics_cache() IS
  'Refreshes anonymous public per-pool analytics cache from history. Intended for admin/ops/server-side jobs only.';
-- <<< END MIGRATION: active/114_add_public_pool_analytics_cache.sql

-- >>> BEGIN MIGRATION: active/115_add_change_password_rate_limit.sql
-- 115: add explicit account password-change rate-limit bucket.
--
-- Settings-page password changes now require current-password reauthentication.
-- Keep that reauthentication path behind a dedicated server-side rate-limit
-- bucket so brute-force attempts against a signed-in session cannot run
-- without budget controls.

INSERT INTO public.rate_limit_config (action, max_attempts, window_minutes, lockout_minutes)
VALUES
  ('change_password', 5, 15, 30)
ON CONFLICT (action) DO UPDATE SET
  max_attempts = EXCLUDED.max_attempts,
  window_minutes = EXCLUDED.window_minutes,
  lockout_minutes = EXCLUDED.lockout_minutes;
-- <<< END MIGRATION: active/115_add_change_password_rate_limit.sql

-- >>> BEGIN MIGRATION: active/116_add_mail_outbox_and_abuse_controls.sql
-- 116: add provider-independent mail outbox and anti-abuse controls.
--
-- This migration does not connect to SMTP, Postal, Stalwart, or any other
-- provider. It only creates the private database surface needed for future
-- server-side mail enqueue, budget accounting, suppression, and delivery
-- diagnostics. Browser clients must not write these tables directly.

CREATE TABLE IF NOT EXISTS public.mail_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'register_confirmation',
      'password_reset',
      'ticket_reply',
      'developer_api_review',
      'admin_alert'
    )
  ),
  recipient_email_hash TEXT NOT NULL,
  recipient_domain TEXT NOT NULL,
  template_key TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'zh-CN',
  payload_redacted_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL UNIQUE,
  priority SMALLINT NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 9),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'sending', 'sent', 'failed', 'suppressed', 'cancelled')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error_code TEXT,
  last_error_redacted_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_key TEXT,
  provider_message_id_hash TEXT,
  guard_decision JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID,
  related_entity_type TEXT,
  related_entity_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_outbox_status_next_attempt
  ON public.mail_outbox(status, next_attempt_at, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_mail_outbox_event_created
  ON public.mail_outbox(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mail_outbox_recipient_domain
  ON public.mail_outbox(recipient_domain, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mail_outbox_related_entity
  ON public.mail_outbox(related_entity_type, related_entity_id)
  WHERE related_entity_type IS NOT NULL OR related_entity_id IS NOT NULL;

ALTER TABLE public.mail_outbox ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.mail_suppression (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email_hash TEXT,
  recipient_domain TEXT,
  reason TEXT NOT NULL CHECK (
    reason IN ('hard_bounce', 'complaint', 'invalid_recipient', 'manual', 'domain_pause', 'abuse_budget')
  ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  source TEXT NOT NULL DEFAULT 'system',
  notes_redacted_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (recipient_email_hash IS NOT NULL OR recipient_domain IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_suppression_active_email
  ON public.mail_suppression(recipient_email_hash)
  WHERE status = 'active' AND recipient_email_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_suppression_active_domain
  ON public.mail_suppression(recipient_domain)
  WHERE status = 'active' AND recipient_domain IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mail_suppression_status_domain
  ON public.mail_suppression(status, recipient_domain);

ALTER TABLE public.mail_suppression ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.mail_abuse_budget_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('global', 'event', 'recipient', 'domain', 'ip', 'user', 'related')),
  event_type TEXT NOT NULL DEFAULT '*' CHECK (
    event_type IN (
      '*',
      'register_confirmation',
      'password_reset',
      'ticket_reply',
      'developer_api_review',
      'admin_alert'
    )
  ),
  window_seconds INTEGER NOT NULL CHECK (window_seconds > 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scope, event_type)
);

ALTER TABLE public.mail_abuse_budget_config ENABLE ROW LEVEL SECURITY;

INSERT INTO public.mail_abuse_budget_config (scope, event_type, window_seconds, max_attempts)
VALUES
  ('global', '*', 86400, 500),
  ('event', 'register_confirmation', 86400, 120),
  ('event', 'password_reset', 86400, 100),
  ('event', 'ticket_reply', 86400, 200),
  ('event', 'developer_api_review', 86400, 50),
  ('event', 'admin_alert', 86400, 50),
  ('recipient', 'register_confirmation', 3600, 2),
  ('recipient', 'password_reset', 3600, 3),
  ('recipient', 'ticket_reply', 3600, 10),
  ('recipient', 'developer_api_review', 3600, 5),
  ('recipient', 'admin_alert', 3600, 10),
  ('domain', 'register_confirmation', 86400, 40),
  ('domain', 'password_reset', 86400, 30),
  ('domain', 'ticket_reply', 86400, 80),
  ('domain', 'developer_api_review', 86400, 20),
  ('domain', 'admin_alert', 86400, 20),
  ('ip', 'register_confirmation', 3600, 5),
  ('ip', 'password_reset', 3600, 5),
  ('ip', 'ticket_reply', 3600, 20),
  ('ip', 'developer_api_review', 3600, 10),
  ('ip', 'admin_alert', 3600, 20),
  ('user', 'register_confirmation', 3600, 4),
  ('user', 'password_reset', 3600, 3),
  ('user', 'ticket_reply', 3600, 12),
  ('user', 'developer_api_review', 3600, 6),
  ('user', 'admin_alert', 3600, 20),
  ('related', 'ticket_reply', 3600, 10),
  ('related', 'admin_alert', 3600, 6)
ON CONFLICT (scope, event_type) DO UPDATE SET
  window_seconds = EXCLUDED.window_seconds,
  max_attempts = EXCLUDED.max_attempts,
  enabled = EXCLUDED.enabled,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS public.mail_abuse_budget_counters (
  bucket_key_hash TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  event_type TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  window_reset_at TIMESTAMPTZ NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  last_idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_abuse_budget_counters_reset
  ON public.mail_abuse_budget_counters(window_reset_at);

ALTER TABLE public.mail_abuse_budget_counters ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.mail_delivery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id UUID REFERENCES public.mail_outbox(id) ON DELETE CASCADE,
  provider_key TEXT,
  provider_message_id_hash TEXT,
  event_type TEXT NOT NULL,
  event_payload_redacted_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_delivery_events_outbox
  ON public.mail_delivery_events(outbox_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mail_delivery_events_type_created
  ON public.mail_delivery_events(event_type, created_at DESC);

ALTER TABLE public.mail_delivery_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mail_outbox FROM anon, authenticated;
REVOKE ALL ON public.mail_suppression FROM anon, authenticated;
REVOKE ALL ON public.mail_abuse_budget_config FROM anon, authenticated;
REVOKE ALL ON public.mail_abuse_budget_counters FROM anon, authenticated;
REVOKE ALL ON public.mail_delivery_events FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.mail_outbox TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.mail_suppression TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.mail_abuse_budget_config TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.mail_abuse_budget_counters TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.mail_delivery_events TO service_role;
  END IF;
END $$;

COMMENT ON TABLE public.mail_outbox IS
  'Private provider-independent transactional mail queue. Stores recipient hashes and redacted payloads only; no raw email, token, password, API key, user_id, game_uid, or raw history id should be stored here.';

COMMENT ON TABLE public.mail_suppression IS
  'Private mail suppression list for hard bounces, complaints, invalid recipients, manual domain pauses, and abuse-budget blocks. Uses hashes or domains; no raw recipient email.';

COMMENT ON TABLE public.mail_abuse_budget_config IS
  'Private configurable mail sending budgets by scope and event type. Service/admin paths may read this before queueing mail.';

COMMENT ON TABLE public.mail_abuse_budget_counters IS
  'Private hashed budget bucket counters used by server-side mail enqueue logic. Bucket keys are HMAC hashes, not raw IP, user id, or email.';

COMMENT ON TABLE public.mail_delivery_events IS
  'Private redacted mail provider delivery diagnostics associated with outbox rows.';
-- <<< END MIGRATION: active/116_add_mail_outbox_and_abuse_controls.sql

-- >>> BEGIN MIGRATION: active/117_add_account_recovery_state_metadata.sql
-- 117: add provider-independent account recovery state metadata.
--
-- AUTH-003 first slice:
-- - keep signed-out recovery responses generic;
-- - record manual fallback / future mail-outbox state on recovery requests;
-- - persist temporary-password expiry and force-change metadata;
-- - expose private password-change-required state for Settings UI.

ALTER TABLE public.account_recovery_requests
  ADD COLUMN IF NOT EXISTS delivery_channel TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS next_step TEXT NOT NULL DEFAULT 'manual_review_pending',
  ADD COLUMN IF NOT EXISTS mail_outbox_id UUID REFERENCES public.mail_outbox(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS temporary_password_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS temporary_password_force_change BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS temporary_password_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS temporary_password_set_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recovery_audit JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'account_recovery_requests_delivery_channel_check'
      AND conrelid = 'public.account_recovery_requests'::regclass
  ) THEN
    ALTER TABLE public.account_recovery_requests
      ADD CONSTRAINT account_recovery_requests_delivery_channel_check
      CHECK (delivery_channel IN ('manual', 'mail_outbox', 'disabled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'account_recovery_requests_next_step_check'
      AND conrelid = 'public.account_recovery_requests'::regclass
  ) THEN
    ALTER TABLE public.account_recovery_requests
      ADD CONSTRAINT account_recovery_requests_next_step_check
      CHECK (next_step IN (
        'manual_review_pending',
        'temporary_password_issued_force_change',
        'mail_reset_queued',
        'mail_reset_sent',
        'mail_reset_failed'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_account_recovery_requests_next_step
  ON public.account_recovery_requests(next_step, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_recovery_requests_temp_password_expires
  ON public.account_recovery_requests(temporary_password_expires_at)
  WHERE temporary_password_force_change IS TRUE;

CREATE TABLE IF NOT EXISTS public.account_security_states (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  password_change_required BOOLEAN NOT NULL DEFAULT FALSE,
  password_change_reason TEXT,
  password_change_source TEXT,
  password_change_requested_at TIMESTAMPTZ,
  password_change_expires_at TIMESTAMPTZ,
  password_change_recovery_request_id UUID REFERENCES public.account_recovery_requests(id) ON DELETE SET NULL,
  password_change_set_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_security_states_required
  ON public.account_security_states(password_change_required, password_change_expires_at)
  WHERE password_change_required IS TRUE;

ALTER TABLE public.account_security_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own account security state" ON public.account_security_states;
CREATE POLICY "Users can view own account security state"
  ON public.account_security_states FOR SELECT
  USING (auth.uid() = user_id);

GRANT SELECT ON public.account_security_states TO authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_security_states TO service_role;
  END IF;
END $$;

DROP TRIGGER IF EXISTS update_account_security_states_updated_at ON public.account_security_states;
CREATE TRIGGER update_account_security_states_updated_at
  BEFORE UPDATE ON public.account_security_states
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON COLUMN public.account_recovery_requests.delivery_channel IS
  'Provider-independent recovery delivery path: manual, mail_outbox, or disabled. No raw temporary password is stored.';

COMMENT ON COLUMN public.account_recovery_requests.next_step IS
  'Current applicant-facing next step, kept generic for signed-out users and detailed for super-admin review.';

COMMENT ON COLUMN public.account_recovery_requests.mail_outbox_id IS
  'Future mail_outbox link for self-service reset delivery. Nullable while provider decisions are pending.';

COMMENT ON COLUMN public.account_recovery_requests.recovery_audit IS
  'Redacted structured recovery events. Must not contain plaintext passwords, tokens, raw emails, game_uid, user_id for public output, or secrets.';

COMMENT ON TABLE public.account_security_states IS
  'Private per-user account security state. Unlike profiles, this table is not public-readable.';

COMMENT ON COLUMN public.account_security_states.password_change_required IS
  'True when the user signed in with a temporary/admin-issued password and must change it from Settings.';

COMMENT ON COLUMN public.account_security_states.password_change_recovery_request_id IS
  'Account recovery request that caused the current force-change state, if any.';
-- <<< END MIGRATION: active/117_add_account_recovery_state_metadata.sql

-- >>> BEGIN MIGRATION: active/118_add_public_pool_trend_cache.sql
-- 118: add public trend cache for developer API v1.
--
-- Public trend endpoints must not aggregate raw history during request
-- handling. This table stores anonymous aggregate-only buckets refreshed by
-- controlled admin/ops jobs.

CREATE TABLE IF NOT EXISTS public.public_pool_trend_cache (
  metric TEXT NOT NULL CHECK (metric IN ('pulls', 'six_star', 'five_star')),
  granularity TEXT NOT NULL CHECK (granularity IN ('day', 'week')),
  period_start DATE NOT NULL,
  pool_type TEXT NOT NULL DEFAULT 'all' CHECK (pool_type IN ('all', 'extra', 'limited', 'standard', 'weapon')),
  pool_id TEXT NOT NULL DEFAULT 'all',
  value BIGINT NOT NULL DEFAULT 0,
  source_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (metric, granularity, period_start, pool_type, pool_id)
);

CREATE INDEX IF NOT EXISTS idx_public_pool_trend_cache_scope
  ON public.public_pool_trend_cache(metric, granularity, pool_type, pool_id, period_start DESC);

ALTER TABLE public.public_pool_trend_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_pool_trend_cache_select_policy
  ON public.public_pool_trend_cache;

CREATE POLICY public_pool_trend_cache_select_policy
  ON public.public_pool_trend_cache
  FOR SELECT
  USING (true);

GRANT SELECT ON public.public_pool_trend_cache TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_public_pool_trend_cache()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_refreshed_count INTEGER := 0;
  v_updated_at TIMESTAMPTZ := NOW();
BEGIN
  TRUNCATE public.public_pool_trend_cache;

  WITH paid_history AS MATERIALIZED (
    SELECT
      h.pool_id,
      h.rarity,
      h.timestamp,
      h.updated_at,
      CASE
        WHEN p.type = 'extra' OR h.pool_id LIKE 'joint_%' OR h.pool_id LIKE 'extra_%' THEN 'extra'
        WHEN p.type IN ('limited', 'limited_character') OR h.pool_id LIKE 'special_%' THEN 'limited'
        WHEN p.type IN ('weapon', 'limited_weapon') OR h.pool_id LIKE 'weapon%' OR h.pool_id LIKE 'wepon%' THEN 'weapon'
        WHEN p.type IN ('standard', 'beginner') OR h.pool_id IN ('standard', 'beginner') THEN 'standard'
        WHEN COALESCE(h.is_standard, false) THEN 'standard'
        ELSE 'limited'
      END AS pool_type
    FROM public.history AS h
    LEFT JOIN public.pools AS p
      ON p.pool_id = h.pool_id
    WHERE h.pool_id IS NOT NULL
      AND h.timestamp IS NOT NULL
      AND h.special_type IS DISTINCT FROM 'gift'
      AND h.is_free IS NOT TRUE
  ),
  bucketed AS MATERIALIZED (
    SELECT
      'day'::TEXT AS granularity,
      date_trunc('day', timestamp)::DATE AS period_start,
      pool_type,
      pool_id,
      rarity,
      updated_at
    FROM paid_history
    UNION ALL
    SELECT
      'week'::TEXT AS granularity,
      date_trunc('week', timestamp)::DATE AS period_start,
      pool_type,
      pool_id,
      rarity,
      updated_at
    FROM paid_history
  ),
  scoped AS MATERIALIZED (
    SELECT
      granularity,
      period_start,
      'all'::TEXT AS scope_pool_type,
      'all'::TEXT AS scope_pool_id,
      rarity,
      updated_at
    FROM bucketed
    UNION ALL
    SELECT
      granularity,
      period_start,
      pool_type AS scope_pool_type,
      'all'::TEXT AS scope_pool_id,
      rarity,
      updated_at
    FROM bucketed
    UNION ALL
    SELECT
      granularity,
      period_start,
      pool_type AS scope_pool_type,
      pool_id AS scope_pool_id,
      rarity,
      updated_at
    FROM bucketed
  ),
  grouped AS MATERIALIZED (
    SELECT
      granularity,
      period_start,
      scope_pool_type,
      scope_pool_id,
      COUNT(*)::BIGINT AS pulls,
      COUNT(*) FILTER (WHERE rarity = 6)::BIGINT AS six_star,
      COUNT(*) FILTER (WHERE rarity = 5)::BIGINT AS five_star,
      MAX(updated_at) AS latest_history_update
    FROM scoped
    GROUP BY granularity, period_start, scope_pool_type, scope_pool_id
  ),
  metric_rows AS MATERIALIZED (
    SELECT
      'pulls'::TEXT AS metric,
      granularity,
      period_start,
      scope_pool_type AS pool_type,
      scope_pool_id AS pool_id,
      pulls AS value,
      latest_history_update
    FROM grouped
    UNION ALL
    SELECT
      'six_star'::TEXT AS metric,
      granularity,
      period_start,
      scope_pool_type AS pool_type,
      scope_pool_id AS pool_id,
      six_star AS value,
      latest_history_update
    FROM grouped
    UNION ALL
    SELECT
      'five_star'::TEXT AS metric,
      granularity,
      period_start,
      scope_pool_type AS pool_type,
      scope_pool_id AS pool_id,
      five_star AS value,
      latest_history_update
    FROM grouped
  )
  INSERT INTO public.public_pool_trend_cache (
    metric,
    granularity,
    period_start,
    pool_type,
    pool_id,
    value,
    source_version,
    updated_at
  )
  SELECT
    metric,
    granularity,
    period_start,
    pool_type,
    pool_id,
    value,
    md5(CONCAT_WS(
      ':',
      metric,
      granularity,
      period_start::TEXT,
      pool_type,
      pool_id,
      value::TEXT,
      COALESCE(latest_history_update::TEXT, '')
    )),
    v_updated_at
  FROM metric_rows;

  GET DIAGNOSTICS v_refreshed_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'refreshedTrendRows', v_refreshed_count,
    'updatedAt', v_updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_public_analytics_cache()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pool_result JSONB := '{}'::jsonb;
  v_trend_result JSONB := '{}'::jsonb;
  v_updated_at TIMESTAMPTZ := NOW();
  v_version TEXT := ((extract(epoch from v_updated_at) * 1000)::bigint)::text;
BEGIN
  v_pool_result := public.refresh_public_pool_analytics_cache();
  v_trend_result := public.refresh_public_pool_trend_cache();

  UPDATE public.site_config
  SET value = jsonb_build_object(
    'version', v_version,
    'scope', 'stats',
    'reason', 'refresh_public_analytics_cache',
    'updatedAt', v_updated_at
  )::text,
  updated_at = v_updated_at
  WHERE key = 'public_cache_epoch';

  RETURN jsonb_build_object(
    'success', true,
    'pool', v_pool_result,
    'trends', v_trend_result,
    'refreshedPools', COALESCE((v_pool_result->>'refreshedPools')::INTEGER, 0),
    'refreshedTrendRows', COALESCE((v_trend_result->>'refreshedTrendRows')::INTEGER, 0),
    'cacheVersion', v_version,
    'updatedAt', v_updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_public_pool_trend_cache() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_public_analytics_cache() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.refresh_public_pool_trend_cache() TO service_role;
    GRANT EXECUTE ON FUNCTION public.refresh_public_analytics_cache() TO service_role;
  END IF;
END $$;

COMMENT ON TABLE public.public_pool_trend_cache IS
  'Anonymous public trend cache for API v1. Stores aggregate buckets only and does not contain user ids, game uid, or raw history ids.';

COMMENT ON FUNCTION public.refresh_public_pool_trend_cache() IS
  'Refreshes anonymous public trend cache from history. Intended for admin/ops/server-side jobs only.';

COMMENT ON FUNCTION public.refresh_public_analytics_cache() IS
  'Refreshes public per-pool analytics and trend caches, then updates the public cache epoch.';
-- <<< END MIGRATION: active/118_add_public_pool_trend_cache.sql

-- >>> BEGIN MIGRATION: active/119_add_auth_security_events.sql
-- 119: add private auth security audit events.
--
-- AUTH-002 finish:
-- - record server-side risk buckets for login/register/recovery preflight;
-- - keep CAPTCHA verification summaries without raw tokens;
-- - store only hashed requester/email identifiers and redacted metadata.

CREATE TABLE IF NOT EXISTS public.auth_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL,
  risk_bucket TEXT NOT NULL DEFAULT 'unknown',
  risk_reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  requester_hash TEXT NOT NULL,
  requester_origin_hash TEXT,
  requester_user_agent_hash TEXT,
  email_hash TEXT,
  email_domain_hash TEXT,
  email_redacted TEXT,
  captcha JSONB NOT NULL DEFAULT '{}'::jsonb,
  rate_limit JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_security_events_action_created
  ON public.auth_security_events(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_security_events_outcome_created
  ON public.auth_security_events(outcome, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_security_events_risk_created
  ON public.auth_security_events(risk_bucket, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_security_events_requester
  ON public.auth_security_events(requester_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_security_events_email
  ON public.auth_security_events(email_hash, created_at DESC)
  WHERE email_hash IS NOT NULL;

ALTER TABLE public.auth_security_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can view auth security events" ON public.auth_security_events;
CREATE POLICY "Super admins can view auth security events"
  ON public.auth_security_events FOR SELECT
  USING (public.is_super_admin());

REVOKE ALL ON public.auth_security_events FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, DELETE ON public.auth_security_events TO service_role;
  END IF;
END $$;

INSERT INTO public.rate_limit_config (action, max_attempts, window_minutes, lockout_minutes) VALUES
  ('account_recovery', 4, 60, 60)
ON CONFLICT (action) DO UPDATE SET
  max_attempts = EXCLUDED.max_attempts,
  window_minutes = EXCLUDED.window_minutes,
  lockout_minutes = EXCLUDED.lockout_minutes;

COMMENT ON TABLE public.auth_security_events IS
  'Private auth security audit log for server-side risk buckets. Stores hashed identifiers and redacted metadata only.';

COMMENT ON COLUMN public.auth_security_events.requester_hash IS
  'HMAC hash of requester IP; never store the raw IP address here.';

COMMENT ON COLUMN public.auth_security_events.email_hash IS
  'HMAC hash of normalized email. Raw email stays out of this audit table.';

COMMENT ON COLUMN public.auth_security_events.captcha IS
  'CAPTCHA verification summary. Must not contain raw CAPTCHA tokens or provider secrets.';

COMMENT ON COLUMN public.auth_security_events.metadata IS
  'Sanitized event metadata. Must not contain passwords, tokens, raw emails, game_uid, user_id, platform IDs, API keys, or raw history ids.';
-- <<< END MIGRATION: active/119_add_auth_security_events.sql

-- >>> BEGIN MIGRATION: active/120_add_mail_outbox_enqueue_rpc.sql
-- 120: add provider-independent mail outbox enqueue RPC.
--
-- MAIL-ABUSE-001 finish slice:
-- - keep enqueue server-only via service_role;
-- - atomically check hashed budget counters and insert a queued outbox row;
-- - return dedupe/block/queue metadata without exposing raw recipient data.

CREATE OR REPLACE FUNCTION public.enqueue_mail_outbox_event(
  p_event_type TEXT,
  p_recipient_email_hash TEXT,
  p_recipient_domain TEXT,
  p_template_key TEXT,
  p_idempotency_key TEXT,
  p_locale TEXT DEFAULT 'zh-CN',
  p_payload_redacted_json JSONB DEFAULT '{}'::jsonb,
  p_priority SMALLINT DEFAULT 5,
  p_guard_decision JSONB DEFAULT '{}'::jsonb,
  p_budget_buckets JSONB DEFAULT '[]'::jsonb,
  p_created_by_user_id UUID DEFAULT NULL,
  p_related_entity_type TEXT DEFAULT NULL,
  p_related_entity_id TEXT DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id UUID;
  v_inserted_id UUID;
  v_bucket JSONB;
  v_bucket_key TEXT;
  v_scope TEXT;
  v_bucket_event_type TEXT;
  v_window_reset_at TIMESTAMPTZ;
  v_max_attempts INTEGER;
  v_used_count INTEGER;
  v_block_result JSONB;
BEGIN
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RETURN jsonb_build_object(
      'action', 'block',
      'code', 'mail_missing_idempotency_key',
      'reason', 'Missing mail idempotency key.'
    );
  END IF;

  SELECT id INTO v_existing_id
  FROM public.mail_outbox
  WHERE idempotency_key = p_idempotency_key
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'action', 'dedupe',
      'code', 'mail_idempotency_hit',
      'outbox_id', v_existing_id,
      'idempotency_key', p_idempotency_key
    );
  END IF;

  IF jsonb_typeof(COALESCE(p_budget_buckets, '[]'::jsonb)) <> 'array' THEN
    RETURN jsonb_build_object(
      'action', 'block',
      'code', 'mail_invalid_budget_buckets',
      'reason', 'Budget buckets must be a JSON array.',
      'idempotency_key', p_idempotency_key
    );
  END IF;

  IF jsonb_array_length(COALESCE(p_budget_buckets, '[]'::jsonb)) = 0 THEN
    RETURN jsonb_build_object(
      'action', 'block',
      'code', 'mail_missing_budget_buckets',
      'reason', 'At least one budget bucket is required.',
      'idempotency_key', p_idempotency_key
    );
  END IF;

  FOR v_bucket IN SELECT value FROM jsonb_array_elements(COALESCE(p_budget_buckets, '[]'::jsonb))
  LOOP
    v_bucket_key := btrim(COALESCE(v_bucket ->> 'bucketKeyHash', v_bucket ->> 'bucket_key_hash', ''));
    v_scope := btrim(COALESCE(v_bucket ->> 'scope', 'unknown'));
    v_bucket_event_type := btrim(COALESCE(v_bucket ->> 'eventType', v_bucket ->> 'event_type', p_event_type));
    v_max_attempts := NULLIF(v_bucket ->> 'max', '')::INTEGER;
    v_window_reset_at := COALESCE(
      NULLIF(v_bucket ->> 'resetAt', '')::TIMESTAMPTZ,
      NULLIF(v_bucket ->> 'reset_at', '')::TIMESTAMPTZ,
      p_now + make_interval(secs => GREATEST(COALESCE(NULLIF(v_bucket ->> 'windowMs', '')::INTEGER, 3600000), 1000) / 1000)
    );

    IF v_bucket_key = '' OR v_max_attempts IS NULL OR v_max_attempts < 1 THEN
      RETURN jsonb_build_object(
        'action', 'block',
        'code', 'mail_invalid_budget_bucket',
        'reason', 'Budget bucket is missing a key or max.',
        'idempotency_key', p_idempotency_key
      );
    END IF;

    INSERT INTO public.mail_abuse_budget_counters (
      bucket_key_hash,
      scope,
      event_type,
      window_started_at,
      window_reset_at,
      used_count,
      last_idempotency_key,
      created_at,
      updated_at
    )
    VALUES (
      v_bucket_key,
      v_scope,
      v_bucket_event_type,
      p_now,
      v_window_reset_at,
      0,
      NULL,
      p_now,
      p_now
    )
    ON CONFLICT (bucket_key_hash) DO NOTHING;

    SELECT used_count INTO v_used_count
    FROM public.mail_abuse_budget_counters
    WHERE bucket_key_hash = v_bucket_key
    FOR UPDATE;

    IF COALESCE(v_used_count, 0) >= v_max_attempts THEN
      v_block_result := jsonb_build_object(
        'action', 'block',
        'code', 'mail_budget_exceeded:' || v_scope,
        'reason', 'Mail sending budget exceeded.',
        'idempotency_key', p_idempotency_key,
        'exceeded_bucket', jsonb_build_object(
          'scope', v_scope,
          'bucket_key_hash', v_bucket_key,
          'max', v_max_attempts,
          'used', COALESCE(v_used_count, 0),
          'reset_at', v_window_reset_at
        )
      );

      RETURN v_block_result;
    END IF;
  END LOOP;

  INSERT INTO public.mail_outbox (
    event_type,
    recipient_email_hash,
    recipient_domain,
    template_key,
    locale,
    payload_redacted_json,
    idempotency_key,
    priority,
    status,
    next_attempt_at,
    guard_decision,
    created_by_user_id,
    related_entity_type,
    related_entity_id,
    created_at,
    updated_at
  )
  VALUES (
    p_event_type,
    p_recipient_email_hash,
    p_recipient_domain,
    p_template_key,
    COALESCE(NULLIF(btrim(p_locale), ''), 'zh-CN'),
    COALESCE(p_payload_redacted_json, '{}'::jsonb),
    p_idempotency_key,
    LEAST(9, GREATEST(1, COALESCE(p_priority, 5))),
    'queued',
    p_now,
    COALESCE(p_guard_decision, '{}'::jsonb),
    p_created_by_user_id,
    NULLIF(btrim(COALESCE(p_related_entity_type, '')), ''),
    NULLIF(btrim(COALESCE(p_related_entity_id, '')), ''),
    p_now,
    p_now
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    SELECT id INTO v_existing_id
    FROM public.mail_outbox
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;

    RETURN jsonb_build_object(
      'action', 'dedupe',
      'code', 'mail_idempotency_hit',
      'outbox_id', v_existing_id,
      'idempotency_key', p_idempotency_key
    );
  END IF;

  FOR v_bucket IN SELECT value FROM jsonb_array_elements(COALESCE(p_budget_buckets, '[]'::jsonb))
  LOOP
    v_bucket_key := btrim(COALESCE(v_bucket ->> 'bucketKeyHash', v_bucket ->> 'bucket_key_hash', ''));

    IF v_bucket_key <> '' THEN
      UPDATE public.mail_abuse_budget_counters
      SET
        used_count = used_count + 1,
        last_idempotency_key = p_idempotency_key,
        updated_at = p_now
      WHERE bucket_key_hash = v_bucket_key;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'action', 'queue',
    'code', 'mail_outbox_queued',
    'outbox_id', v_inserted_id,
    'idempotency_key', p_idempotency_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_mail_outbox_event(
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  JSONB,
  SMALLINT,
  JSONB,
  JSONB,
  UUID,
  TEXT,
  TEXT,
  TIMESTAMPTZ
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.enqueue_mail_outbox_event(
      TEXT,
      TEXT,
      TEXT,
      TEXT,
      TEXT,
      TEXT,
      JSONB,
      SMALLINT,
      JSONB,
      JSONB,
      UUID,
      TEXT,
      TEXT,
      TIMESTAMPTZ
    ) TO service_role;
  END IF;
END $$;

COMMENT ON FUNCTION public.enqueue_mail_outbox_event(
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  JSONB,
  SMALLINT,
  JSONB,
  JSONB,
  UUID,
  TEXT,
  TEXT,
  TIMESTAMPTZ
) IS
  'Server-only mail enqueue RPC. Atomically checks hashed budget counters, inserts redacted mail_outbox rows, and returns queue/dedupe/block metadata. Does not send mail.';
-- <<< END MIGRATION: active/120_add_mail_outbox_enqueue_rpc.sql

-- >>> BEGIN MIGRATION: active/121_fix_public_pool_analytics_ordering.sql
-- 121: fix public pool analytics ordering for mixed seq_id / record_id types.
--
-- Production history.seq_id may be numeric while record_id is text. The
-- original refresh function mixed both columns without casts, which fails with
-- "COALESCE types text and double precision cannot be matched". Keep this as a
-- small forward migration that only replaces the refresh function.

CREATE OR REPLACE FUNCTION public.refresh_public_pool_analytics_cache()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_refreshed_count INTEGER := 0;
BEGIN
  TRUNCATE public.public_pool_analytics_cache;

  WITH history_base AS MATERIALIZED (
    SELECT
      h.pool_id,
      h.user_id,
      h.record_id,
      h.seq_id,
      h.rarity,
      h.special_type,
      h.is_free,
      h.is_standard,
      h.character_name,
      h.item_name,
      h.timestamp,
      h.updated_at,
      p.type AS raw_pool_type,
      p.up_character
    FROM public.history AS h
    LEFT JOIN public.pools AS p
      ON p.pool_id = h.pool_id
    WHERE h.pool_id IS NOT NULL
  ),
  history_enriched AS MATERIALIZED (
    SELECT
      hb.*,
      CASE
        WHEN hb.raw_pool_type = 'extra' OR hb.pool_id LIKE 'joint_%' OR hb.pool_id LIKE 'extra_%' THEN 'extra'
        WHEN hb.raw_pool_type IN ('limited', 'limited_character') OR hb.pool_id LIKE 'special_%' THEN 'limited'
        WHEN hb.raw_pool_type IN ('weapon', 'limited_weapon') OR hb.pool_id LIKE 'weapon%' OR hb.pool_id LIKE 'wepon%' THEN 'weapon'
        WHEN hb.raw_pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN 'standard'
        WHEN COALESCE(hb.is_standard, false) THEN 'standard'
        ELSE 'limited'
      END AS pool_type,
      CASE
        WHEN hb.raw_pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN true
        WHEN hb.rarity = 6 AND (hb.raw_pool_type = 'extra' OR hb.pool_id LIKE 'joint_%' OR hb.pool_id LIKE 'extra_%') THEN false
        WHEN hb.rarity = 6
          AND hb.up_character IS NOT NULL
          AND hb.up_character <> ''
          AND lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) <> ''
        THEN NOT (
          lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) LIKE '%' || lower(trim(hb.up_character)) || '%'
          OR lower(trim(hb.up_character)) LIKE '%' || lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) || '%'
        )
        ELSE COALESCE(hb.is_standard, false)
      END AS is_standard_calc,
      CASE
        WHEN hb.rarity <> 6 THEN false
        WHEN hb.raw_pool_type IN ('standard', 'beginner') OR hb.pool_id IN ('standard', 'beginner') THEN false
        WHEN hb.raw_pool_type = 'extra' OR hb.pool_id LIKE 'joint_%' OR hb.pool_id LIKE 'extra_%' THEN true
        WHEN hb.up_character IS NOT NULL
          AND hb.up_character <> ''
          AND lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) <> ''
        THEN (
          lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) LIKE '%' || lower(trim(hb.up_character)) || '%'
          OR lower(trim(hb.up_character)) LIKE '%' || lower(trim(COALESCE(NULLIF(hb.character_name, ''), NULLIF(hb.item_name, ''), ''))) || '%'
        )
        ELSE COALESCE(hb.is_standard, false) IS NOT TRUE
      END AS is_target_calc
    FROM history_base AS hb
  ),
  visible_history AS MATERIALIZED (
    SELECT *
    FROM history_enriched
    WHERE special_type IS DISTINCT FROM 'gift'
  ),
  paid_history AS MATERIALIZED (
    SELECT *
    FROM visible_history
    WHERE is_free IS NOT TRUE
  ),
  numbered_paid_history AS MATERIALIZED (
    SELECT
      *,
      ROW_NUMBER() OVER (
        PARTITION BY pool_id, user_id
        ORDER BY timestamp NULLS LAST, COALESCE(seq_id::TEXT, record_id::TEXT), record_id::TEXT
      ) AS rn
    FROM paid_history
  ),
  six_star_pity AS MATERIALIZED (
    SELECT
      pool_id,
      user_id,
      pool_type,
      is_standard_calc,
      is_target_calc,
      LEAST(
        rn - COALESCE(LAG(rn) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0),
        80
      ) AS pity
    FROM numbered_paid_history
    WHERE rarity = 6
  ),
  five_star_pity AS MATERIALIZED (
    SELECT
      pool_id,
      user_id,
      LEAST(
        rn - COALESCE(LAG(rn) OVER (PARTITION BY pool_id, user_id ORDER BY rn), 0),
        10
      ) AS pity
    FROM numbered_paid_history
    WHERE rarity = 5
  ),
  pity_ranges AS MATERIALIZED (
    SELECT
      pool_id,
      is_standard_calc,
      CASE
        WHEN pity BETWEEN 1 AND 10 THEN '01-10'
        WHEN pity BETWEEN 11 AND 20 THEN '11-20'
        WHEN pity BETWEEN 21 AND 30 THEN '21-30'
        WHEN pity BETWEEN 31 AND 40 THEN '31-40'
        WHEN pity BETWEEN 41 AND 50 THEN '41-50'
        WHEN pity BETWEEN 51 AND 60 THEN '51-60'
        WHEN pity BETWEEN 61 AND 70 THEN '61-70'
        WHEN pity BETWEEN 71 AND 80 THEN '71-80'
        WHEN pity BETWEEN 81 AND 90 THEN '81-90'
        ELSE '91+'
      END AS range_label
    FROM six_star_pity
  ),
  distribution_rows AS MATERIALIZED (
    SELECT
      pool_id,
      range_label,
      COUNT(*) FILTER (WHERE is_standard_calc = false) AS limited_count,
      COUNT(*) FILTER (WHERE is_standard_calc = true) AS standard_count
    FROM pity_ranges
    GROUP BY pool_id, range_label
  ),
  pool_distributions AS MATERIALIZED (
    SELECT
      pool_id,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'range', REPLACE(range_label, '01-10', '1-10'),
            'limited', limited_count,
            'standard', standard_count
          )
          ORDER BY range_label
        ),
        '[]'::jsonb
      ) AS distribution
    FROM distribution_rows
    GROUP BY pool_id
  ),
  pool_counts AS MATERIALIZED (
    SELECT
      pool_id,
      MAX(pool_type) AS pool_type,
      COUNT(*) AS total_pulls,
      COUNT(*) FILTER (WHERE rarity <= 4) AS four_star,
      COUNT(*) FILTER (WHERE rarity = 5) AS five_star,
      COUNT(*) FILTER (WHERE rarity = 6) AS six_star,
      COUNT(*) FILTER (WHERE rarity = 6 AND is_target_calc = true) AS target_six_star,
      COUNT(*) FILTER (WHERE rarity = 6 AND is_standard_calc = true) AS offrate_six_star,
      MIN(timestamp) AS first_pull_at,
      MAX(timestamp) AS last_pull_at,
      MAX(updated_at) AS latest_history_update
    FROM paid_history
    GROUP BY pool_id
  ),
  pool_free_counts AS MATERIALIZED (
    SELECT
      pool_id,
      COUNT(*) AS total_pulls_with_free,
      COUNT(*) FILTER (WHERE is_free = true) AS free_pull_count
    FROM visible_history
    GROUP BY pool_id
  ),
  six_star_avg AS MATERIALIZED (
    SELECT
      pool_id,
      ROUND(AVG(pity)::numeric, 2) AS avg_pity_six_star
    FROM six_star_pity
    GROUP BY pool_id
  ),
  five_star_avg AS MATERIALIZED (
    SELECT
      pool_id,
      ROUND(AVG(pity)::numeric, 2) AS avg_pity_five_star
    FROM five_star_pity
    GROUP BY pool_id
  )
  INSERT INTO public.public_pool_analytics_cache (
    pool_id,
    pool_type,
    total_pulls,
    total_pulls_with_free,
    free_pull_count,
    rarity_counts,
    target_six_star,
    offrate_six_star,
    avg_pity_six_star,
    avg_pity_five_star,
    avg_pity_target_six_star,
    distribution,
    first_pull_at,
    last_pull_at,
    source_version,
    updated_at
  )
  SELECT
    pc.pool_id,
    pc.pool_type,
    pc.total_pulls,
    COALESCE(pfc.total_pulls_with_free, pc.total_pulls),
    COALESCE(pfc.free_pull_count, 0),
    jsonb_build_object(
      '4', COALESCE(pc.four_star, 0),
      '5', COALESCE(pc.five_star, 0),
      '6', COALESCE(pc.six_star, 0)
    ),
    COALESCE(pc.target_six_star, 0),
    COALESCE(pc.offrate_six_star, 0),
    ssa.avg_pity_six_star,
    fsa.avg_pity_five_star,
    CASE
      WHEN COALESCE(pc.target_six_star, 0) > 0
      THEN ROUND((pc.total_pulls::numeric / NULLIF(pc.target_six_star, 0)), 2)
      ELSE NULL
    END AS avg_pity_target_six_star,
    COALESCE(pd.distribution, '[]'::jsonb),
    pc.first_pull_at,
    pc.last_pull_at,
    md5(CONCAT_WS(':', pc.pool_id, pc.total_pulls::text, COALESCE(pc.latest_history_update::text, ''))),
    NOW()
  FROM pool_counts AS pc
  LEFT JOIN pool_free_counts AS pfc
    ON pfc.pool_id = pc.pool_id
  LEFT JOIN six_star_avg AS ssa
    ON ssa.pool_id = pc.pool_id
  LEFT JOIN five_star_avg AS fsa
    ON fsa.pool_id = pc.pool_id
  LEFT JOIN pool_distributions AS pd
    ON pd.pool_id = pc.pool_id;

  GET DIAGNOSTICS v_refreshed_count = ROW_COUNT;

  UPDATE public.site_config
  SET value = jsonb_build_object(
    'version', ((extract(epoch from now()) * 1000)::bigint)::text,
    'scope', 'stats',
    'reason', 'refresh_public_pool_analytics_cache',
    'updatedAt', now()
  )::text,
  updated_at = now()
  WHERE key = 'public_cache_epoch';

  RETURN jsonb_build_object(
    'success', true,
    'refreshedPools', v_refreshed_count,
    'updatedAt', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_public_pool_analytics_cache() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.refresh_public_pool_analytics_cache() TO service_role;
  END IF;
END $$;

COMMENT ON FUNCTION public.refresh_public_pool_analytics_cache() IS
  'Refreshes anonymous public per-pool analytics cache from history. Intended for admin/ops/server-side jobs only.';
-- <<< END MIGRATION: active/121_fix_public_pool_analytics_ordering.sql

-- >>> BEGIN MIGRATION: active/122_fix_joint_pool_featured_character_refs.sql
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
-- <<< END MIGRATION: active/122_fix_joint_pool_featured_character_refs.sql

-- >>> BEGIN MIGRATION: active/123_add_email_login_mail_event_type.sql
-- 123: allow email-login transactional mail events.
--
-- AUTH-003 / MAIL-ABUSE-001 finish slice:
-- - keep mail_outbox provider-independent and service-role only;
-- - add email_login to the event_type allowlist used by the queue and budgets;
-- - seed the same low-volume anti-abuse budgets as password_reset.

ALTER TABLE public.mail_outbox
  DROP CONSTRAINT IF EXISTS mail_outbox_event_type_check;

ALTER TABLE public.mail_outbox
  ADD CONSTRAINT mail_outbox_event_type_check
  CHECK (
    event_type IN (
      'register_confirmation',
      'email_login',
      'password_reset',
      'ticket_reply',
      'developer_api_review',
      'admin_alert'
    )
  );

ALTER TABLE public.mail_abuse_budget_config
  DROP CONSTRAINT IF EXISTS mail_abuse_budget_config_event_type_check;

ALTER TABLE public.mail_abuse_budget_config
  ADD CONSTRAINT mail_abuse_budget_config_event_type_check
  CHECK (
    event_type IN (
      '*',
      'register_confirmation',
      'email_login',
      'password_reset',
      'ticket_reply',
      'developer_api_review',
      'admin_alert'
    )
  );

INSERT INTO public.mail_abuse_budget_config (scope, event_type, window_seconds, max_attempts)
VALUES
  ('event', 'email_login', 86400, 100),
  ('recipient', 'email_login', 3600, 3),
  ('domain', 'email_login', 86400, 30),
  ('ip', 'email_login', 3600, 5),
  ('user', 'email_login', 3600, 3)
ON CONFLICT (scope, event_type) DO UPDATE SET
  window_seconds = EXCLUDED.window_seconds,
  max_attempts = EXCLUDED.max_attempts,
  enabled = EXCLUDED.enabled,
  updated_at = NOW();

COMMENT ON CONSTRAINT mail_outbox_event_type_check ON public.mail_outbox IS
  'Allowed transactional mail event types, including passwordless email-login links.';

COMMENT ON CONSTRAINT mail_abuse_budget_config_event_type_check ON public.mail_abuse_budget_config IS
  'Allowed mail budget event types, including passwordless email-login links.';
-- <<< END MIGRATION: active/123_add_email_login_mail_event_type.sql

-- >>> BEGIN MIGRATION: active/124_seed_mail_runtime_config.sql
-- 124: seed runtime mail controls in site_config.
--
-- Runtime controls are lower gates only. They can pause or narrow mail flows
-- without redeploying, but they must not store SMTP credentials or bypass env
-- vars such as MAIL_OUTBOX_WORKER_ENABLED / MAIL_OUTBOX_GLOBAL_KILL_SWITCH.

INSERT INTO public.site_config (key, value, label, category, updated_at)
VALUES (
  'mail_runtime_config',
  jsonb_build_object(
    'version', 1,
    'updatedAt', now(),
    'updatedBy', null,
    'note', '',
    'events', jsonb_build_object(
      'authMailActions', null,
      'accountRecoveryOutbox', null,
      'developerApiReview', null,
      'ticketReply', null,
      'adminAlert', null
    ),
    'controls', jsonb_build_object(
      'killSwitch', null,
      'disabledEvents', jsonb_build_array(),
      'pausedDomains', jsonb_build_array()
    )
  )::text,
  '邮件运行期开关',
  'system',
  now()
)
ON CONFLICT (key) DO NOTHING;
-- <<< END MIGRATION: active/124_seed_mail_runtime_config.sql

-- >>> BEGIN MIGRATION: active/125_refresh_home_roadmap_after_mail_rollout.sql
-- 125: Refresh homepage roadmap after the preview card and mail rollout landed.

UPDATE public.site_config
SET
  value = '[
    {
      "id": "public-cache",
      "icon": "Globe",
      "title": "公共数据缓存",
      "description": "首屏公共数据已统一走同源 API，并支持公共缓存版本刷新。",
      "status": "completed",
      "priority": "high"
    },
    {
      "id": "ops-automation",
      "icon": "RefreshCw",
      "title": "运营自动化二期",
      "description": "自动化任务已具备 job graph、partial 状态、重跑和审计详情。",
      "status": "completed",
      "priority": "high"
    },
    {
      "id": "admin-data",
      "icon": "Database",
      "title": "卡池角色管理",
      "description": "卡池、角色与武器管理已完成重写，支持更安全的编辑流程。",
      "status": "completed",
      "priority": "high"
    },
    {
      "id": "performance-docs",
      "icon": "Rocket",
      "title": "项目瘦身与文档",
      "description": "README、架构文档、截图与入口拆包已完成本轮整理。",
      "status": "completed",
      "priority": "medium"
    },
    {
      "id": "heirlooms-preview",
      "icon": "Map",
      "title": "寻遗散记前瞻",
      "description": "首页已同步寻遗散记前瞻摘要、PV 与动态入口。",
      "status": "completed",
      "priority": "high"
    },
    {
      "id": "official-id-backfill",
      "icon": "Shield",
      "title": "官方 ID 回填",
      "description": "后续将收口手动主键、官方 ID、别名和历史导出的兼容迁移。",
      "status": "planned",
      "priority": "high"
    },
    {
      "id": "public-api-metrics",
      "icon": "Calculator",
      "title": "公共 API 指标",
      "description": "卡池分析将补齐预聚合指标、趋势点、分布桶和口径说明。",
      "status": "planned",
      "priority": "high"
    },
    {
      "id": "account-notify",
      "icon": "Languages",
      "title": "账号与通知闭环",
      "description": "邮箱验证、密码重置、邮件登录、工单通知和后台邮件状态已接入；持久通知中心继续排期。",
      "status": "in_progress",
      "priority": "high"
    }
  ]',
  label = COALESCE(label, '首页路线图'),
  category = COALESCE(category, 'home'),
  updated_at = now()
WHERE key = 'home_roadmap_items';

INSERT INTO public.site_config (key, value, label, category, updated_at)
SELECT
  'home_roadmap_items',
  '[
    {
      "id": "public-cache",
      "icon": "Globe",
      "title": "公共数据缓存",
      "description": "首屏公共数据已统一走同源 API，并支持公共缓存版本刷新。",
      "status": "completed",
      "priority": "high"
    },
    {
      "id": "ops-automation",
      "icon": "RefreshCw",
      "title": "运营自动化二期",
      "description": "自动化任务已具备 job graph、partial 状态、重跑和审计详情。",
      "status": "completed",
      "priority": "high"
    },
    {
      "id": "admin-data",
      "icon": "Database",
      "title": "卡池角色管理",
      "description": "卡池、角色与武器管理已完成重写，支持更安全的编辑流程。",
      "status": "completed",
      "priority": "high"
    },
    {
      "id": "performance-docs",
      "icon": "Rocket",
      "title": "项目瘦身与文档",
      "description": "README、架构文档、截图与入口拆包已完成本轮整理。",
      "status": "completed",
      "priority": "medium"
    },
    {
      "id": "heirlooms-preview",
      "icon": "Map",
      "title": "寻遗散记前瞻",
      "description": "首页已同步寻遗散记前瞻摘要、PV 与动态入口。",
      "status": "completed",
      "priority": "high"
    },
    {
      "id": "official-id-backfill",
      "icon": "Shield",
      "title": "官方 ID 回填",
      "description": "后续将收口手动主键、官方 ID、别名和历史导出的兼容迁移。",
      "status": "planned",
      "priority": "high"
    },
    {
      "id": "public-api-metrics",
      "icon": "Calculator",
      "title": "公共 API 指标",
      "description": "卡池分析将补齐预聚合指标、趋势点、分布桶和口径说明。",
      "status": "planned",
      "priority": "high"
    },
    {
      "id": "account-notify",
      "icon": "Languages",
      "title": "账号与通知闭环",
      "description": "邮箱验证、密码重置、邮件登录、工单通知和后台邮件状态已接入；持久通知中心继续排期。",
      "status": "in_progress",
      "priority": "high"
    }
  ]',
  '首页路线图',
  'home',
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.site_config WHERE key = 'home_roadmap_items'
);

UPDATE public.site_config
SET value = jsonb_build_object(
  'version', ((extract(epoch from now()) * 1000)::bigint)::text,
  'scope', 'site-config',
  'reason', 'migration:125_refresh_home_roadmap_after_mail_rollout',
  'updatedAt', now()
)::text,
updated_at = now()
WHERE key = 'public_cache_epoch';
-- <<< END MIGRATION: active/125_refresh_home_roadmap_after_mail_rollout.sql

-- >>> BEGIN MIGRATION: active/126_add_account_email_mail_events.sql
-- 126: add account email verification/change mail events.
--
-- Settings email actions now use the same transactional mail control surface as
-- registration, password reset, tickets, and developer API review mail.

ALTER TABLE public.mail_outbox
  DROP CONSTRAINT IF EXISTS mail_outbox_event_type_check;

ALTER TABLE public.mail_outbox
  ADD CONSTRAINT mail_outbox_event_type_check
  CHECK (
    event_type IN (
      'register_confirmation',
      'email_login',
      'email_verification',
      'email_change',
      'password_reset',
      'ticket_reply',
      'developer_api_review',
      'admin_alert'
    )
  );

ALTER TABLE public.mail_abuse_budget_config
  DROP CONSTRAINT IF EXISTS mail_abuse_budget_config_event_type_check;

ALTER TABLE public.mail_abuse_budget_config
  ADD CONSTRAINT mail_abuse_budget_config_event_type_check
  CHECK (
    event_type IN (
      '*',
      'register_confirmation',
      'email_login',
      'email_verification',
      'email_change',
      'password_reset',
      'ticket_reply',
      'developer_api_review',
      'admin_alert'
    )
  );

INSERT INTO public.mail_abuse_budget_config (scope, event_type, window_seconds, max_attempts)
VALUES
  ('event', 'email_verification', 86400, 120),
  ('recipient', 'email_verification', 3600, 3),
  ('domain', 'email_verification', 86400, 40),
  ('ip', 'email_verification', 3600, 5),
  ('user', 'email_verification', 3600, 3),
  ('event', 'email_change', 86400, 80),
  ('recipient', 'email_change', 3600, 3),
  ('domain', 'email_change', 86400, 30),
  ('ip', 'email_change', 3600, 5),
  ('user', 'email_change', 3600, 3)
ON CONFLICT (scope, event_type) DO UPDATE SET
  window_seconds = EXCLUDED.window_seconds,
  max_attempts = EXCLUDED.max_attempts,
  enabled = EXCLUDED.enabled,
  updated_at = NOW();

CREATE OR REPLACE FUNCTION public.sync_profile_email_from_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles
    SET
      email = NEW.email,
      updated_at = NOW()
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_email_from_auth_user();

COMMENT ON CONSTRAINT mail_outbox_event_type_check ON public.mail_outbox IS
  'Allowed transactional mail event types, including account email verification and email change.';

COMMENT ON CONSTRAINT mail_abuse_budget_config_event_type_check ON public.mail_abuse_budget_config IS
  'Allowed mail budget event types, including account email verification and email change.';

COMMENT ON FUNCTION public.sync_profile_email_from_auth_user() IS
  'Keeps public.profiles.email aligned after a confirmed auth.users email change.';

ALTER TABLE public.account_security_states
  ADD COLUMN IF NOT EXISTS email_verification_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_verification_reason TEXT,
  ADD COLUMN IF NOT EXISTS email_verification_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verification_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verification_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS email_verification_token_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_account_security_states_email_verification_required
  ON public.account_security_states(email_verification_required, email_verification_requested_at)
  WHERE email_verification_required IS TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_security_states_email_verification_token_hash
  ON public.account_security_states(email_verification_token_hash)
  WHERE email_verification_token_hash IS NOT NULL;

INSERT INTO public.account_security_states (
  user_id,
  email_verification_required,
  email_verification_reason,
  email_verification_requested_at,
  created_at,
  updated_at
)
SELECT
  auth_user.id,
  TRUE,
  'mail_verification_rollout_2026_05',
  NOW(),
  NOW(),
  NOW()
FROM auth.users AS auth_user
LEFT JOIN public.profiles AS profile ON profile.id = auth_user.id
WHERE COALESCE(profile.role, 'user') <> 'super_admin'
ON CONFLICT (user_id) DO UPDATE SET
  email_verification_required = CASE
    WHEN public.account_security_states.email_verification_verified_at IS NULL THEN TRUE
    ELSE public.account_security_states.email_verification_required
  END,
  email_verification_reason = CASE
    WHEN public.account_security_states.email_verification_verified_at IS NULL THEN EXCLUDED.email_verification_reason
    ELSE public.account_security_states.email_verification_reason
  END,
  email_verification_requested_at = CASE
    WHEN public.account_security_states.email_verification_verified_at IS NULL THEN COALESCE(
      public.account_security_states.email_verification_requested_at,
      EXCLUDED.email_verification_requested_at
    )
    ELSE public.account_security_states.email_verification_requested_at
  END,
  updated_at = CASE
    WHEN public.account_security_states.email_verification_verified_at IS NULL THEN NOW()
    ELSE public.account_security_states.updated_at
  END;

UPDATE public.account_security_states AS state
SET
  email_verification_required = FALSE,
  email_verification_reason = NULL,
  email_verification_requested_at = NULL,
  email_verification_token_hash = NULL,
  email_verification_token_expires_at = NULL,
  updated_at = NOW()
FROM public.profiles AS profile
WHERE profile.id = state.user_id
  AND profile.role = 'super_admin';

COMMENT ON COLUMN public.account_security_states.email_verification_required IS
  'True when the account must verify its current email address after the mail system rollout. Super admins are excluded.';

COMMENT ON COLUMN public.account_security_states.email_verification_token_hash IS
  'SHA-256 hash of the latest one-time account email verification token. Raw tokens are only sent by mail and are not stored.';
-- <<< END MIGRATION: active/126_add_account_email_mail_events.sql

-- >>> BEGIN MIGRATION: active/127_bump_site_version_440.sql
-- 127: bump public site version for v4.4.0.

UPDATE public.site_config
SET
  value = 'v4.4.0',
  updated_at = NOW()
WHERE key = 'site_version';

INSERT INTO public.site_config (key, value, label, category, updated_at)
SELECT
  'site_version',
  'v4.4.0',
  '站点版本',
  'general',
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM public.site_config WHERE key = 'site_version'
);

UPDATE public.site_config
SET
  value = jsonb_build_object(
    'version', ((extract(epoch from now()) * 1000)::bigint)::text,
    'scope', 'site-config',
    'reason', 'migration:127_bump_site_version_440',
    'updatedAt', now()
  )::text,
  updated_at = NOW()
WHERE key = 'public_cache_epoch';
-- <<< END MIGRATION: active/127_bump_site_version_440.sql

-- >>> BEGIN MIGRATION: active/128_add_account_email_verification_code.sql
-- 128: add short-lived account email verification code support.
--
-- Users can still use the email link, but Settings now also accepts a
-- short numeric code so verification can complete in the original browser tab.

ALTER TABLE public.account_security_states
  ADD COLUMN IF NOT EXISTS email_verification_code_hash TEXT,
  ADD COLUMN IF NOT EXISTS email_verification_code_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_security_states_email_verification_code_hash
  ON public.account_security_states(email_verification_code_hash)
  WHERE email_verification_code_hash IS NOT NULL;

COMMENT ON COLUMN public.account_security_states.email_verification_code_hash IS
  'SHA-256 hash of user_id plus the latest short email verification code. Raw codes are only sent by mail and are not stored.';

COMMENT ON COLUMN public.account_security_states.email_verification_code_expires_at IS
  'Expiry time for the latest short email verification code.';
-- <<< END MIGRATION: active/128_add_account_email_verification_code.sql

-- >>> BEGIN MIGRATION: active/129_add_site_auth_sessions.sql
-- 129: add private site-managed auth sessions.
--
-- This keeps auth.users as the stable user id anchor, while allowing the
-- application server to own OAuth callback sessions for providers that do not
-- fit Supabase Auth's built-in provider flow.

CREATE TABLE IF NOT EXISTS public.app_auth_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_subject_hash TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  email_hash TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  raw_profile_hash TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  metadata_redacted_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (provider, provider_subject_hash)
);

CREATE INDEX IF NOT EXISTS idx_app_auth_identities_user_provider
  ON public.app_auth_identities(user_id, provider);

CREATE INDEX IF NOT EXISTS idx_app_auth_identities_last_used
  ON public.app_auth_identities(provider, last_used_at DESC)
  WHERE disabled_at IS NULL;

ALTER TABLE public.app_auth_identities ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.app_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT UNIQUE,
  user_agent_hash TEXT,
  ip_prefix_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_sessions_user_created
  ON public.app_sessions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_sessions_active_expiry
  ON public.app_sessions(expires_at, absolute_expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.app_auth_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  provider TEXT,
  outcome TEXT NOT NULL,
  requester_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_auth_audit_events_user_created
  ON public.app_auth_audit_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_auth_audit_events_type_created
  ON public.app_auth_audit_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_auth_audit_events_provider_created
  ON public.app_auth_audit_events(provider, created_at DESC)
  WHERE provider IS NOT NULL;

ALTER TABLE public.app_auth_audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.app_auth_identities FROM anon, authenticated;
REVOKE ALL ON public.app_sessions FROM anon, authenticated;
REVOKE ALL ON public.app_auth_audit_events FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_auth_identities TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_sessions TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_auth_audit_events TO service_role;
  END IF;
END $$;

COMMENT ON TABLE public.app_auth_identities IS
  'Private mapping between site users and external OAuth identities. Stores hashed provider subjects and redacted profile summaries only.';

COMMENT ON TABLE public.app_sessions IS
  'Private site-managed HttpOnly session records. Raw session tokens are only stored in browser cookies; the database stores hashes.';

COMMENT ON TABLE public.app_auth_audit_events IS
  'Private site auth audit events. Metadata must not contain raw provider tokens, passwords, API keys, raw IP addresses, emails, game_uid, or history ids.';

COMMENT ON COLUMN public.app_auth_identities.provider_subject_hash IS
  'HMAC hash of provider plus provider subject. Raw external ids are not stored.';

COMMENT ON COLUMN public.app_sessions.session_token_hash IS
  'HMAC hash of the browser session cookie token. Raw tokens are never stored.';

COMMENT ON COLUMN public.app_sessions.refresh_token_hash IS
  'Reserved HMAC hash for future refresh-token rotation. Raw tokens are never stored.';
-- <<< END MIGRATION: active/129_add_site_auth_sessions.sql

-- >>> BEGIN MIGRATION: active/130_bump_site_version_445.sql
-- 130: bump public site version for v4.4.5.

UPDATE public.site_config
SET
  value = 'v4.4.5',
  updated_at = NOW()
WHERE key = 'site_version';

INSERT INTO public.site_config (key, value, label, category, updated_at)
SELECT
  'site_version',
  'v4.4.5',
  '站点版本',
  'general',
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM public.site_config WHERE key = 'site_version'
);

UPDATE public.site_config
SET
  value = jsonb_build_object(
    'version', ((extract(epoch from now()) * 1000)::bigint)::text,
    'scope', 'site-config',
    'reason', 'migration:130_bump_site_version_445',
    'updatedAt', now()
  )::text,
  updated_at = NOW()
WHERE key = 'public_cache_epoch';
-- <<< END MIGRATION: active/130_bump_site_version_445.sql

-- >>> BEGIN MIGRATION: active/130_stop_trusting_github_provider_email.sql
-- 130: stop treating GitHub provider email as a verified site email.
--
-- GitHub is kept as a login identity only. Site email and site password must be
-- bound inside this application so account recovery and password login have one
-- consistent owner.

UPDATE public.app_auth_identities
SET
  email_hash = NULL,
  email_verified = FALSE,
  metadata_redacted_json = COALESCE(metadata_redacted_json, '{}'::jsonb)
    || jsonb_build_object('providerEmailIgnoredForSiteAuth', TRUE)
WHERE provider = 'github'
  AND disabled_at IS NULL;

UPDATE public.profiles AS profile
SET
  email = NULL,
  updated_at = NOW()
FROM public.app_auth_identities AS identity
JOIN auth.users AS auth_user
  ON auth_user.id = identity.user_id
LEFT JOIN public.account_security_states AS state
  ON state.user_id = identity.user_id
WHERE profile.id = identity.user_id
  AND identity.provider = 'github'
  AND identity.disabled_at IS NULL
  AND profile.role <> 'super_admin'
  AND profile.email IS NOT NULL
  AND (
    state.user_id IS NULL
    OR state.email_verification_verified_at IS NULL
  )
  AND COALESCE(auth_user.raw_user_meta_data, '{}'::jsonb)->>'site_password_set' IS DISTINCT FROM 'true'
  AND COALESCE(auth_user.raw_user_meta_data, '{}'::jsonb)->>'email_bound_from_profile' IS DISTINCT FROM 'true';

INSERT INTO public.account_security_states (
  user_id,
  email_verification_required,
  email_verification_reason,
  email_verification_requested_at,
  password_change_required,
  password_change_reason,
  password_change_source,
  password_change_requested_at,
  created_at,
  updated_at
)
SELECT
  auth_user.id,
  TRUE,
  'oauth_email_setup_required_existing',
  NOW(),
  TRUE,
  'oauth_password_setup_required_existing',
  'oauth',
  NOW(),
  NOW(),
  NOW()
FROM auth.users AS auth_user
JOIN public.app_auth_identities AS identity
  ON identity.user_id = auth_user.id
LEFT JOIN public.profiles AS profile
  ON profile.id = auth_user.id
LEFT JOIN public.account_security_states AS state
  ON state.user_id = auth_user.id
WHERE identity.provider = 'github'
  AND identity.disabled_at IS NULL
  AND COALESCE(profile.role, 'user') <> 'super_admin'
  AND (
    auth_user.email ILIKE 'github.%@oauth.local.invalid'
    OR COALESCE(auth_user.raw_user_meta_data, '{}'::jsonb)->>'synthetic_oauth_email' = 'true'
  )
  AND COALESCE(profile.email, '') = ''
  AND COALESCE(state.email_verification_verified_at, NULL) IS NULL
  AND COALESCE(auth_user.raw_user_meta_data, '{}'::jsonb)->>'site_password_set' IS DISTINCT FROM 'true'
  AND COALESCE(auth_user.raw_user_meta_data, '{}'::jsonb)->>'email_bound_from_profile' IS DISTINCT FROM 'true'
ON CONFLICT (user_id) DO UPDATE SET
  email_verification_required = CASE
    WHEN public.account_security_states.email_verification_verified_at IS NULL THEN TRUE
    ELSE public.account_security_states.email_verification_required
  END,
  email_verification_reason = CASE
    WHEN public.account_security_states.email_verification_verified_at IS NULL THEN 'oauth_email_setup_required_existing'
    ELSE public.account_security_states.email_verification_reason
  END,
  email_verification_requested_at = CASE
    WHEN public.account_security_states.email_verification_verified_at IS NULL THEN COALESCE(
      public.account_security_states.email_verification_requested_at,
      EXCLUDED.email_verification_requested_at
    )
    ELSE public.account_security_states.email_verification_requested_at
  END,
  password_change_required = CASE
    WHEN public.account_security_states.password_change_required IS NOT TRUE THEN TRUE
    ELSE public.account_security_states.password_change_required
  END,
  password_change_reason = CASE
    WHEN public.account_security_states.password_change_required IS NOT TRUE THEN 'oauth_password_setup_required_existing'
    ELSE public.account_security_states.password_change_reason
  END,
  password_change_source = CASE
    WHEN public.account_security_states.password_change_required IS NOT TRUE THEN 'oauth'
    ELSE public.account_security_states.password_change_source
  END,
  password_change_requested_at = CASE
    WHEN public.account_security_states.password_change_required IS NOT TRUE THEN COALESCE(
      public.account_security_states.password_change_requested_at,
      EXCLUDED.password_change_requested_at
    )
    ELSE public.account_security_states.password_change_requested_at
  END,
  updated_at = NOW();
-- <<< END MIGRATION: active/130_stop_trusting_github_provider_email.sql

-- >>> BEGIN MIGRATION: active/131_bump_site_version_451.sql
-- 131: bump public site version for v4.5.1.

UPDATE public.site_config
SET
  value = 'v4.5.1',
  updated_at = NOW()
WHERE key = 'site_version';

INSERT INTO public.site_config (key, value, label, category, updated_at)
SELECT
  'site_version',
  'v4.5.1',
  '站点版本',
  'general',
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM public.site_config WHERE key = 'site_version'
);

UPDATE public.site_config
SET
  value = jsonb_build_object(
    'version', ((extract(epoch from now()) * 1000)::bigint)::text,
    'scope', 'site-config',
    'reason', 'migration:131_bump_site_version_451',
    'updatedAt', now()
  )::text,
  updated_at = NOW()
WHERE key = 'public_cache_epoch';
-- <<< END MIGRATION: active/131_bump_site_version_451.sql

-- >>> BEGIN MIGRATION: active/132_seed_home_version_timeline.sql
-- 132: seed homepage version timeline config.

INSERT INTO public.site_config (key, value, label, category, updated_at)
SELECT
  'home_version_timeline',
  jsonb_build_object(
    'versions',
    jsonb_build_array(
      jsonb_build_object(
        'id', 'pre-summer-2026',
        'name', '寻遗散记',
        'name_en', 'Lost Heirlooms',
        'starts_at', '2026-06-05T12:00:00+08:00',
        'ends_at', null,
        'enabled', true,
        'order', 10,
        'pool_ids', jsonb_build_array()
      )
    )
  )::text,
  '首页版本时间线',
  'content',
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM public.site_config WHERE key = 'home_version_timeline'
);

UPDATE public.site_config
SET
  value = '2026-06-05T12:00:00+08:00',
  updated_at = NOW()
WHERE key = 'home_next_version_target_at'
  AND (value IS NULL OR trim(value) = '');

INSERT INTO public.site_config (key, value, label, category, updated_at)
SELECT
  'home_next_version_target_at',
  '2026-06-05T12:00:00+08:00',
  '首页下版本倒计时',
  'content',
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM public.site_config WHERE key = 'home_next_version_target_at'
);

UPDATE public.site_config
SET
  value = jsonb_build_object(
    'version', ((extract(epoch from now()) * 1000)::bigint)::text,
    'scope', 'home-version-timeline',
    'reason', 'migration:132_seed_home_version_timeline',
    'updatedAt', now()
  )::text,
  updated_at = NOW()
WHERE key = 'public_cache_epoch';
-- <<< END MIGRATION: active/132_seed_home_version_timeline.sql

-- >>> BEGIN MIGRATION: active/133_extend_public_analytics_refresh_timeout.sql
-- 133: extend public analytics refresh timeout for production-size history.
--
-- Production refresh currently completes inside the database in about half a
-- minute, but PostgREST RPC can still inherit a shorter statement timeout and
-- cancel the request. Keep the analytics SQL unchanged and only give the three
-- refresh functions enough time to finish through the normal admin/API path.

ALTER FUNCTION public.refresh_public_pool_analytics_cache()
  SET statement_timeout = '10min';

ALTER FUNCTION public.refresh_public_pool_trend_cache()
  SET statement_timeout = '10min';

ALTER FUNCTION public.refresh_public_analytics_cache()
  SET statement_timeout = '10min';
-- <<< END MIGRATION: active/133_extend_public_analytics_refresh_timeout.sql

-- >>> BEGIN MIGRATION: active/134_allow_service_role_admin_rpc.sql
-- 134: allow server-side admin RPC calls through service_role.
--
-- The admin API already verifies the caller with the site-session layer before
-- it calls Supabase with the service role key. Some admin RPCs also call
-- public.is_super_admin(), but service_role requests do not have auth.uid(), so
-- those RPCs can reject valid super-admin actions with:
--   only super_admin can manage pools
--
-- Keep browser/user calls unchanged: authenticated users still need a
-- profiles.role = 'super_admin' row. Only service_role gains the helper pass.

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'super_admin'
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.is_super_admin() TO service_role;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.is_super_admin() IS
  '判断当前请求是否具备超管权限；浏览器用户需要 profiles.role = super_admin，服务端代理请求允许 service_role。';
-- <<< END MIGRATION: active/134_allow_service_role_admin_rpc.sql

-- >>> BEGIN MIGRATION: active/135_fix_service_role_admin_pool_rpc.sql
-- 135: fix service-role admin RPC checks and pool ownership.
--
-- Admin routes verify the real caller in the site-session layer, then call
-- Supabase with the service role key. In self-hosted PostgREST, service-role
-- requests expose the role through auth.role() / request.jwt.claims, not through
-- request.jwt.claim.role. This repairs public.is_super_admin() and makes pool
-- upserts accept the verified actor id from the API.

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'super_admin'
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.is_super_admin() TO service_role;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.is_super_admin() IS
  '判断当前请求是否具备超管权限；浏览器用户需要 profiles.role = super_admin，服务端代理请求允许 service_role。';

DROP FUNCTION IF EXISTS public.admin_upsert_pool_with_aliases(TEXT, JSONB, JSONB, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.admin_upsert_pool_with_aliases(TEXT, JSONB, JSONB, JSONB, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.admin_upsert_pool_with_aliases(
  p_pool_id TEXT,
  p_insert_payload JSONB,
  p_update_payload JSONB DEFAULT '{}'::jsonb,
  p_alias_rows JSONB DEFAULT '[]'::jsonb,
  p_pool_character_rows JSONB DEFAULT '[]'::jsonb,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id UUID;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'only super_admin can manage pools';
  END IF;

  IF COALESCE(BTRIM(p_pool_id), '') = '' THEN
    RAISE EXCEPTION 'p_pool_id is required';
  END IF;

  IF p_insert_payload IS NULL OR jsonb_typeof(p_insert_payload) <> 'object' THEN
    RAISE EXCEPTION 'p_insert_payload must be a JSON object';
  END IF;

  IF p_update_payload IS NULL THEN
    p_update_payload := '{}'::jsonb;
  END IF;

  IF jsonb_typeof(p_update_payload) <> 'object' THEN
    RAISE EXCEPTION 'p_update_payload must be a JSON object';
  END IF;

  IF p_alias_rows IS NULL THEN
    p_alias_rows := '[]'::jsonb;
  END IF;

  IF jsonb_typeof(p_alias_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_alias_rows must be a JSON array';
  END IF;

  IF p_pool_character_rows IS NULL THEN
    p_pool_character_rows := '[]'::jsonb;
  END IF;

  IF jsonb_typeof(p_pool_character_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_pool_character_rows must be a JSON array';
  END IF;

  v_actor_user_id := COALESCE(
    p_actor_user_id,
    CASE
      WHEN COALESCE(BTRIM(p_insert_payload->>'user_id'), '') <> ''
      THEN BTRIM(p_insert_payload->>'user_id')::UUID
      ELSE NULL
    END,
    auth.uid()
  );

  IF v_actor_user_id IS NULL AND auth.role() = 'service_role' THEN
    SELECT id
      INTO v_actor_user_id
      FROM public.profiles
     WHERE role = 'super_admin'
     ORDER BY created_at ASC NULLS LAST, id ASC
     LIMIT 1;
  END IF;

  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'pool owner is required';
  END IF;

  INSERT INTO public.pools (
    user_id,
    pool_id,
    name,
    name_en,
    type,
    locked,
    is_limited_weapon,
    description,
    start_time,
    end_time,
    banner_url,
    featured_characters,
    up_character
  )
  VALUES (
    v_actor_user_id,
    BTRIM(p_pool_id),
    BTRIM(p_insert_payload->>'name'),
    NULLIF(BTRIM(p_insert_payload->>'name_en'), ''),
    COALESCE(NULLIF(BTRIM(p_insert_payload->>'type'), ''), 'limited'),
    COALESCE((p_insert_payload->>'locked')::BOOLEAN, FALSE),
    CASE
      WHEN p_insert_payload ? 'is_limited_weapon'
        AND jsonb_typeof(p_insert_payload->'is_limited_weapon') = 'boolean'
      THEN (p_insert_payload->>'is_limited_weapon')::BOOLEAN
      ELSE NULL
    END,
    NULLIF(BTRIM(p_insert_payload->>'description'), ''),
    NULLIF(BTRIM(p_insert_payload->>'start_time'), '')::TIMESTAMPTZ,
    NULLIF(BTRIM(p_insert_payload->>'end_time'), '')::TIMESTAMPTZ,
    NULLIF(BTRIM(p_insert_payload->>'banner_url'), ''),
    CASE
      WHEN p_insert_payload ? 'featured_characters'
        AND jsonb_typeof(p_insert_payload->'featured_characters') = 'array'
      THEN ARRAY(
        SELECT jsonb_array_elements_text(p_insert_payload->'featured_characters')
      )
      ELSE NULL
    END,
    NULLIF(BTRIM(p_insert_payload->>'up_character'), '')
  )
  ON CONFLICT (pool_id) DO UPDATE
  SET
    name = CASE
      WHEN p_update_payload ? 'name'
      THEN COALESCE(NULLIF(BTRIM(p_update_payload->>'name'), ''), public.pools.name)
      ELSE public.pools.name
    END,
    name_en = CASE
      WHEN p_update_payload ? 'name_en'
      THEN NULLIF(BTRIM(p_update_payload->>'name_en'), '')
      ELSE public.pools.name_en
    END,
    type = CASE
      WHEN p_update_payload ? 'type'
      THEN COALESCE(NULLIF(BTRIM(p_update_payload->>'type'), ''), public.pools.type)
      ELSE public.pools.type
    END,
    locked = CASE
      WHEN p_update_payload ? 'locked'
        AND jsonb_typeof(p_update_payload->'locked') = 'boolean'
      THEN (p_update_payload->>'locked')::BOOLEAN
      ELSE public.pools.locked
    END,
    is_limited_weapon = CASE
      WHEN p_update_payload ? 'is_limited_weapon'
        AND jsonb_typeof(p_update_payload->'is_limited_weapon') = 'boolean'
      THEN (p_update_payload->>'is_limited_weapon')::BOOLEAN
      WHEN p_update_payload ? 'is_limited_weapon'
        AND jsonb_typeof(p_update_payload->'is_limited_weapon') = 'null'
      THEN NULL
      ELSE public.pools.is_limited_weapon
    END,
    description = CASE
      WHEN p_update_payload ? 'description'
      THEN NULLIF(BTRIM(p_update_payload->>'description'), '')
      ELSE public.pools.description
    END,
    start_time = CASE
      WHEN p_update_payload ? 'start_time'
      THEN NULLIF(BTRIM(p_update_payload->>'start_time'), '')::TIMESTAMPTZ
      ELSE public.pools.start_time
    END,
    end_time = CASE
      WHEN p_update_payload ? 'end_time'
      THEN NULLIF(BTRIM(p_update_payload->>'end_time'), '')::TIMESTAMPTZ
      ELSE public.pools.end_time
    END,
    banner_url = CASE
      WHEN p_update_payload ? 'banner_url'
      THEN NULLIF(BTRIM(p_update_payload->>'banner_url'), '')
      ELSE public.pools.banner_url
    END,
    featured_characters = CASE
      WHEN p_update_payload ? 'featured_characters'
        AND jsonb_typeof(p_update_payload->'featured_characters') = 'array'
      THEN ARRAY(
        SELECT jsonb_array_elements_text(p_update_payload->'featured_characters')
      )
      WHEN p_update_payload ? 'featured_characters'
        AND jsonb_typeof(p_update_payload->'featured_characters') = 'null'
      THEN NULL
      ELSE public.pools.featured_characters
    END,
    up_character = CASE
      WHEN p_update_payload ? 'up_character'
      THEN NULLIF(BTRIM(p_update_payload->>'up_character'), '')
      ELSE public.pools.up_character
    END;

  INSERT INTO public.pool_id_aliases (
    source,
    alias_id,
    pool_id,
    is_primary,
    note
  )
  SELECT
    BTRIM(alias_entry.value->>'source'),
    BTRIM(alias_entry.value->>'alias_id'),
    BTRIM(p_pool_id),
    COALESCE((alias_entry.value->>'is_primary')::BOOLEAN, FALSE),
    NULLIF(BTRIM(alias_entry.value->>'note'), '')
  FROM jsonb_array_elements(p_alias_rows) AS alias_entry(value)
  WHERE
    jsonb_typeof(alias_entry.value) = 'object'
    AND COALESCE(BTRIM(alias_entry.value->>'source'), '') <> ''
    AND COALESCE(BTRIM(alias_entry.value->>'alias_id'), '') <> ''
  ON CONFLICT (source, alias_id) DO UPDATE
  SET
    pool_id = EXCLUDED.pool_id,
    is_primary = EXCLUDED.is_primary,
    note = EXCLUDED.note,
    updated_at = NOW();

  IF jsonb_array_length(p_pool_character_rows) > 0 THEN
    DELETE FROM public.pool_characters
    WHERE pool_id = BTRIM(p_pool_id);

    INSERT INTO public.pool_characters (
      pool_id,
      character_id,
      is_up
    )
    SELECT
      BTRIM(p_pool_id),
      BTRIM(character_entry.value->>'character_id'),
      COALESCE((character_entry.value->>'is_up')::BOOLEAN, FALSE)
    FROM jsonb_array_elements(p_pool_character_rows) AS character_entry(value)
    WHERE
      jsonb_typeof(character_entry.value) = 'object'
      AND COALESCE(BTRIM(character_entry.value->>'character_id'), '') <> ''
    ON CONFLICT (pool_id, character_id) DO UPDATE
    SET is_up = EXCLUDED.is_up;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_pool_with_aliases(TEXT, JSONB, JSONB, JSONB, JSONB, UUID) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_upsert_pool_with_aliases(TEXT, JSONB, JSONB, JSONB, JSONB, UUID) TO service_role;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_upsert_pool_with_aliases(TEXT, JSONB, JSONB, JSONB, JSONB, UUID) IS
  '管理端原子化写入单个卡池、alias 与 pool_characters；服务端代理调用应传入已验证的 actor user id。';

CREATE OR REPLACE FUNCTION public.admin_upsert_pool_with_aliases(
  p_pool_id TEXT,
  p_name TEXT,
  p_type TEXT DEFAULT 'limited',
  p_description TEXT DEFAULT NULL,
  p_start_time TIMESTAMPTZ DEFAULT NULL,
  p_end_time TIMESTAMPTZ DEFAULT NULL,
  p_up_character TEXT DEFAULT NULL,
  p_featured_characters TEXT[] DEFAULT NULL,
  p_banner_url TEXT DEFAULT NULL,
  p_alias_rows JSONB DEFAULT '[]'::jsonb,
  p_pool_character_rows JSONB DEFAULT '[]'::jsonb,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload JSONB;
BEGIN
  v_payload := jsonb_build_object(
    'name', p_name,
    'type', p_type,
    'description', p_description,
    'start_time', p_start_time,
    'end_time', p_end_time,
    'up_character', p_up_character,
    'featured_characters', p_featured_characters,
    'banner_url', p_banner_url
  );

  PERFORM public.admin_upsert_pool_with_aliases(
    p_pool_id,
    v_payload,
    v_payload,
    p_alias_rows,
    p_pool_character_rows,
    p_actor_user_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_pool_with_aliases(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT[], TEXT, JSONB, JSONB, UUID) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_upsert_pool_with_aliases(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT[], TEXT, JSONB, JSONB, UUID) TO service_role;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_upsert_pool_with_aliases(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT[], TEXT, JSONB, JSONB, UUID) IS
  '兼容旧参数形式的卡池写入 RPC；内部委托给 JSON payload 版本。';

DROP FUNCTION IF EXISTS public.__debug_request_context_once();

NOTIFY pgrst, 'reload schema';
-- <<< END MIGRATION: active/135_fix_service_role_admin_pool_rpc.sql

-- >>> BEGIN MIGRATION: active/136_fix_service_role_admin_profile_rpc.sql
-- 136: allow same-origin admin profile updates through service-role RPC calls.
--
-- The admin users route verifies the real caller in the site-session layer and
-- then calls Supabase with the service role key. In that request context
-- auth.uid() is empty, so the old admin_update_profile() check rejected valid
-- super-admin edits. Require the API to pass the verified actor id instead.

DROP FUNCTION IF EXISTS public.admin_update_profile(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_update_profile(UUID, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.admin_update_profile(
  p_target_user_id UUID,
  p_username TEXT DEFAULT NULL,
  p_role TEXT DEFAULT NULL,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id UUID;
  v_updated public.profiles;
BEGIN
  v_actor_user_id := COALESCE(p_actor_user_id, auth.uid());

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = v_actor_user_id
      AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Only super_admin can update profiles'
      USING ERRCODE = '42501';
  END IF;

  IF p_role IS NOT NULL AND p_role NOT IN ('user', 'admin') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET
    username = COALESCE(NULLIF(BTRIM(p_username), ''), username),
    role = COALESCE(p_role, role),
    updated_at = NOW()
  WHERE id = p_target_user_id
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found: %', p_target_user_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_profile(UUID, TEXT, TEXT, UUID) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_update_profile(UUID, TEXT, TEXT, UUID) TO service_role;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_update_profile(UUID, TEXT, TEXT, UUID) IS
  '超管更新用户 profile 的受控入口；同源后台代理调用必须传入已验证的 actor user id。';

NOTIFY pgrst, 'reload schema';
-- <<< END MIGRATION: active/136_fix_service_role_admin_profile_rpc.sql

-- >>> BEGIN MIGRATION: active/137_restore_history_character_id_for_official_import.sql
-- 137: restore history.character_id for official import reconciliation.
--
-- Migration 096 retired history.character_id as a compatibility field after
-- alias-backed references were cleaned up. DATA-NEW-018 now needs this column
-- again as a forward field: official imports can carry stable character/weapon
-- ids directly, and keeping them on history prevents future placeholder drift.
--
-- Do not restore legacy_pool_id. That field remains retired.

ALTER TABLE public.history
  ADD COLUMN IF NOT EXISTS character_id TEXT;

ALTER TABLE public.history
  ALTER COLUMN character_id TYPE TEXT;

CREATE INDEX IF NOT EXISTS idx_history_character_id
  ON public.history(character_id);

COMMENT ON COLUMN public.history.character_id IS
  '官方导入记录携带的角色或武器 ID；用于角色/武器图鉴、手动占位合并与后续官方 ID 回填。';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'history'
      AND column_name = 'character_id'
  ) THEN
    RAISE EXCEPTION 'Migration 137 failed: history.character_id is missing';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
-- <<< END MIGRATION: active/137_restore_history_character_id_for_official_import.sql

-- >>> BEGIN MIGRATION: active/138_add_status_probe_reports.sql
-- STATUS-001: VPS probe latest reports for the hidden status admin page.
create table if not exists public.status_probe_reports (
  probe_id text primary key,
  label text not null,
  region text,
  status text not null default 'unknown',
  summary text,
  reported_at timestamptz not null,
  received_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_status_probe_reports_status
  on public.status_probe_reports (status);

create index if not exists idx_status_probe_reports_reported_at
  on public.status_probe_reports (reported_at desc);

create or replace function public.set_status_probe_reports_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_status_probe_reports_updated_at on public.status_probe_reports;
create trigger trg_status_probe_reports_updated_at
before update on public.status_probe_reports
for each row
execute function public.set_status_probe_reports_updated_at();

alter table public.status_probe_reports enable row level security;

revoke all on table public.status_probe_reports from anon;
revoke all on table public.status_probe_reports from authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.status_probe_reports to service_role;
  end if;
end;
$$;
-- <<< END MIGRATION: active/138_add_status_probe_reports.sql

-- >>> BEGIN MIGRATION: active/139_add_status_heartbeat_history.sql
-- STATUS-001: Persist real heartbeat history for VPS probes and status endpoints.
create table if not exists public.status_probe_heartbeats (
  id bigint generated by default as identity primary key,
  probe_id text not null,
  label text not null,
  region text,
  status text not null default 'unknown',
  summary text,
  reported_at timestamptz not null,
  received_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_status_probe_heartbeats_probe_time
  on public.status_probe_heartbeats (probe_id, reported_at desc);

create index if not exists idx_status_probe_heartbeats_status_time
  on public.status_probe_heartbeats (status, reported_at desc);

create table if not exists public.status_endpoint_heartbeats (
  id bigint generated by default as identity primary key,
  endpoint_id text not null,
  label text not null,
  status text not null default 'unknown',
  summary text,
  checked_at timestamptz not null,
  response_ms integer,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_status_endpoint_heartbeats_endpoint_time
  on public.status_endpoint_heartbeats (endpoint_id, checked_at desc);

create index if not exists idx_status_endpoint_heartbeats_status_time
  on public.status_endpoint_heartbeats (status, checked_at desc);

create table if not exists public.status_alert_state (
  target_type text not null,
  target_id text not null,
  label text not null,
  status text not null default 'unknown',
  summary text,
  last_notified_status text,
  last_changed_at timestamptz not null default now(),
  last_notified_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (target_type, target_id)
);

create index if not exists idx_status_alert_state_status
  on public.status_alert_state (status);

alter table public.status_probe_heartbeats enable row level security;
alter table public.status_endpoint_heartbeats enable row level security;
alter table public.status_alert_state enable row level security;

revoke all on table public.status_probe_heartbeats from anon;
revoke all on table public.status_probe_heartbeats from authenticated;
revoke all on table public.status_endpoint_heartbeats from anon;
revoke all on table public.status_endpoint_heartbeats from authenticated;
revoke all on table public.status_alert_state from anon;
revoke all on table public.status_alert_state from authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.status_probe_heartbeats to service_role;
    grant select, insert, update, delete on table public.status_endpoint_heartbeats to service_role;
    grant select, insert, update, delete on table public.status_alert_state to service_role;
    grant usage, select on sequence public.status_probe_heartbeats_id_seq to service_role;
    grant usage, select on sequence public.status_endpoint_heartbeats_id_seq to service_role;
  end if;
end;
$$;
-- <<< END MIGRATION: active/139_add_status_heartbeat_history.sql

-- >>> BEGIN MIGRATION: active/140_create_game_platform_tables.sql
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
-- <<< END MIGRATION: active/140_create_game_platform_tables.sql

-- >>> BEGIN MIGRATION: active/141_create_game_currency_rpc.sql
-- 141: 小游戏货币增减 RPC
--
-- apply_game_currency_delta 在单事务内原子地：
--   1. upsert 钱包余额（balance / lifetime_earned / lifetime_spent）
--   2. 写一条不可变流水（game_currency_ledger）
-- 通过 p_idempotency_key 的唯一约束保证同一笔入账只生效一次（重复调用直接
-- 返回已有钱包状态，不重复加减）。
--
-- SECURITY DEFINER 绕过 RLS；仅授予 service_role（小游戏后端调用）。

CREATE OR REPLACE FUNCTION public.apply_game_currency_delta(
  p_user_id UUID,
  p_currency_code TEXT,
  p_amount BIGINT,
  p_reason TEXT DEFAULT 'unspecified',
  p_source_game_id TEXT DEFAULT NULL,
  p_source_event_id UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_meta JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  currency_code TEXT,
  balance BIGINT,
  lifetime_earned BIGINT,
  lifetime_spent BIGINT,
  ledger_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_ledger public.game_currency_ledger%ROWTYPE;
  v_wallet public.game_currency_wallets%ROWTYPE;
  v_earned_delta BIGINT := 0;
  v_spent_delta BIGINT := 0;
  v_new_ledger_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_currency_code IS NULL THEN
    RAISE EXCEPTION 'user id and currency code are required';
  END IF;

  -- 幂等：若该 key 已记账，直接返回当前钱包状态
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_ledger
    FROM public.game_currency_ledger
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
      SELECT * INTO v_wallet
      FROM public.game_currency_wallets
      WHERE user_id = p_user_id AND game_currency_wallets.currency_code = p_currency_code;

      currency_code := v_wallet.currency_code;
      balance := v_wallet.balance;
      lifetime_earned := v_wallet.lifetime_earned;
      lifetime_spent := v_wallet.lifetime_spent;
      ledger_id := v_existing_ledger.id;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  IF p_amount >= 0 THEN
    v_earned_delta := p_amount;
  ELSE
    v_spent_delta := -p_amount;
  END IF;

  -- upsert 钱包并锁行
  INSERT INTO public.game_currency_wallets AS w (
    user_id, currency_code, balance, lifetime_earned, lifetime_spent
  )
  VALUES (
    p_user_id,
    p_currency_code,
    GREATEST(0, p_amount),
    v_earned_delta,
    v_spent_delta
  )
  ON CONFLICT (user_id, currency_code) DO UPDATE
    SET balance = w.balance + p_amount,
        lifetime_earned = w.lifetime_earned + v_earned_delta,
        lifetime_spent = w.lifetime_spent + v_spent_delta,
        updated_at = NOW()
  RETURNING * INTO v_wallet;

  IF v_wallet.balance < 0 THEN
    RAISE EXCEPTION 'insufficient balance for user % currency %', p_user_id, p_currency_code;
  END IF;

  v_new_ledger_id := gen_random_uuid();
  INSERT INTO public.game_currency_ledger (
    id, user_id, currency_code, amount, reason,
    source_game_id, source_event_id, idempotency_key, balance_after, meta
  )
  VALUES (
    v_new_ledger_id, p_user_id, p_currency_code, p_amount, COALESCE(p_reason, 'unspecified'),
    p_source_game_id, p_source_event_id, p_idempotency_key, v_wallet.balance, COALESCE(p_meta, '{}'::jsonb)
  );

  currency_code := v_wallet.currency_code;
  balance := v_wallet.balance;
  lifetime_earned := v_wallet.lifetime_earned;
  lifetime_spent := v_wallet.lifetime_spent;
  ledger_id := v_new_ledger_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_game_currency_delta(UUID, TEXT, BIGINT, TEXT, TEXT, UUID, TEXT, JSONB) FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.apply_game_currency_delta(UUID, TEXT, BIGINT, TEXT, TEXT, UUID, TEXT, JSONB) TO service_role;
  END IF;
END $$;

COMMENT ON FUNCTION public.apply_game_currency_delta(UUID, TEXT, BIGINT, TEXT, TEXT, UUID, TEXT, JSONB) IS
  '原子货币增减：upsert 钱包 + 写不可变流水，按 idempotency_key 幂等。仅 service_role 调用。';
-- <<< END MIGRATION: active/141_create_game_currency_rpc.sql

-- >>> BEGIN MIGRATION: active/142_grant_game_backend_profile_reads.sql
-- 142: 确保小游戏后端 (service_role) 能读取 public_profiles
--
-- 小游戏站后端用 service_role 调 public_profiles 视图拼排行榜用户名。
-- public_profiles 是 security_invoker 视图（079），底层为 public_profile_cache。
-- 在自建实例上，service_role 默认对 public schema 拥有权限，但此处显式补授，
-- 保证跨实例 / 重置授权后仍可用。这是幂等的安全网，不改变既有对外行为。

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT ON public.public_profile_cache TO service_role;
    GRANT SELECT ON public.public_profiles TO service_role;
  END IF;
END $$;

-- 备注：拼图相关对象（puzzles 表、increment_puzzle_solve / review_puzzle /
-- update_puzzle_difficulty / delete_puzzle RPC）已由 archive/064-067 创建，
-- 自建实例已具备，本迁移无需重建。小游戏站后端通过 service_role 调用
-- increment_puzzle_solve，service_role 默认具备 EXECUTE 权限。
-- <<< END MIGRATION: active/142_grant_game_backend_profile_reads.sql

-- >>> BEGIN MIGRATION: active/143_seed_game_catalog.sql
-- 143: 小游戏目录初始 seed
--
-- 与 endfield-games/api/_lib/gameRules.js 的 FALLBACK_GAMES 白名单保持一致。
-- puzzle-protocol 为站内原生拼图（制作 + 游玩），reaction-grid 为轻量验证玩法。
-- 后续新玩法（UNO / 挖矿 / 放置）接入时在此追加，并同步 gameRules.js 白名单。

INSERT INTO public.game_catalog (game_id, title, summary, status, rules_version, sort_order, leaderboard_enabled)
VALUES
  ('puzzle-protocol', '拼图协议', '拼图创作、挑战和分享的统一入口。', 'active', 'v1', 10, TRUE),
  ('reaction-grid', '反应矩阵', '用于验证成绩提交与排行链路的轻量玩法。', 'active', 'v1', 20, TRUE)
ON CONFLICT (game_id) DO UPDATE
  SET title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      status = EXCLUDED.status,
      rules_version = EXCLUDED.rules_version,
      sort_order = EXCLUDED.sort_order,
      leaderboard_enabled = EXCLUDED.leaderboard_enabled,
      updated_at = NOW();
-- <<< END MIGRATION: active/143_seed_game_catalog.sql

-- >>> BEGIN MIGRATION: active/144_add_account_region_and_contributor_activity_stats.sql
-- 144: normalize account region metadata and expose contributor activity stats.
-- ACCOUNT-SERVER-001 first phase: keep history.server_id/region available and normalize region buckets.
-- STATS-006 first phase: add 90-day active/new contributor counts to cached global stats.

ALTER TABLE public.history
  ADD COLUMN IF NOT EXISTS server_id TEXT,
  ADD COLUMN IF NOT EXISTS region TEXT,
  ADD COLUMN IF NOT EXISTS is_free BOOLEAN,
  ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

-- Keep this migration lightweight for production: do not full-table backfill
-- history.region here. Readers below normalize server_id / region dynamically,
-- and new imports write normalized values at source.

CREATE INDEX IF NOT EXISTS idx_profiles_created_at
  ON public.profiles (created_at);

CREATE TABLE IF NOT EXISTS public.stats_cache (
  cache_key       TEXT PRIMARY KEY,
  cached_data     JSONB NOT NULL,
  row_fingerprint BIGINT NOT NULL DEFAULT 0,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stats_cache
  ADD COLUMN IF NOT EXISTS row_fingerprint BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS computed_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP FUNCTION IF EXISTS public.get_contributor_activity_stats(INT);

CREATE OR REPLACE FUNCTION public.get_contributor_activity_stats(
  p_window_days INT DEFAULT 90
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_days INT := GREATEST(COALESCE(p_window_days, 90), 1);
  v_active_users BIGINT := 0;
  v_new_users BIGINT := 0;
BEGIN
  SELECT COUNT(*)
    INTO v_active_users
    FROM (
      SELECT h.user_id
        FROM public.history AS h
       WHERE h.user_id IS NOT NULL
         AND h.pool_id IS NOT NULL
         AND h.special_type IS DISTINCT FROM 'gift'
         AND (h.is_free IS NOT TRUE)
         AND COALESCE(h.created_at, h.updated_at, h.timestamp) >= now() - make_interval(days => v_window_days)
       GROUP BY h.user_id
      HAVING COUNT(DISTINCT COALESCE(
        CASE
          WHEN h.pool_id::TEXT ~ '^(special|joint|extra|weponbox|weaponbox)_[0-9]+_[0-9]+'
          THEN regexp_replace(h.pool_id::TEXT, '^(special|joint|extra|weponbox|weaponbox)_([0-9]+)_([0-9]+).*$', 'v\2_\3')
          ELSE NULL
        END,
        h.pool_id::TEXT
      )) >= 2
    ) AS active_users;

  SELECT COUNT(*)
    INTO v_new_users
    FROM public.profiles AS p
   WHERE p.created_at >= now() - make_interval(days => v_window_days);

  RETURN jsonb_build_object(
    'windowDays', v_window_days,
    'activeUsers', COALESCE(v_active_users, 0),
    'newUsers', COALESCE(v_new_users, 0),
    'activeDefinition', '90日内至少两个版本有有效导入记录的用户',
    'newDefinition', '90日内首次使用站点的用户',
    'updatedAt', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_contributor_activity_stats(INT) TO anon, authenticated;

DELETE FROM public.stats_cache
WHERE cache_key IN ('global_stats', 'global_stats:v2', 'global_stats:v3', 'global_stats:v4');

CREATE OR REPLACE FUNCTION public.get_global_stats_cached(
  p_buffer_seconds INT DEFAULT 300
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count BIGINT;
  v_cached_data   JSONB;
  v_cached_fp     BIGINT;
  v_cached_at     TIMESTAMPTZ;
  v_result        JSON;
  v_result_data   JSONB;
  v_quota_data    JSONB;
  v_activity_data JSONB;
  v_region_data   JSONB;
  v_total_contributors BIGINT;
  v_max_ttl       INTERVAL := INTERVAL '24 hours';
  v_cache_key     TEXT := 'global_stats:v4';
BEGIN
  SELECT
    (SELECT count(*) FROM public.history)
    + ((SELECT count(*) FROM public.profiles) * 1000000000)
    INTO v_current_count;

  SELECT cached_data, row_fingerprint, computed_at
    INTO v_cached_data, v_cached_fp, v_cached_at
    FROM public.stats_cache
   WHERE cache_key = v_cache_key;

  IF v_cached_data IS NOT NULL THEN
    IF v_cached_fp = v_current_count
       AND v_cached_at + v_max_ttl > now() THEN
      RETURN v_cached_data::JSON;
    END IF;

    IF v_cached_fp <> v_current_count
       AND v_cached_at + (p_buffer_seconds || ' seconds')::INTERVAL > now() THEN
      RETURN v_cached_data::JSON;
    END IF;
  END IF;

  SELECT public.get_global_stats() INTO v_result;
  SELECT COALESCE(public.get_pool_type_quota_stats()::JSONB, '{}'::JSONB) INTO v_quota_data;
  SELECT COALESCE(public.get_contributor_activity_stats(90), '{}'::JSONB) INTO v_activity_data;
  SELECT
    COUNT(DISTINCT h.user_id),
    jsonb_build_object(
      'cn', COUNT(DISTINCT h.user_id) FILTER (
        WHERE h.server_id::TEXT = '1'
           OR lower(coalesce(h.region::TEXT, '')) IN ('cn', 'china', 'mainland')
           OR h.region::TEXT IN ('国服', '官服', 'B服', '大陆')
      ),
      'intl', COUNT(DISTINCT h.user_id) FILTER (
        WHERE h.server_id::TEXT IN ('2', '3')
           OR lower(coalesce(h.region::TEXT, '')) IN ('intl', 'international', 'global', 'asia', 'sea', 'eu', 'na', 'us', 'america')
           OR h.region::TEXT IN ('国际服', '亚服', '亚洲', '欧服', '美服', '欧美', '欧/美')
      ),
      'unknown', COUNT(DISTINCT h.user_id) FILTER (
        WHERE NOT (
          h.server_id::TEXT = '1'
          OR lower(coalesce(h.region::TEXT, '')) IN ('cn', 'china', 'mainland')
          OR h.region::TEXT IN ('国服', '官服', 'B服', '大陆')
          OR h.server_id::TEXT IN ('2', '3')
          OR lower(coalesce(h.region::TEXT, '')) IN ('intl', 'international', 'global', 'asia', 'sea', 'eu', 'na', 'us', 'america')
          OR h.region::TEXT IN ('国际服', '亚服', '亚洲', '欧服', '美服', '欧美', '欧/美')
        )
      )
    )
    INTO v_total_contributors, v_region_data
    FROM public.history AS h
   WHERE h.user_id IS NOT NULL
     AND h.special_type IS DISTINCT FROM 'gift'
     AND (h.is_free IS NOT TRUE);

  v_result_data := COALESCE(v_result::JSONB, '{}'::JSONB);
  v_result_data := jsonb_set(v_result_data, '{byType,extra,quotaSummary}', COALESCE(v_quota_data -> 'extra', '{}'::JSONB), true);
  v_result_data := jsonb_set(v_result_data, '{byType,limited,quotaSummary}', COALESCE(v_quota_data -> 'limited', '{}'::JSONB), true);
  v_result_data := jsonb_set(v_result_data, '{byType,standard,quotaSummary}', COALESCE(v_quota_data -> 'standard', '{}'::JSONB), true);
  v_result_data := jsonb_set(v_result_data, '{byType,weapon,quotaSummary}', COALESCE(v_quota_data -> 'weapon', '{}'::JSONB), true);
  v_result_data := jsonb_set(v_result_data, '{totalContributors}', to_jsonb(COALESCE(v_total_contributors, 0)), true);
  v_result_data := jsonb_set(v_result_data, '{contributorsByRegion}', COALESCE(v_region_data, '{}'::JSONB), true);
  v_result_data := jsonb_set(v_result_data, '{activeUsers90d}', to_jsonb(COALESCE((v_activity_data ->> 'activeUsers')::BIGINT, 0)), true);
  v_result_data := jsonb_set(v_result_data, '{newUsers90d}', to_jsonb(COALESCE((v_activity_data ->> 'newUsers')::BIGINT, 0)), true);
  v_result_data := jsonb_set(v_result_data, '{contributorActivity}', v_activity_data, true);
  v_result := v_result_data::JSON;

  INSERT INTO public.stats_cache (cache_key, cached_data, row_fingerprint, computed_at)
  VALUES (v_cache_key, v_result::JSONB, v_current_count, now())
  ON CONFLICT (cache_key) DO UPDATE SET
    cached_data     = EXCLUDED.cached_data,
    row_fingerprint = EXCLUDED.row_fingerprint,
    computed_at     = EXCLUDED.computed_at;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_global_stats_cached(INT) TO anon, authenticated;
-- <<< END MIGRATION: active/144_add_account_region_and_contributor_activity_stats.sql

-- >>> BEGIN MIGRATION: active/145_fix_global_stats_cache_timeout.sql
-- 145: restore global stats cache availability after contributor activity rollout.
--
-- Migration 144 added contributor activity fields but also changed the global
-- cache key and removed older global cache rows. On production-sized history
-- tables, the first uncached recomputation can hit statement_timeout and make
-- the Summary page unavailable. Keep the new fields, but make the cached RPC
-- resilient: reuse any recent global stats cache first, restore the longer
-- statement timeout, and degrade optional contributor fields instead of failing
-- the whole response.

CREATE INDEX IF NOT EXISTS idx_history_recent_contributor_activity
  ON public.history (user_id, pool_id, created_at, updated_at, timestamp)
  WHERE user_id IS NOT NULL
    AND pool_id IS NOT NULL
    AND special_type IS DISTINCT FROM 'gift'
    AND is_free IS NOT TRUE;

CREATE INDEX IF NOT EXISTS idx_history_contributor_region_bucket
  ON public.history (user_id, server_id, region)
  WHERE user_id IS NOT NULL
    AND special_type IS DISTINCT FROM 'gift'
    AND is_free IS NOT TRUE;

DROP FUNCTION IF EXISTS public.get_contributor_activity_stats(INT);

CREATE OR REPLACE FUNCTION public.get_contributor_activity_stats(
  p_window_days INT DEFAULT 90
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_days INT := GREATEST(COALESCE(p_window_days, 90), 1);
  v_active_users BIGINT := 0;
  v_new_users BIGINT := 0;
BEGIN
  SELECT COUNT(*)
    INTO v_active_users
    FROM (
      SELECT h.user_id
        FROM public.history AS h
       WHERE h.user_id IS NOT NULL
         AND h.pool_id IS NOT NULL
         AND h.special_type IS DISTINCT FROM 'gift'
         AND h.is_free IS NOT TRUE
         AND GREATEST(
           COALESCE(h.created_at, '-infinity'::TIMESTAMPTZ),
           COALESCE(h.updated_at, '-infinity'::TIMESTAMPTZ),
           COALESCE(h.timestamp, '-infinity'::TIMESTAMPTZ)
         ) >= now() - make_interval(days => v_window_days)
       GROUP BY h.user_id
      HAVING COUNT(DISTINCT COALESCE(
        CASE
          WHEN h.pool_id::TEXT ~ '^(special|joint|extra|weponbox|weaponbox)_[0-9]+_[0-9]+'
          THEN regexp_replace(h.pool_id::TEXT, '^(special|joint|extra|weponbox|weaponbox)_([0-9]+)_([0-9]+).*$', 'v\2_\3')
          ELSE NULL
        END,
        h.pool_id::TEXT
      )) >= 2
    ) AS active_users;

  SELECT COUNT(*)
    INTO v_new_users
    FROM public.profiles AS p
   WHERE p.created_at >= now() - make_interval(days => v_window_days);

  RETURN jsonb_build_object(
    'windowDays', v_window_days,
    'activeUsers', COALESCE(v_active_users, 0),
    'newUsers', COALESCE(v_new_users, 0),
    'activeDefinition', '90日内至少两个版本有有效导入记录的用户',
    'newDefinition', '90日内首次使用站点的用户',
    'updatedAt', now()
  );
EXCEPTION WHEN query_canceled THEN
  RETURN jsonb_build_object(
    'windowDays', v_window_days,
    'activeUsers', 0,
    'newUsers', 0,
    'degraded', TRUE,
    'degradedReason', 'statement_timeout',
    'updatedAt', now()
  );
END;
$$;

ALTER FUNCTION public.get_contributor_activity_stats(INT)
  SET statement_timeout = '30s';

GRANT EXECUTE ON FUNCTION public.get_contributor_activity_stats(INT) TO anon, authenticated;

ALTER FUNCTION public.get_global_stats()
  SET statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.get_global_stats_cached(
  p_buffer_seconds INT DEFAULT 300
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count BIGINT;
  v_cached_data   JSONB;
  v_cached_fp     BIGINT;
  v_cached_at     TIMESTAMPTZ;
  v_result        JSON;
  v_result_data   JSONB;
  v_quota_data    JSONB := '{}'::JSONB;
  v_activity_data JSONB := '{}'::JSONB;
  v_region_data   JSONB := '{}'::JSONB;
  v_total_contributors BIGINT := 0;
  v_max_ttl       INTERVAL := INTERVAL '24 hours';
  v_cache_key     TEXT := 'global_stats:v4';
BEGIN
  SELECT COUNT(*) INTO v_current_count FROM public.history;

  SELECT cached_data, row_fingerprint, computed_at
    INTO v_cached_data, v_cached_fp, v_cached_at
    FROM public.stats_cache
   WHERE cache_key = v_cache_key;

  IF v_cached_data IS NULL THEN
    SELECT cached_data, row_fingerprint, computed_at
      INTO v_cached_data, v_cached_fp, v_cached_at
      FROM public.stats_cache
     WHERE cache_key IN ('global_stats:v3', 'global_stats:v2', 'global_stats')
     ORDER BY computed_at DESC
     LIMIT 1;
  END IF;

  IF v_cached_data IS NOT NULL THEN
    IF v_cached_fp = v_current_count
       AND v_cached_at + v_max_ttl > now() THEN
      RETURN v_cached_data::JSON;
    END IF;

    IF v_cached_at + (p_buffer_seconds || ' seconds')::INTERVAL > now() THEN
      RETURN v_cached_data::JSON;
    END IF;
  END IF;

  BEGIN
    SELECT public.get_global_stats() INTO v_result;
  EXCEPTION WHEN query_canceled THEN
    IF v_cached_data IS NOT NULL THEN
      RETURN v_cached_data::JSON;
    END IF;

    RAISE;
  END;

  BEGIN
    SELECT COALESCE(public.get_pool_type_quota_stats()::JSONB, '{}'::JSONB) INTO v_quota_data;
  EXCEPTION WHEN query_canceled THEN
    v_quota_data := '{}'::JSONB;
  END;

  SELECT COALESCE(public.get_contributor_activity_stats(90), '{}'::JSONB) INTO v_activity_data;

  BEGIN
    SELECT
      COUNT(DISTINCT h.user_id),
      jsonb_build_object(
        'cn', COUNT(DISTINCT h.user_id) FILTER (
          WHERE h.server_id::TEXT = '1'
             OR lower(coalesce(h.region::TEXT, '')) IN ('cn', 'china', 'mainland')
             OR h.region::TEXT IN ('国服', '官服', 'B服', '大陆')
        ),
        'intl', COUNT(DISTINCT h.user_id) FILTER (
          WHERE h.server_id::TEXT IN ('2', '3')
             OR lower(coalesce(h.region::TEXT, '')) IN ('intl', 'international', 'global', 'asia', 'sea', 'eu', 'na', 'us', 'america')
             OR h.region::TEXT IN ('国际服', '亚服', '亚洲', '欧服', '美服', '欧美', '欧/美')
        ),
        'unknown', COUNT(DISTINCT h.user_id) FILTER (
          WHERE NOT (
            h.server_id::TEXT = '1'
            OR lower(coalesce(h.region::TEXT, '')) IN ('cn', 'china', 'mainland')
            OR h.region::TEXT IN ('国服', '官服', 'B服', '大陆')
            OR h.server_id::TEXT IN ('2', '3')
            OR lower(coalesce(h.region::TEXT, '')) IN ('intl', 'international', 'global', 'asia', 'sea', 'eu', 'na', 'us', 'america')
            OR h.region::TEXT IN ('国际服', '亚服', '亚洲', '欧服', '美服', '欧美', '欧/美')
          )
        )
      )
      INTO v_total_contributors, v_region_data
      FROM public.history AS h
     WHERE h.user_id IS NOT NULL
       AND h.special_type IS DISTINCT FROM 'gift'
       AND h.is_free IS NOT TRUE;
  EXCEPTION WHEN query_canceled THEN
    v_total_contributors := COALESCE((v_result::JSONB ->> 'totalUsers')::BIGINT, 0);
    v_region_data := '{}'::JSONB;
  END;

  v_result_data := COALESCE(v_result::JSONB, '{}'::JSONB);
  v_result_data := jsonb_set(v_result_data, '{byType,extra,quotaSummary}', COALESCE(v_quota_data -> 'extra', '{}'::JSONB), true);
  v_result_data := jsonb_set(v_result_data, '{byType,limited,quotaSummary}', COALESCE(v_quota_data -> 'limited', '{}'::JSONB), true);
  v_result_data := jsonb_set(v_result_data, '{byType,standard,quotaSummary}', COALESCE(v_quota_data -> 'standard', '{}'::JSONB), true);
  v_result_data := jsonb_set(v_result_data, '{byType,weapon,quotaSummary}', COALESCE(v_quota_data -> 'weapon', '{}'::JSONB), true);
  v_result_data := jsonb_set(v_result_data, '{totalContributors}', to_jsonb(COALESCE(v_total_contributors, 0)), true);
  v_result_data := jsonb_set(v_result_data, '{contributorsByRegion}', COALESCE(v_region_data, '{}'::JSONB), true);
  v_result_data := jsonb_set(v_result_data, '{activeUsers90d}', to_jsonb(COALESCE((v_activity_data ->> 'activeUsers')::BIGINT, 0)), true);
  v_result_data := jsonb_set(v_result_data, '{newUsers90d}', to_jsonb(COALESCE((v_activity_data ->> 'newUsers')::BIGINT, 0)), true);
  v_result_data := jsonb_set(v_result_data, '{contributorActivity}', v_activity_data, true);
  v_result := v_result_data::JSON;

  INSERT INTO public.stats_cache (cache_key, cached_data, row_fingerprint, computed_at)
  VALUES (v_cache_key, v_result::JSONB, v_current_count, now())
  ON CONFLICT (cache_key) DO UPDATE SET
    cached_data     = EXCLUDED.cached_data,
    row_fingerprint = EXCLUDED.row_fingerprint,
    computed_at     = EXCLUDED.computed_at;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_global_stats_cached(INT)
  SET statement_timeout = '120s';

GRANT EXECUTE ON FUNCTION public.get_global_stats_cached(INT) TO anon, authenticated;
-- <<< END MIGRATION: active/145_fix_global_stats_cache_timeout.sql

-- >>> BEGIN MIGRATION: active/146_switch_contributor_activity_to_30d.sql
-- 146: switch contributor activity stats from 90 days to 30 days.
-- STATS-006 follow-up: keep the same contributor activity definition, but use
-- a shorter activity window so the Summary page reflects recent usage better.

DROP FUNCTION IF EXISTS public.get_contributor_activity_stats(INT);

CREATE OR REPLACE FUNCTION public.get_contributor_activity_stats(
  p_window_days INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_days INT := GREATEST(COALESCE(p_window_days, 30), 1);
  v_active_users BIGINT := 0;
  v_new_users BIGINT := 0;
BEGIN
  SELECT COUNT(*)
    INTO v_active_users
    FROM (
      SELECT h.user_id
        FROM public.history AS h
       WHERE h.user_id IS NOT NULL
         AND h.pool_id IS NOT NULL
         AND h.special_type IS DISTINCT FROM 'gift'
         AND h.is_free IS NOT TRUE
         AND GREATEST(
           COALESCE(h.created_at, '-infinity'::TIMESTAMPTZ),
           COALESCE(h.updated_at, '-infinity'::TIMESTAMPTZ),
           COALESCE(h.timestamp, '-infinity'::TIMESTAMPTZ)
         ) >= now() - make_interval(days => v_window_days)
       GROUP BY h.user_id
      HAVING COUNT(DISTINCT COALESCE(
        CASE
          WHEN h.pool_id::TEXT ~ '^(special|joint|extra|weponbox|weaponbox)_[0-9]+_[0-9]+'
          THEN regexp_replace(h.pool_id::TEXT, '^(special|joint|extra|weponbox|weaponbox)_([0-9]+)_([0-9]+).*$', 'v\2_\3')
          ELSE NULL
        END,
        h.pool_id::TEXT
      )) >= 2
    ) AS active_users;

  SELECT COUNT(*)
    INTO v_new_users
    FROM public.profiles AS p
   WHERE p.created_at >= now() - make_interval(days => v_window_days);

  RETURN jsonb_build_object(
    'windowDays', v_window_days,
    'activeUsers', COALESCE(v_active_users, 0),
    'newUsers', COALESCE(v_new_users, 0),
    'activeDefinition', '30日内至少两个版本有有效导入记录的用户',
    'newDefinition', '30日内首次使用站点的用户',
    'updatedAt', now()
  );
EXCEPTION WHEN query_canceled THEN
  RETURN jsonb_build_object(
    'windowDays', v_window_days,
    'activeUsers', 0,
    'newUsers', 0,
    'degraded', TRUE,
    'degradedReason', 'statement_timeout',
    'updatedAt', now()
  );
END;
$$;

ALTER FUNCTION public.get_contributor_activity_stats(INT)
  SET statement_timeout = '30s';

GRANT EXECUTE ON FUNCTION public.get_contributor_activity_stats(INT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_global_stats_cached(
  p_buffer_seconds INT DEFAULT 300
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count BIGINT;
  v_cached_data   JSONB;
  v_cached_fp     BIGINT;
  v_cached_at     TIMESTAMPTZ;
  v_result        JSON;
  v_result_data   JSONB;
  v_quota_data    JSONB := '{}'::JSONB;
  v_activity_data JSONB := '{}'::JSONB;
  v_region_data   JSONB := '{}'::JSONB;
  v_total_contributors BIGINT := 0;
  v_max_ttl       INTERVAL := INTERVAL '24 hours';
  v_cache_key     TEXT := 'global_stats:v5';
  v_cached_has_activity_30d BOOLEAN := FALSE;
BEGIN
  SELECT COUNT(*) INTO v_current_count FROM public.history;

  SELECT cached_data, row_fingerprint, computed_at
    INTO v_cached_data, v_cached_fp, v_cached_at
    FROM public.stats_cache
   WHERE cache_key = v_cache_key;

  IF v_cached_data IS NULL THEN
    SELECT cached_data, row_fingerprint, computed_at
      INTO v_cached_data, v_cached_fp, v_cached_at
      FROM public.stats_cache
     WHERE cache_key IN ('global_stats:v4', 'global_stats:v3', 'global_stats:v2', 'global_stats')
     ORDER BY computed_at DESC
     LIMIT 1;
  END IF;

  v_cached_has_activity_30d := v_cached_data ? 'activeUsers30d'
    AND v_cached_data ? 'newUsers30d';

  IF v_cached_data IS NOT NULL AND v_cached_has_activity_30d THEN
    IF v_cached_fp = v_current_count
       AND v_cached_at + v_max_ttl > now() THEN
      RETURN v_cached_data::JSON;
    END IF;

    IF v_cached_at + (p_buffer_seconds || ' seconds')::INTERVAL > now() THEN
      RETURN v_cached_data::JSON;
    END IF;
  END IF;

  BEGIN
    SELECT public.get_global_stats() INTO v_result;
  EXCEPTION WHEN query_canceled THEN
    IF v_cached_data IS NOT NULL THEN
      RETURN v_cached_data::JSON;
    END IF;

    RAISE;
  END;

  BEGIN
    SELECT COALESCE(public.get_pool_type_quota_stats()::JSONB, '{}'::JSONB) INTO v_quota_data;
  EXCEPTION WHEN query_canceled THEN
    v_quota_data := '{}'::JSONB;
  END;

  SELECT COALESCE(public.get_contributor_activity_stats(30), '{}'::JSONB) INTO v_activity_data;

  BEGIN
    SELECT
      COUNT(DISTINCT h.user_id),
      jsonb_build_object(
        'cn', COUNT(DISTINCT h.user_id) FILTER (
          WHERE h.server_id::TEXT = '1'
             OR lower(coalesce(h.region::TEXT, '')) IN ('cn', 'china', 'mainland')
             OR h.region::TEXT IN ('国服', '官服', 'B服', '大陆')
        ),
        'intl', COUNT(DISTINCT h.user_id) FILTER (
          WHERE h.server_id::TEXT IN ('2', '3')
             OR lower(coalesce(h.region::TEXT, '')) IN ('intl', 'international', 'global', 'asia', 'sea', 'eu', 'na', 'us', 'america')
             OR h.region::TEXT IN ('国际服', '亚服', '亚洲', '欧服', '美服', '欧美', '欧/美')
        ),
        'unknown', COUNT(DISTINCT h.user_id) FILTER (
          WHERE NOT (
            h.server_id::TEXT = '1'
            OR lower(coalesce(h.region::TEXT, '')) IN ('cn', 'china', 'mainland')
            OR h.region::TEXT IN ('国服', '官服', 'B服', '大陆')
            OR h.server_id::TEXT IN ('2', '3')
            OR lower(coalesce(h.region::TEXT, '')) IN ('intl', 'international', 'global', 'asia', 'sea', 'eu', 'na', 'us', 'america')
            OR h.region::TEXT IN ('国际服', '亚服', '亚洲', '欧服', '美服', '欧美', '欧/美')
          )
        )
      )
      INTO v_total_contributors, v_region_data
      FROM public.history AS h
     WHERE h.user_id IS NOT NULL
       AND h.special_type IS DISTINCT FROM 'gift'
       AND h.is_free IS NOT TRUE;
  EXCEPTION WHEN query_canceled THEN
    v_total_contributors := COALESCE((v_result::JSONB ->> 'totalUsers')::BIGINT, 0);
    v_region_data := '{}'::JSONB;
  END;

  v_result_data := COALESCE(v_result::JSONB, '{}'::JSONB);
  v_result_data := jsonb_set(v_result_data, '{byType,extra,quotaSummary}', COALESCE(v_quota_data -> 'extra', '{}'::JSONB), true);
  v_result_data := jsonb_set(v_result_data, '{byType,limited,quotaSummary}', COALESCE(v_quota_data -> 'limited', '{}'::JSONB), true);
  v_result_data := jsonb_set(v_result_data, '{byType,standard,quotaSummary}', COALESCE(v_quota_data -> 'standard', '{}'::JSONB), true);
  v_result_data := jsonb_set(v_result_data, '{byType,weapon,quotaSummary}', COALESCE(v_quota_data -> 'weapon', '{}'::JSONB), true);
  v_result_data := jsonb_set(v_result_data, '{totalContributors}', to_jsonb(COALESCE(v_total_contributors, 0)), true);
  v_result_data := jsonb_set(v_result_data, '{contributorsByRegion}', COALESCE(v_region_data, '{}'::JSONB), true);
  v_result_data := jsonb_set(v_result_data, '{activeUsers30d}', to_jsonb(COALESCE((v_activity_data ->> 'activeUsers')::BIGINT, 0)), true);
  v_result_data := jsonb_set(v_result_data, '{newUsers30d}', to_jsonb(COALESCE((v_activity_data ->> 'newUsers')::BIGINT, 0)), true);
  v_result_data := jsonb_set(v_result_data, '{contributorActivity}', v_activity_data, true);
  v_result := v_result_data::JSON;

  INSERT INTO public.stats_cache (cache_key, cached_data, row_fingerprint, computed_at)
  VALUES (v_cache_key, v_result::JSONB, v_current_count, now())
  ON CONFLICT (cache_key) DO UPDATE SET
    cached_data     = EXCLUDED.cached_data,
    row_fingerprint = EXCLUDED.row_fingerprint,
    computed_at     = EXCLUDED.computed_at;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_global_stats_cached(INT)
  SET statement_timeout = '120s';

GRANT EXECUTE ON FUNCTION public.get_global_stats_cached(INT) TO anon, authenticated;
-- <<< END MIGRATION: active/146_switch_contributor_activity_to_30d.sql

-- >>> BEGIN MIGRATION: active/147_scope_history_unique_key_by_server.sql
-- 147: scope account history uniqueness by server.
-- ACCOUNT-SERVER-001: allow the same game UID / pool / seq to exist separately per server.

ALTER TABLE public.history
  ADD COLUMN IF NOT EXISTS server_scope TEXT
  GENERATED ALWAYS AS (COALESCE(NULLIF(btrim(server_id), ''), 'legacy')) STORED;

-- Defensive cleanup for environments that may have lost the older unique constraint.
DELETE FROM public.history AS h
WHERE h.id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, game_uid, server_scope, pool_id, seq_id
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
      ) AS rn
    FROM public.history
    WHERE user_id IS NOT NULL
      AND game_uid IS NOT NULL
      AND pool_id IS NOT NULL
      AND seq_id IS NOT NULL
  ) AS ranked
  WHERE ranked.rn > 1
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.history'::regclass
      AND conname = 'history_user_game_server_scope_pool_seq_unique'
  ) THEN
    ALTER TABLE public.history
      ADD CONSTRAINT history_user_game_server_scope_pool_seq_unique
      UNIQUE (user_id, game_uid, server_scope, pool_id, seq_id);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.history'::regclass
      AND conname = 'history_user_game_pool_seq_unique'
  ) THEN
    ALTER TABLE public.history
      DROP CONSTRAINT history_user_game_pool_seq_unique;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.history'::regclass
      AND conname = 'history_user_game_seq_unique'
  ) THEN
    ALTER TABLE public.history
      DROP CONSTRAINT history_user_game_seq_unique;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.history'::regclass
      AND conname = 'history_user_id_game_uid_seq_id_key'
  ) THEN
    ALTER TABLE public.history
      DROP CONSTRAINT history_user_id_game_uid_seq_id_key;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_history_user_game_server_scope
  ON public.history (user_id, game_uid, server_scope);

COMMENT ON COLUMN public.history.server_scope IS
  '账号区服唯一性范围；server_id 为空的旧记录使用 legacy。';

COMMENT ON CONSTRAINT history_user_game_server_scope_pool_seq_unique ON public.history IS
  '同一用户、同一游戏账号、同一区服、同一卡池、同一 seq_id 不重复。';

NOTIFY pgrst, 'reload schema';
-- <<< END MIGRATION: active/147_scope_history_unique_key_by_server.sql

-- >>> BEGIN MIGRATION: active/148_seed_uno_catalog.sql
-- 148: 小游戏目录追加 uno-protocol（协议对决）
--
-- 与 endfield-games/api/_lib/gameRules.js 的 FALLBACK_GAMES 白名单保持一致。
-- 类 UNO 卡牌对战（单人对 AI），含 7 条可选规则与「源石技艺·干员协议 / 法术异常」场外玩法。

INSERT INTO public.game_catalog (game_id, title, summary, status, rules_version, sort_order, leaderboard_enabled)
VALUES
  ('uno-protocol', '协议对决', '类 UNO 卡牌对战，含可选规则与源石技艺·法术异常场外玩法。', 'active', 'v1', 30, TRUE)
ON CONFLICT (game_id) DO UPDATE
  SET title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      status = EXCLUDED.status,
      rules_version = EXCLUDED.rules_version,
      sort_order = EXCLUDED.sort_order,
      leaderboard_enabled = EXCLUDED.leaderboard_enabled,
      updated_at = NOW();
-- <<< END MIGRATION: active/148_seed_uno_catalog.sql

-- >>> BEGIN MIGRATION: active/149_create_game_saves_and_aic_catalog.sql
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
-- <<< END MIGRATION: active/149_create_game_saves_and_aic_catalog.sql

