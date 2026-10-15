import { describe, expect, it } from 'vitest';
import { analyzeScreenshot, applyNormalCountMeaning, buildScreenshotEntries, matchCatalogText, poolEntityType, poolType } from '../semantics.js';
import { buildTilePlan, dedupeOcrTokens, mapOcrItemsToTokens } from '../tokens.js';
import { barTokens, bounds, entities, pools, token } from './tokens.fixture.js';

const analyze = tokens => analyzeScreenshot({ tokens, diagnostics: bounds, pools, entities, selectedPoolId: 'limited-1' });
const confirm = segment => ({ ...segment, poolConfirmed: true, countsConfirmed: true,
  rows: segment.rows.map(row => ({ ...row, confirmed: true, entityConfirmed: true })) });

describe('小黑盒截图语义与草稿边界', () => {
  it('附加池只按项目既有能力 profile 分类，武器重构选择武器实体', () => {
    const extra = { id: 'extra-weapon', name: '新芽申领', type: 'extra', extra_rule_profile: 'reconstruction_weapon_v1', rosterEntityIds: ['weapon-6'] };
    expect(poolType(extra)).toBe('weapon');
    expect(poolEntityType(extra)).toBe('weapon');
    expect(poolType({ id: 'extra-char', type: 'extra', extra_rule_profile: 'reconstruction_character_v1' })).toBe('limited');
    expect(poolEntityType({ id: 'unknown-extra', type: 'extra' })).toBe('unknown');
    expect(poolType({ id: 'joint_1_2_2', type: 'extra' })).toBe('celebration');
    const tokens = [token('新芽申领', 50, 80), token('第2个十连', 350, 250), token('熔铸火焰', 160, 240), token('2', 220, 200, 15)];
    const result = analyzeScreenshot({ tokens, diagnostics: bounds, pools: [extra], entities, selectedPoolId: extra.id });
    expect(result.segments[0].rows[0].entityId).toBe('weapon-6');
    expect(buildScreenshotEntries([confirm(result.segments[0])], { pools: [extra], entities }).errors).toEqual([]);
    const unresolved = { ...extra, extra_rule_profile: '' };
    expect(buildScreenshotEntries([confirm(result.segments[0])], { pools: [unresolved], entities }).errors.join()).toContain('规则尚未分类');
  });
  it('仅匹配真实目录别名，不注入 demo 固定池名单', () => {
    expect(matchCatalogText('新芽申領', pools)[0]?.entityId).toBe('weapon-1');
    expect(matchCatalogText('狼珀', pools)).toEqual([]);
  });
  it('识别池标题、普通合计、垫抽、免费区、歪、原图裁剪及日期精度', () => {
    const { segments } = analyze(barTokens());
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ poolId: 'limited-1', totalPulls: 40, pity: 27, countMeaning: 'unknown', complete: false });
    expect(segments[0].rows).toHaveLength(2);
    expect(segments[0].rows[0]).toMatchObject({ rawPullCount: 78, pullIndex: '', intervalPulls: '', isOffRate: true, timestamp: '2026-04-20', timePrecision: 'day' });
    expect(segments[0].rows[1]).toMatchObject({ drawMethod: 'free', rawPullCount: 3, pullMeaning: 'index' });
    expect(segments[0].rows[0].sourceIconBox.width).toBeGreaterThan(0);
  });
  it('确认 N 抽含义前阻止应用，确认间隔后允许跨池继承大于本池总数', () => {
    let segment = confirm(analyze(barTokens()).segments[0]);
    expect(buildScreenshotEntries([segment], { pools, entities }).errors.join()).toContain('间隔还是池内位置');
    segment = { ...segment, countMeaning: 'interval' };
    const draft = buildScreenshotEntries([segment], { pools, entities });
    expect(draft.errors).toEqual([]);
    expect(draft.entries[0]).toMatchObject({ kind: 'pool-ledger', source: 'xhh', reviewState: 'unreviewed' });
    expect(draft.entries[0].values.acquisitions[0]).toMatchObject({ intervalPulls: 78, rarity: 6, quantity: 1 });
    expect(draft.entries[0].values.acquisitions[0]).not.toHaveProperty('pullIndex');
    expect(draft.entries[0].values.acquisitions[1]).toMatchObject({ pullIndex: 3, drawMethod: 'free' });
    expect(draft.entries[0].values).not.toHaveProperty('inferredRecords');
    expect(draft.entries[0].values.totalPulls).toBe(40);
  });
  it('真正的池内绝对位置不能超出池普通抽数', () => {
    const segment = { ...confirm(analyze(barTokens()).segments[0]), countMeaning: 'index' };
    expect(buildScreenshotEntries([segment], { pools, entities }).errors.join()).toContain('超过普通抽数');
  });
  it('未知实体与未确认的自动猜测要求人工补充', () => {
    const segment = { ...confirm(analyze(barTokens()).segments[0]), countMeaning: 'interval' };
    segment.rows[0].entityId = '';
    expect(buildScreenshotEntries([segment], { pools, entities }).errors.join()).toContain('角色 / 武器');
    const unconfirmed = analyze(barTokens()).segments;
    expect(buildScreenshotEntries(unconfirmed, { pools, entities }).errors.join()).toContain('确认目录中的卡池');
  });
  it('无年份的短日期保留未知时间，至今行只提供垫抽证据', () => {
    const parsed = analyze([token('熔火灼痕', 40, 80), token('68抽', 180, 250), token('莱万汀', 300, 250), token('04-20', 300, 278), token('27抽', 180, 400), token('至今', 300, 400)]);
    expect(parsed.segments[0].rows).toHaveLength(1);
    expect(parsed.segments[0].rows[0]).toMatchObject({ timestamp: '', timePrecision: 'unknown' });
    expect(parsed.segments[0].pity).toBe(27);
  });
  it('新版武器十连与方格角标展开数量为单件，批次不冒充抽序', () => {
    const result = analyzeScreenshot({ tokens: [token('新芽申領', 50, 80), token('第2个十连', 350, 250), token('熔铸火焰', 160, 240), token('2', 220, 200, 15)],
      diagnostics: bounds, pools, entities, selectedPoolId: 'weapon-1' });
    const segment = confirm(result.segments[0]);
    expect(segment.rows).toHaveLength(2);
    expect(segment.rows[0]).toMatchObject({ batchIndex: 2, badgeQuantity: 2, entityId: 'weapon-6', pullIndex: '', rawPullCount: '' });
    const draft = buildScreenshotEntries([segment], { pools, entities });
    expect(draft.errors).toEqual([]);
    expect(draft.entries[0].values.acquisitions).toHaveLength(2);
    expect(draft.entries[0].values.acquisitions.every(r => r.quantity === 1 && !r.pullIndex)).toBe(true);
  });
  it('已有同池记录只产生待审重复提示，不产生修改或删除操作', () => {
    const segment = { ...confirm(analyze(barTokens()).segments[0]), countMeaning: 'interval' };
    const result = buildScreenshotEntries([segment], { pools, entities, existingHistory: [{ pool_id: 'limited-1' }] });
    expect(result.warnings.join()).toContain('已有数据');
    expect(result).not.toHaveProperty('historyChanges');
    expect(result.entries[0].values.complete).toBe(false);
  });
  it('全局普通数字设置不覆盖免费十连，也不把武器数量角标当抽序', () => {
    const segment = confirm(analyze(barTokens()).segments[0]);
    const changed = applyNormalCountMeaning([segment], 'interval')[0];
    expect(changed.rows[0].confirmed).toBe(false);
    expect(changed.rows[1]).toEqual(segment.rows[1]);
    const draft = buildScreenshotEntries([confirm(changed)], { pools, entities });
    expect(draft.entries[0].values.acquisitions[1]).toMatchObject({ drawMethod: 'free', pullIndex: 3 });
    expect(draft.entries[0].values.acquisitions[1]).not.toHaveProperty('intervalPulls');
    changed.rows[1].pullMeaning = 'unknown';
    expect(buildScreenshotEntries([confirm(changed)], { pools, entities }).errors.join()).toContain('间隔还是池内位置');
  });
  it('拒绝本池名单之外的同类型角色以及未处理的五星遗漏提示', () => {
    const segment = { ...confirm(analyze(barTokens()).segments[0]), countMeaning: 'interval', fiveStarHints: [{}] };
    const outside = { id: 'outside', name: '其他池六星', rarity: 6, type: 'character' };
    segment.rows[0].entityId = outside.id;
    const errors = buildScreenshotEntries([segment], { pools, entities: [...entities, outside] }).errors.join();
    expect(errors).toContain('不在本池名单'); expect(errors).toContain('五星头像提示');
  });
});

describe('V2 分块几何与去重', () => {
  it('保持 sourceBox 原图坐标，跨块去重保留置信度与冲突证据', () => {
    const plan = buildTilePlan(2304, 3606);
    expect(plan.tiles).toHaveLength(3);
    const mapped = mapOcrItemsToTokens([{ text: '68抽', score: .91, poly: [[10, 20], [110, 20], [110, 40], [10, 40]] }], plan.tiles[0], plan);
    expect(mapped[0].sourceBox).toEqual({ x: 20, y: 40, width: 200, height: 40 });
    const other = { ...mapped[0], text: '69抽', normalizedText: '69抽', confidence: .7, tileIds: ['tile-2'] };
    const deduped = dedupeOcrTokens([...mapped, other]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].text).toBe('68抽');
    expect(deduped[0].conflicts).toEqual(['69抽']);
  });
});
