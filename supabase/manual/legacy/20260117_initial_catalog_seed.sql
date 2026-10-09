-- ============================================
-- 终末地抽卡分析器 - 初始数据导入 SQL
-- 生成日期: 2026-01-17
-- 数据来源: src/components/home/HomePage.jsx + constants/index.js
-- 当前用途: 仅供 generate-legacy-id-alias-seed.mjs 对照早期 ID，或追溯旧目录。
-- 已退役: 不作为新环境初始化、前向迁移或生产回填入口，不直接执行。
-- 新环境 schema 以 supabase/baseline/000_complete_schema.sql 为准。
-- 原路径: supabase/初始数据导入.sql；2026-10-09 移入 manual/legacy。
-- ============================================

-- ============================================
-- 1. 插入角色数据 (characters 表)
-- ============================================
-- 注意：如果角色已存在（ID冲突），则跳过
INSERT INTO public.characters (id, name, rarity, type, is_limited, aliases, avatar_url) VALUES
  -- === 6星限定角色（按轮换顺序）===
  ('char_levantin', '莱万汀', 6, 'character', true,
   ARRAY['莱万丁', 'Levantin', 'LWT', 'lwt', '42'],
   NULL),

  ('char_jerpeta', '洁尔佩塔', 6, 'character', true,
   ARRAY['Jerpeta', 'Gerpeta', 'JEPT', 'jept', '洁尔', '杰尔佩塔','杰哥'],
   NULL),

  ('char_yiwen', '伊冯', 6, 'character', true,
   ARRAY['Yiwen', 'Ivan', '伊文', 'YW', 'yw', '伊万'],
   NULL),

  -- === 6星常驻角色（可在限定池歪）===
  ('char_eldelra', '艾尔黛拉', 6, 'character', false,
   ARRAY['Eldelra', 'aedr', 'AEDR', '小羊', '羊', 'eld'],
   NULL),

  ('char_junwei', '骏卫', 6, 'character', false,
   ARRAY['Junwei', 'JW', 'jw', '马'],
   NULL),

  ('char_bieli', '别礼', 6, 'character', false,
   ARRAY['Bieli', 'BL', 'bl', '别离'],
   NULL),

  ('char_yujin', '余烬', 6, 'character', false,
   ARRAY['Yujin', 'YJ', 'yj', '余进'],
   NULL),

  ('char_lifeng', '黎风', 6, 'character', false,
   ARRAY['Lifeng', 'LF', 'lf', '黎凤'],
   NULL),

  -- === 5星角色 ===
  ('char_perika', '佩丽卡', 5, 'character', false,
   ARRAY['Perika', 'plk', 'PLK'],
   NULL),

  ('char_huguang', '弧光', 5, 'character', false,
   ARRAY['Huguang', 'hg', 'HG'],
   NULL),

  ('char_aiweiwen', '艾维文娜', 5, 'character', false,
   ARRAY['Aiweiwenna', 'awwn', 'AWWN', '艾薇'],
   NULL),

  ('char_dapan', '大潘', 5, 'character', false,
   ARRAY['Dapan', 'dp', 'DP', '潘'],
   NULL),

  ('char_chenqianyu', '陈千语', 5, 'character', false,
   ARRAY['Chen Qianyu', 'cqy', 'CQY', '千语'],
   NULL),

  ('char_langwei', '狼卫', 5, 'character', false,
   ARRAY['Langwei', 'lw', 'LW', '狼'],
   NULL),

  ('char_saixi', '赛希', 5, 'character', false,
   ARRAY['Saixi', 'sx', 'SX'],
   NULL),

  ('char_zhouxue', '昼雪', 5, 'character', false,
   ARRAY['Zhouxue', 'zx', 'ZX', '昼学'],
   NULL),

  ('char_aliesha', '阿列什', 5, 'character', false,
   ARRAY['Aliesha', 'als', 'ALS'],
   NULL),

  -- === 4星角色 ===
  ('char_qiuli', '秋栗', 4, 'character', false,
   ARRAY['Qiuli', 'ql', 'QL'],
   NULL),

  ('char_kaqi', '卡契尔', 4, 'character', false,
   ARRAY['Kaqier', 'kqe', 'KQE', '卡奇'],
   NULL),

  ('char_aitela', '埃特拉', 4, 'character', false,
   ARRAY['Aitela', 'atl', 'ATL'],
   NULL),

  ('char_yingshi', '萤石', 4, 'character', false,
   ARRAY['Yingshi', 'ys', 'YS'],
   NULL),

  ('char_antaer', '安塔尔', 4, 'character', false,
   ARRAY['Antaer', 'ate', 'ATE'],
   NULL),

  -- === 6星武器（示例，可根据实际补充）===
  ('weapon_levantin_sig', '莱万汀专武', 6, 'weapon', true,
   ARRAY['Levantin Weapon', 'lwt专武', '42专武'],
   NULL),

  ('weapon_jerpeta_sig', '洁尔佩塔专武', 6, 'weapon', true,
   ARRAY['Jerpeta Weapon', 'jept专武', '洁哥专武'],
   NULL),

  ('weapon_yiwen_sig', '伊冯专武', 6, 'weapon', true,
   ARRAY['Yiwen Weapon', 'yw专武', '伊万专武'],
   NULL),

  ('weapon_eldelra_sig', '艾尔黛拉专武', 6, 'weapon', false,
   ARRAY['Eldelra Weapon', 'aedr专武', '小羊专武'],
   NULL)

ON CONFLICT (id) DO NOTHING;

-- 验证角色插入
DO $$
DECLARE
  character_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO character_count FROM public.characters;
  RAISE NOTICE '✅ 角色数据导入完成，当前总数: %', character_count;
END $$;


-- ============================================
-- 2. 示例卡池数据 (pools 表)
-- ============================================
-- 注意：这里需要使用真实的超管 user_id
-- 执行前会自动获取第一个超管 UUID

DO $$
DECLARE
  admin_uuid UUID;
BEGIN
  -- 自动获取第一个超管 UUID
  SELECT id INTO admin_uuid FROM public.profiles WHERE role = 'super_admin' LIMIT 1;

  IF admin_uuid IS NULL THEN
    RAISE EXCEPTION '❌ 未找到超管账号，请先创建超管用户';
  END IF;

  -- 插入卡池数据
  INSERT INTO public.pools (
    user_id, pool_id, name, type, locked,
    up_character, description, banner_url,
    start_time, end_time, featured_characters, is_limited_weapon
  ) VALUES
    -- === 限定角色池（按轮换顺序）===
    -- 莱万汀限定池（第一期，3次后移出）
    (
      admin_uuid,
      'pool_limited_levantin',
      '限定-莱万汀',
      'limited',
      true,  -- 锁定公共池
      '莱万汀',
      '莱万汀限定UP池 - 公测第一期（3次轮换后移出卡池）',
      NULL,  -- Banner URL 待补充
      '2026-01-22 11:00:00+08'::TIMESTAMPTZ,
      '2026-02-07 11:59:59+08'::TIMESTAMPTZ,
      ARRAY['char_levantin'],
      NULL
    ),

    -- 洁尔佩塔限定池（第二期，5次后移出）
    (
      admin_uuid,
      'pool_limited_jerpeta',
      '限定-洁尔佩塔',
      'limited',
      true,
      '洁尔佩塔',
      '洁尔佩塔限定UP池 - 公测第二期（5次轮换后移出卡池）',
      NULL,
      '2026-02-07 12:00:00+08'::TIMESTAMPTZ,
      '2026-02-24 11:59:59+08'::TIMESTAMPTZ,
      ARRAY['char_jerpeta'],
      NULL
    ),

    -- 伊冯限定池（第三期，4次后移出）
    (
      admin_uuid,
      'pool_limited_yiwen',
      '限定-伊冯',
      'limited',
      true,
      '伊冯',
      '伊冯限定UP池 - 公测第三期（4次轮换后移出卡池）',
      NULL,
      '2026-02-24 12:00:00+08'::TIMESTAMPTZ,
      '2026-03-31 23:59:59+08'::TIMESTAMPTZ,
      ARRAY['char_yiwen'],
      NULL
    ),

    -- === 常驻角色池 ===
    (
      admin_uuid,
      'pool_standard_main',
      '常驻角色池',
      'standard',
      true,
      NULL,
      '常驻角色池 - 包含所有常驻6星角色（艾尔黛拉、骏卫、别礼、余烬、黎风）',
      NULL,
      NULL,
      NULL,
      ARRAY['char_eldelra', 'char_junwei', 'char_bieli', 'char_yujin', 'char_lifeng'],
      NULL
    ),

    -- === 限定武器池 ===
    -- 莱万汀武器池
    (
      admin_uuid,
      'pool_weapon_levantin',
      '武器-莱万汀',
      'weapon',
      true,
      '莱万汀专武',
      '莱万汀专属武器池',
      NULL,
      '2026-01-22 11:00:00+08'::TIMESTAMPTZ,
      '2026-02-07 11:59:59+08'::TIMESTAMPTZ,
      ARRAY['weapon_levantin_sig'],
      true  -- 是限定武器池
    ),

    -- 洁尔佩塔武器池
    (
      admin_uuid,
      'pool_weapon_jerpeta',
      '武器-洁尔佩塔',
      'weapon',
      true,
      '洁尔佩塔专武',
      '洁尔佩塔专属武器池',
      NULL,
      '2026-02-07 12:00:00+08'::TIMESTAMPTZ,
      '2026-02-24 11:59:59+08'::TIMESTAMPTZ,
      ARRAY['weapon_jerpeta_sig'],
      true
    ),

    -- 伊冯武器池
    (
      admin_uuid,
      'pool_weapon_yiwen',
      '武器-伊冯',
      'weapon',
      true,
      '伊冯专武',
      '伊冯专属武器池',
      NULL,
      '2026-02-24 12:00:00+08'::TIMESTAMPTZ,
      '2026-03-31 23:59:59+08'::TIMESTAMPTZ,
      ARRAY['weapon_yiwen_sig'],
      true
    ),

    -- === 新手池（可选）===
    (
      admin_uuid,
      'pool_newbie',
      '新手池',
      'standard',
      true,
      NULL,
      '新手池 - 前40抽必出6星，仅可抽取40次',
      NULL,
      '2026-01-22 11:00:00+08'::TIMESTAMPTZ,
      NULL,  -- 永久开放
      ARRAY['char_eldelra', 'char_junwei', 'char_bieli', 'char_yujin', 'char_lifeng'],
      NULL
    )

  ON CONFLICT (user_id, pool_id) DO NOTHING;

  RAISE NOTICE '✅ 卡池数据导入完成，超管 UUID: %', admin_uuid;
END $$;


-- ============================================
-- 3. 验证导入结果
-- ============================================
DO $$
DECLARE
  char_count INTEGER;
  pool_count INTEGER;
  six_star_count INTEGER;
  five_star_count INTEGER;
  four_star_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO char_count FROM public.characters;
  SELECT COUNT(*) INTO pool_count FROM public.pools;
  SELECT COUNT(*) INTO six_star_count FROM public.characters WHERE rarity = 6;
  SELECT COUNT(*) INTO five_star_count FROM public.characters WHERE rarity = 5;
  SELECT COUNT(*) INTO four_star_count FROM public.characters WHERE rarity = 4;

  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ 数据导入验证';
  RAISE NOTICE '角色总数: % (6星: % | 5星: % | 4星: %)', char_count, six_star_count, five_star_count, four_star_count;
  RAISE NOTICE '卡池总数: %', pool_count;
  RAISE NOTICE '========================================';

  IF char_count = 0 THEN
    RAISE WARNING '⚠️ 角色数据为空，可能导入失败';
  END IF;

  IF pool_count = 0 THEN
    RAISE WARNING '⚠️ 卡池数据为空，请检查是否有超管账号';
  END IF;
END $$;

-- ============================================
-- 4. 查看导入结果（可选 - 取消注释查看）
-- ============================================
-- 查看所有角色（按稀有度和名称排序）
-- SELECT id, name, rarity, type, is_limited, aliases FROM public.characters ORDER BY rarity DESC, type, name;

-- 查看所有卡池
-- SELECT pool_id, name, type, up_character, start_time, end_time, description FROM public.pools ORDER BY type, start_time;

-- 查看6星角色列表
-- SELECT name, type, is_limited FROM public.characters WHERE rarity = 6 ORDER BY is_limited DESC, type, name;
