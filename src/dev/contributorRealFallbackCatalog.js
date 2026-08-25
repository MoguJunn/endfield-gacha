const character = (id, name, rarity, { limited = false, aliases = [] } = {}) => ({
  id,
  name,
  rarity,
  type: 'character',
  aliases,
  is_limited: limited,
  avatar_url: null,
  release_date: null,
  pool_config: {
    pools: limited ? ['limited'] : ['standard', 'limited'],
    limited_rotation_count: limited ? 3 : 0,
    removes_after: null,
    is_active_in_limited: true,
  },
});

const weapon = (id, name, rarity, { limited = false, aliases = [] } = {}) => ({
  id,
  name,
  rarity,
  type: 'weapon',
  aliases,
  is_limited: limited,
  avatar_url: null,
  release_date: null,
  pool_config: {
    pools: ['weapon'],
    limited_rotation_count: 0,
    removes_after: null,
    is_active_in_limited: false,
  },
});

// 这是断网首启时的最小真实目录，不声称等同于实时正式站。
// 在线演示会用正式站公共 API 的完整目录替换这些行。
export const CONTRIBUTOR_REAL_FALLBACK_CHARACTERS = Object.freeze([
  character('chr_0016_laevat', '莱万汀', 6, { limited: true }),
  character('chr_0013_aglina', '洁尔佩塔', 6, { limited: true }),
  character('chr_0017_yvonne', '伊冯', 6, { limited: true }),
  character('chr_0009_azrila', '余烬', 6),
  character('chr_0015_lifeng', '黎风', 6),
  character('chr_0025_ardelia', '艾尔黛拉', 6),
  character('chr_0026_lastrite', '别礼', 6),
  character('chr_0029_pograni', '骏卫', 6),
  character('chr_0004_pelica', '佩丽卡', 5),
  character('chr_0005_chen', '陈千语', 5),
  character('chr_0020_meurs', '卡契尔', 4),
  character('chr_0021_whiten', '埃特拉', 4),
  character('chr_0023_antal', '安塔尔', 4),
  character('chr_0019_karin', '秋栗', 4),
  character('chr_0022_bounda', '萤石', 4),
  weapon('wpn_pistol_0010', '艺术暴君', 6, { limited: true }),
  weapon('wpn_sword_0010', '黯色火炬', 6),
  weapon('wpn_sword_0014', '白夜新星', 6),
  weapon('wpn_sword_0012', '热熔切割器', 6),
  weapon('wpn_sword_0013', '显赫声名', 6),
  weapon('wpn_funnel_0006', '作品：蚀迹', 6),
  weapon('wpn_lance_0011', 'J.E.T.', 6),
  weapon('wpn_lance_0013', 'O.B.J.尖峰', 5),
  weapon('wpn_funnel_0014', 'O.B.J.术识', 5),
  weapon('wpn_funnel_0001', '全自动骇新星', 4),
]);

export const CONTRIBUTOR_REAL_FALLBACK_POOLS = Object.freeze([
  {
    id: 'standard',
    pool_id: 'standard',
    name: '基础寻访',
    name_en: 'Basic Recruitment',
    type: 'standard',
    locked: true,
    up_character: null,
    start_time: null,
    end_time: null,
    featured_characters: null,
    description: '断网 fallback：正式站公共目录不可用时提供的基础寻访。',
  },
  {
    id: 'joint_1_2_2',
    pool_id: 'joint_1_2_2',
    name: '辉光庆典',
    name_en: 'Fest of Brilliance',
    type: 'extra',
    extra_subtype: 'special',
    extra_rule_profile: 'brilliance_festival_v1',
    locked: true,
    up_character: '莱万汀',
    start_time: '2026-05-14T04:00:00.000Z',
    end_time: '2026-06-05T04:00:00.000Z',
    featured_characters: ['莱万汀', '洁尔佩塔', '艾尔黛拉', '骏卫'],
    description: '真实历史卡池；断网 fallback 时间来自 2026-06-04 生产审计快照。',
  },
  {
    id: 'joint_manual_extra_reconstruction_yvonne_p1',
    pool_id: 'joint_manual_extra_reconstruction_yvonne_p1',
    name: '绚丽异彩',
    name_en: null,
    type: 'extra',
    extra_subtype: 'reconstruction',
    extra_rule_profile: 'reconstruction_character_v1',
    extra_series_key: 'reconstruction-xuesong-youmeng',
    extra_series_phase: 1,
    locked: true,
    up_character: '伊冯',
    start_time: '2026-09-24T04:00:00.000Z',
    end_time: null,
    featured_characters: ['伊冯'],
    description: '官方内容，当前仓库种子 ID 仍为待提升的 manual placeholder。',
  },
  {
    id: 'joint_manual_extra_reconstruction_arttyrant_p1',
    pool_id: 'joint_manual_extra_reconstruction_arttyrant_p1',
    name: '点绘申领',
    name_en: null,
    type: 'extra',
    extra_subtype: 'reconstruction_claim',
    extra_rule_profile: 'reconstruction_weapon_v1',
    extra_series_key: 'reconstruction-xuesong-youmeng',
    extra_series_phase: 1,
    locked: true,
    is_limited_weapon: true,
    up_character: '艺术暴君',
    start_time: '2026-09-24T04:00:00.000Z',
    end_time: null,
    featured_characters: ['艺术暴君'],
    description: '官方内容，当前仓库种子 ID 仍为待提升的 manual placeholder。',
  },
]);

const roster = (poolId, ids, upIds = []) => ids.map((characterId) => ({
  pool_id: poolId,
  character_id: characterId,
  is_up: upIds.includes(characterId),
  characters: CONTRIBUTOR_REAL_FALLBACK_CHARACTERS.find((item) => item.id === characterId) || null,
})).filter((item) => item.characters);

const standardCharacterIds = CONTRIBUTOR_REAL_FALLBACK_CHARACTERS
  .filter((item) => item.type === 'character' && !item.is_limited)
  .map((item) => item.id);

export const CONTRIBUTOR_REAL_FALLBACK_POOL_CHARACTERS = Object.freeze({
  standard: roster('standard', standardCharacterIds),
  joint_1_2_2: roster(
    'joint_1_2_2',
    ['chr_0016_laevat', 'chr_0013_aglina', 'chr_0025_ardelia', 'chr_0029_pograni', ...standardCharacterIds.filter((id) => !['chr_0025_ardelia', 'chr_0029_pograni'].includes(id))],
    ['chr_0016_laevat', 'chr_0013_aglina', 'chr_0025_ardelia', 'chr_0029_pograni']
  ),
  joint_manual_extra_reconstruction_yvonne_p1: roster(
    'joint_manual_extra_reconstruction_yvonne_p1',
    ['chr_0017_yvonne', 'chr_0009_azrila', 'chr_0015_lifeng', 'chr_0025_ardelia', 'chr_0026_lastrite', 'chr_0029_pograni', 'chr_0004_pelica', 'chr_0005_chen', 'chr_0020_meurs', 'chr_0021_whiten'],
    ['chr_0017_yvonne']
  ),
  joint_manual_extra_reconstruction_arttyrant_p1: roster(
    'joint_manual_extra_reconstruction_arttyrant_p1',
    CONTRIBUTOR_REAL_FALLBACK_CHARACTERS.filter((item) => item.type === 'weapon').map((item) => item.id),
    ['wpn_pistol_0010']
  ),
});

export const CONTRIBUTOR_REAL_FALLBACK_SITE_CONFIG = Object.freeze({
  site_version: 'v4.5.4-local-sandbox',
  build_info: 'Contributor sandbox · local-only',
  homepage_notice: '当前为本地内容沙盒。游戏目录优先来自正式站公开 API，内容修改只保存在本浏览器。',
  home_next_version_target_at: '2026-09-24T04:00:00.000Z',
  home_version_timeline: JSON.stringify({
    versions: [
      {
        id: 'reconstruction-xuesong-youmeng',
        name: '雪松幽梦',
        name_en: 'Cedar Dream',
        starts_at: '2026-09-24T04:00:00.000Z',
        ends_at: null,
        enabled: true,
        order: 10,
        pool_ids: [
          'joint_manual_extra_reconstruction_yvonne_p1',
          'joint_manual_extra_reconstruction_arttyrant_p1',
        ],
      },
    ],
  }),
});
