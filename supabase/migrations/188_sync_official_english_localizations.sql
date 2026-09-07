-- 188: sync official English names for the live game catalog.
--
-- Sources checked on 2026-09-05:
-- - GRYPHLINE English version update notes and official social posts
-- - The English App Store release notes published by GRYPHLINE
-- - Warfarin Wiki's paired Chinese/English operator and weapon catalogs

BEGIN;

WITH official_entity_names(entity_id, entity_type, zh_name, en_name) AS (
  VALUES
    ('chr_0004_pelica', 'character', '佩丽卡', 'Perlica'),
    ('chr_0005_chen', 'character', '陈千语', 'Chen Qianyu'),
    ('chr_0006_wolfgd', 'character', '狼卫', 'Wulfgard'),
    ('chr_0007_ikut', 'character', '弧光', 'Arclight'),
    ('chr_0009_azrila', 'character', '余烬', 'Ember'),
    ('chr_0011_seraph', 'character', '赛希', 'Xaihi'),
    ('chr_0012_avywen', 'character', '艾维文娜', 'Avywenna'),
    ('chr_0013_aglina', 'character', '洁尔佩塔', 'Gilberta'),
    ('chr_0014_aurora', 'character', '昼雪', 'Snowshine'),
    ('chr_0015_lifeng', 'character', '黎风', 'Lifeng'),
    ('chr_0016_laevat', 'character', '莱万汀', 'Laevatain'),
    ('chr_0017_yvonne', 'character', '伊冯', 'Yvonne'),
    ('chr_0018_dapan', 'character', '大潘', 'Da Pan'),
    ('chr_0019_karin', 'character', '秋栗', 'Akekuri'),
    ('chr_0020_meurs', 'character', '卡契尔', 'Catcher'),
    ('chr_0021_whiten', 'character', '埃特拉', 'Estella'),
    ('chr_0022_bounda', 'character', '萤石', 'Fluorite'),
    ('chr_0023_antal', 'character', '安塔尔', 'Antal'),
    ('chr_0024_deepfin', 'character', '阿列什', 'Alesh'),
    ('chr_0025_ardelia', 'character', '艾尔黛拉', 'Ardelia'),
    ('chr_0026_lastrite', 'character', '别礼', 'Last Rite'),
    ('chr_0027_tangtang', 'character', '汤汤', 'Tangtang'),
    ('chr_0028_wulfa', 'character', '洛茜', 'Rossi'),
    ('chr_0029_pograni', 'character', '骏卫', 'Pogranichnik'),
    ('chr_0030_zhuangfy', 'character', '庄方宜', 'Zhuang Fangyi'),
    ('chr_0031_mifu', 'character', '弭弗', 'Mi Fu'),
    ('chr_0032_lizhiyan', 'character', '诀', 'Arcane'),
    ('chr_0033_camille', 'character', '卡缪', 'Camille'),
    ('chr_0034_typhoea', 'character', '提弗洛斯', 'Typhoeus'),
    ('chr_0035_liino', 'character', '梨诺', 'Liino'),
    ('wpn_claym_0003', 'weapon', '工业零点一', 'Industry 0.1'),
    ('wpn_claym_0004', 'weapon', '典范', 'Exemplar'),
    ('wpn_claym_0006', 'weapon', '昔日精品', 'Former Finery'),
    ('wpn_claym_0007', 'weapon', '大雷斑', 'Thunderberge'),
    ('wpn_claym_0008', 'weapon', '破碎君王', 'Sundered Prince'),
    ('wpn_claym_0009', 'weapon', '淬火者', 'Quencher'),
    ('wpn_claym_0010', 'weapon', '达尔霍夫7', 'Darhoff 7'),
    ('wpn_claym_0011', 'weapon', '探骊', 'Seeker of Dark Lung'),
    ('wpn_claym_0012', 'weapon', '终点之声', 'Finishing Call'),
    ('wpn_claym_0013', 'weapon', '赫拉芬格', 'Khravengger'),
    ('wpn_claym_0014', 'weapon', '古渠', 'Ancient Canal'),
    ('wpn_claym_0015', 'weapon', 'O.B.J.重荷', 'OBJ Heavy Burden'),
    ('wpn_claym_0017', 'weapon', '赤缨', 'Amaranthine Tassel'),
    ('wpn_funnel_0001', 'weapon', '全自动骇新星', 'Hypernova Auto'),
    ('wpn_funnel_0002', 'weapon', '吉米尼12', 'Jiminy 12'),
    ('wpn_funnel_0003', 'weapon', '荧光雷羽', 'Fluorescent Roc'),
    ('wpn_funnel_0004', 'weapon', '迷失荒野', 'Wild Wanderer'),
    ('wpn_funnel_0005', 'weapon', '悼亡诗', 'Stanza of Memorials'),
    ('wpn_funnel_0006', 'weapon', '作品：蚀迹', 'Opus: Etch Figure'),
    ('wpn_funnel_0007', 'weapon', '莫奈何', 'Monaihe'),
    ('wpn_funnel_0008', 'weapon', '爆破单元', 'Detonation Unit'),
    ('wpn_funnel_0009', 'weapon', '遗忘', 'Oblivion'),
    ('wpn_funnel_0010', 'weapon', '骑士精神', 'Chivalric Virtues'),
    ('wpn_funnel_0011', 'weapon', '使命必达', 'Delivery Guaranteed'),
    ('wpn_funnel_0012', 'weapon', '布道自由', 'Freedom to Proselytize'),
    ('wpn_funnel_0013', 'weapon', '沧溟星梦', 'Dreams of the Starry Beach'),
    ('wpn_funnel_0014', 'weapon', 'O.B.J.术识', 'OBJ Arts Identifier'),
    ('wpn_funnel_0015', 'weapon', '孤舟', 'Lone Barge'),
    ('wpn_funnel_0016', 'weapon', '四二式·肃阵', 'Type 42: Solemn Phalanx'),
    ('wpn_funnel_0019', 'weapon', '寒夜幽影', 'Umbra of Frigid Eventide'),
    ('wpn_lance_0003', 'weapon', '寻路者道标', 'Pathfinder''s Beacon'),
    ('wpn_lance_0004', 'weapon', '嵌合正义', 'Chimeric Justice'),
    ('wpn_lance_0006', 'weapon', '向心之引', 'Cohesive Traction'),
    ('wpn_lance_0008', 'weapon', '天使杀手', 'Aggeloslayer'),
    ('wpn_lance_0009', 'weapon', '奥佩罗77', 'Opero 77'),
    ('wpn_lance_0010', 'weapon', '骁勇', 'Valiant'),
    ('wpn_lance_0011', 'weapon', 'J.E.T.', 'JET'),
    ('wpn_lance_0012', 'weapon', '负山', 'Mountain Bearer'),
    ('wpn_lance_0013', 'weapon', 'O.B.J.尖峰', 'OBJ Razorhorn'),
    ('wpn_lance_0014', 'weapon', '曜夜的首演', 'Bedazzling Night Debut'),
    ('wpn_lance_0015', 'weapon', '镀红祝福', 'Blessing of Lustrous Carmine'),
    ('wpn_pistol_0001', 'weapon', '佩科5', 'Peco 5'),
    ('wpn_pistol_0002', 'weapon', '呼啸守卫', 'Howling Guard'),
    ('wpn_pistol_0003', 'weapon', '长路', 'Long Road'),
    ('wpn_pistol_0004', 'weapon', '理性告别', 'Rational Farewell'),
    ('wpn_pistol_0005', 'weapon', '领航者', 'Navigator'),
    ('wpn_pistol_0006', 'weapon', '作品：众生', 'Opus: The Living'),
    ('wpn_pistol_0007', 'weapon', '望乡', 'Home Longing'),
    ('wpn_pistol_0008', 'weapon', '楔子', 'Wedge'),
    ('wpn_pistol_0009', 'weapon', '同类相食', 'Clannibal'),
    ('wpn_pistol_0010', 'weapon', '艺术暴君', 'Artzy Tyrannical'),
    ('wpn_pistol_0011', 'weapon', '落草', 'Brigand''s Calling'),
    ('wpn_pistol_0012', 'weapon', 'O.B.J.迅极', 'OBJ Velocitous'),
    ('wpn_sword_0003', 'weapon', '塔尔11', 'Tarr 11'),
    ('wpn_sword_0005', 'weapon', '钢铁余音', 'Sundering Steel'),
    ('wpn_sword_0006', 'weapon', '熔铸火焰', 'Forgeborn Scathe'),
    ('wpn_sword_0007', 'weapon', '坚城铸造者', 'Fortmaker'),
    ('wpn_sword_0008', 'weapon', '显锋', 'Prominent Edge'),
    ('wpn_sword_0009', 'weapon', '浪潮', 'Wave Tide'),
    ('wpn_sword_0010', 'weapon', '黯色火炬', 'Umbral Torch'),
    ('wpn_sword_0011', 'weapon', '扶摇', 'Rapid Ascent'),
    ('wpn_sword_0012', 'weapon', '热熔切割器', 'Thermite Cutter'),
    ('wpn_sword_0013', 'weapon', '显赫声名', 'Eminent Repute'),
    ('wpn_sword_0014', 'weapon', '白夜新星', 'White Night Nova'),
    ('wpn_sword_0015', 'weapon', '仰止', 'Aspirant'),
    ('wpn_sword_0016', 'weapon', '不知归', 'Never Rest'),
    ('wpn_sword_0017', 'weapon', '光荣记忆', 'Glorious Memory'),
    ('wpn_sword_0018', 'weapon', '十二问', 'Twelve Questions'),
    ('wpn_sword_0019', 'weapon', 'O.B.J.轻芒', 'OBJ Edge of Lightness'),
    ('wpn_sword_0020', 'weapon', '逐鳞3.0', 'Finchaser 3.0'),
    ('wpn_sword_0021', 'weapon', '宏愿', 'Grand Vision'),
    ('wpn_sword_0022', 'weapon', '狼之绯', 'Lupine Scarlet')
),
official_alias_names(alias_key, entity_type, zh_name, en_name) AS (
  VALUES
    ('manual_character_char_zmufdo_1bx8tv', 'character', '庄方宜', 'Zhuang Fangyi'),
    ('manual_character_char_15mvpq_a9uf3u', 'character', '弭弗', 'Mi Fu'),
    ('char_manual_char_ixd68v_oxpabe', 'character', '诀', 'Arcane'),
    ('manual_character_char_z2rl9u_b4rq6d', 'character', '卡缪', 'Camille'),
    ('char_manual_char_12luxg_1jisum', 'character', '提弗洛斯', 'Typhoeus'),
    ('char_manual_char_1d87dz_5kysiw', 'character', '梨诺', 'Liino'),
    ('manual_weapon_wp_6cxvd0_rfw9a8', 'weapon', '孤舟', 'Lone Barge'),
    ('weapon_manual_wp_3i8hwk_1wbhjq', 'weapon', '四二式·肃阵', 'Type 42: Solemn Phalanx'),
    ('weapon_manual_wp_1t0hl5_15n8kq', 'weapon', '寒夜幽影', 'Umbra of Frigid Eventide'),
    ('weapon_manual_wp_4e5oi9_7ulmi5', 'weapon', '曜夜的首演', 'Bedazzling Night Debut'),
    ('manual_weapon_wp_7bob77_166j7c', 'weapon', '镀红祝福', 'Blessing of Lustrous Carmine'),
    ('manual_weapon_wp_iufsqp_5motjp', 'weapon', '赤缨', 'Amaranthine Tassel')
),
localization_entries(localization_key, entity_type, zh_name, en_name) AS (
  SELECT entity_id, entity_type, zh_name, en_name FROM official_entity_names
  UNION ALL
  SELECT zh_name, entity_type, zh_name, en_name FROM official_entity_names
  UNION ALL
  SELECT alias_key, entity_type, zh_name, en_name FROM official_alias_names
),
localization_payload AS (
  SELECT jsonb_object_agg(
    localization_key,
    jsonb_build_object(
      'type', entity_type,
      'name', zh_name,
      'zh-CN', zh_name,
      'en-US', en_name
    )
  ) AS value
  FROM localization_entries
)
INSERT INTO public.site_config (key, value, label, category, updated_at)
SELECT
  'entity_localizations',
  value::text,
  '角色与武器本地化',
  'content',
  NOW()
FROM localization_payload
ON CONFLICT (key) DO UPDATE
SET
  value = (
    COALESCE(NULLIF(BTRIM(public.site_config.value), '')::jsonb, '{}'::jsonb)
    || EXCLUDED.value::jsonb
  )::text,
  label = EXCLUDED.label,
  category = EXCLUDED.category,
  updated_at = NOW();

WITH official_pool_names(pool_id, en_name) AS (
  VALUES
    ('beginner', 'New Horizons Headhunting'),
    ('standard', 'Basic Headhunting'),
    ('special_1_0_1', 'Scars of the Forge'),
    ('weponbox_1_0_1', 'Smelting Forge Issue'),
    ('special_1_0_3', 'The Floaty Messenger'),
    ('weponbox_1_0_3', 'Express Delivery Issue'),
    ('special_1_0_2', 'Hues of Passion'),
    ('weponbox_1_0_2', 'Graffiti Issue'),
    ('special_1_1_1', 'River''s Daughter'),
    ('weponbox_1_1_1', 'Budding Anew Issue'),
    ('special_1_1_2', 'Wolf Pearl'),
    ('weponbox_1_1_2', 'Scarlet Pearl Issue'),
    ('special_1_2_1', 'Thunder of Renewal'),
    ('weponbox_1_2_1', 'Drifting Raft Issue'),
    ('joint_1_2_2', 'Fest of Brilliance'),
    ('weponbox_1_2_2', 'Smelting Fire Issue'),
    ('weponbox_1_2_3', 'Swift Walker Issue'),
    ('special_1_3_1', 'Fists of No Regrets'),
    ('weponbox_1_3_1', 'Scarlet Knot Issue'),
    ('special_1_3_2', 'Expunger of Sin'),
    ('weponbox_1_3_2', 'Crimson Hued Issue'),
    ('special_1_4_1', 'North Yearns the Rift Vigile'),
    ('weponbox_1_4_1', 'Military Grade Issue'),
    ('special_1_4_2', 'Good Morning from Your Dawnstar'),
    ('weponbox_1_4_2', 'Bedazzled Issue'),
    ('special_1_5_1', 'Winter Hunt'),
    ('weponbox_1_5_1', 'Deep Cold Issue'),
    ('joint_manual_extra_reconstruction_yvonne_p1', 'Resplendent Spectrum'),
    ('joint_manual_extra_reconstruction_arttyrant_p1', 'Tag Artist Issue'),
    ('weaponbox_constant_1', 'Solid Ice Issue'),
    ('weaponbox_constant_2', 'Cosmic Voice Issue'),
    ('weaponbox_constant_3', 'Far Expedition Issue'),
    ('weaponbox_constant_4', 'Rising Mount Issue'),
    ('weaponbox_constant_5', 'Thunderous Peal Issue')
)
UPDATE public.pools AS pool
SET
  name_en = official.en_name,
  updated_at = NOW()
FROM official_pool_names AS official
WHERE pool.pool_id = official.pool_id
  AND pool.name_en IS DISTINCT FROM official.en_name;

WITH official_version_names(zh_name, en_name) AS (
  VALUES
    ('零号委托'::text, 'Zeroth Directive'::text),
    ('新潮起，故渊离', 'Old Deep Water Dies, by Rising Tide It is Denied'),
    ('春晓时', 'At the Wake of Spring'),
    ('寻遗散记', 'Sketches of Lost Heirlooms'),
    ('向渊行', 'Homecoming'),
    ('雪凇幽梦', 'Dreamscape of Wind and Snow'),
    ('雪松幽梦', 'Dreamscape of Wind and Snow')
),
updated_timeline AS (
  SELECT
    config.key,
    jsonb_set(
      config.value::jsonb,
      '{versions}',
      COALESCE(
        (
          SELECT jsonb_agg(
            CASE
              WHEN official.en_name IS NULL THEN version.item
              ELSE version.item || jsonb_build_object('name_en', official.en_name)
            END
            ORDER BY version.ordinality
          )
          FROM jsonb_array_elements(config.value::jsonb->'versions')
            WITH ORDINALITY AS version(item, ordinality)
          LEFT JOIN official_version_names AS official
            ON official.zh_name = version.item->>'name'
        ),
        '[]'::jsonb
      ),
      TRUE
    )::text AS value
  FROM public.site_config AS config
  WHERE config.key = 'home_version_timeline'
)
UPDATE public.site_config AS config
SET
  value = timeline.value,
  updated_at = NOW()
FROM updated_timeline AS timeline
WHERE config.key = timeline.key
  AND config.value IS DISTINCT FROM timeline.value;

UPDATE public.announcements
SET
  title_en = '[Important] Self-Hosted Email Is Now Live — Please Read',
  content_en = $email$
Dear Endministrators,

The new self-hosted email system substantially improves the site's account security. The site now supports email login, registration verification emails, account recovery by email, ticket reply notifications, Developer API application approval notifications, and more.

Please verify your email in Settings as soon as possible. If the address you previously entered was incorrect or randomly generated, submit a support ticket or contact me through the community group or Discord so I can update it for you.

If GitHub login stops working, bind and verify an email address, set a site password, and then sign in by email.

If you do not receive an email, check your spam folder carefully. Messages from the self-hosted mail system may still be classified as spam more often than expected.
$email$,
  updated_at = NOW()
WHERE id = '8a2f8071-d903-4a30-8828-3aae425b33fc'::uuid;

UPDATE public.announcements
SET
  title_en = '[Resolved] Multiple Regions Under One UID After Import — Merge Them in Settings',
  content_en = $regions$
Dear Endministrators,

An earlier issue in the server-region handling could cause imported data to show a UID under the wrong region, or even show the same UID under multiple regions. The backend did not pass the region value correctly during import. This has now been fixed, and new imports will no longer create this problem.

If your account was already affected, open Settings and follow the instructions under Server Region Settings to merge the duplicate regions.
$regions$,
  updated_at = NOW()
WHERE id = '07a3219a-bc95-416c-909b-0059b0bcb110'::uuid;

UPDATE public.site_config
SET
  value = (
    value::jsonb
    || jsonb_build_object(
      'title_en', 'Dreamscape of Wind and Snow Update and Winter Hunt Now Live',
      'subtitle_en', 'Recently launched: the Dreamscape of Wind and Snow update, Winter Hunt Chartered Headhunting, and A Winter Dream Fogged Deep in the Woods, alongside update fixes and community news.'
    )
  )::text,
  updated_at = NOW()
WHERE key = 'home_game_announcement_digest';

UPDATE public.site_config
SET
  value = jsonb_build_object(
    'version', ((EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint)::text,
    'scope', 'official-english-localizations',
    'reason', 'migration:188_sync_official_english_localizations',
    'updatedAt', clock_timestamp()
  )::text,
  updated_at = NOW()
WHERE key = 'public_cache_epoch';

COMMIT;

NOTIFY pgrst, 'reload schema';
