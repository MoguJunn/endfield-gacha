import { describe, expect, it } from 'vitest';
import { findOfficialWeaponTargetGifts, normalizeOfficialImportRecord } from '../../shared/officialImportRecordNormalizer.js';
import { calculateHistoryPity } from '../../shared/historyPity.js';

const context = { poolId: 'weaponbox_1_6_1', poolType: 'weapon', upCharacter: '玉中身', gameUid: 'test', serverId: '1' };
function batch() {
  const pulls = Array.from({ length: 10 }, (_, index) => ({ poolId: context.poolId, seqId: String(2072 + index),
    timestamp: '2026-10-16T14:34:12.144Z', weaponId: `weapon_${index}`, weaponName: `武器${index}`, rarity: index === 4 ? 6 : 4 }));
  return [...pulls, { poolId: context.poolId, seqId: '2082', timestamp: pulls[0].timestamp, weaponName: '玉中身' }];
}
describe('official weapon target rewards', () => {
  it('keeps the eleventh named target as a six-star gift without resetting pity', () => {
    const records = batch();
    const gifts = findOfficialWeaponTargetGifts(records, context);
    expect([...gifts]).toEqual([records[10]]);
    const normalized = records.map(record => normalizeOfficialImportRecord(record, { ...context, weaponTargetGift: gifts.has(record) }));
    expect(normalized[10]).toMatchObject({ quality: 6, specialType: 'gift', issues: [], rawItemId: null });
    expect(normalized[10].rawMin.quality).toBeNull();
    const withPity = calculateHistoryPity(normalized.map(row => ({ ...row, rarity: row.quality })));
    expect(withPity[10].pity).toBe(5);
    expect(withPity.filter(row => row.specialType !== 'gift')).toHaveLength(10);
  });
  it.each([
    records => records.slice(1),
    records => records.map((row, index) => index === 10 ? { ...row, weaponName: '另一把武器' } : row),
    records => records.map((row, index) => index === 10 ? { ...row, poolId: 'other' } : row),
    records => records.map((row, index) => index === 10 ? { ...row, rarity: 6 } : row),
    records => records.map((row, index) => index === 10 ? { ...row, seqId: '2071' } : row),
    records => [...records, { ...records[10], seqId: '2083' }],
  ])('preserves review for ambiguous or incomplete evidence', change => {
    expect(findOfficialWeaponTargetGifts(change(batch()), context).size).toBe(0);
    expect(normalizeOfficialImportRecord(batch()[10], context).issues.map(issue => issue.code))
      .toEqual(['MISSING_ITEM_ID', 'MISSING_QUALITY']);
  });
});
