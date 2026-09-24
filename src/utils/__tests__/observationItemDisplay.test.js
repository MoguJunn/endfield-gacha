import { describe, expect, it } from 'vitest';
import { buildObservationItemOptions, isObservationSeriesSelected } from '../observationItemDisplay.js';

const records = [
  { id: 'target', name: '目标', is_limited: true, rarity: '6' },
  { id: 'retained', name: '池内限定', is_limited: true, rarity: 6 },
  { id: 'standard', name: '常驻', is_limited: false, rarity: 6 },
  { id: 'outside', name: '不在此池', is_limited: true, rarity: 6 },
  { id: 'five-z', name: '昼', rarity: 5 }, { id: 'five-a', name: '安', rarity: 5 },
  { id: 'four-z', name: '昼', rarity: 4 }, { id: 'four-a', name: '安', rarity: 4 },
];
const items = records.filter((record) => record.id !== 'outside').reverse().map((record, index) => ({ ...record, itemId: record.id, count: 100 - index }));
const resolveRecord = (value) => records.find((record) => record.id === value || record.name === value);
const build = (overrides = {}) => buildObservationItemOptions({ items, featuredNames: ['目标'], resolveRecord, ...overrides });

describe('banner observation item ordering and selection', () => {
  it('sorts current, retained limited and standard six-stars before pinyin-sorted lower rarities', () => {
    const options = build();
    expect(options.map((item) => item.itemId)).toEqual(['target', 'retained', 'standard', 'five-a', 'five-z', 'four-a', 'four-z']);
    expect(options.slice(0, 3).map((item) => item.group)).toEqual(['featured', 'limited', 'standard']);
    expect(options[0].rarity).toBe(6);
    expect(options.some((item) => item.itemId === 'outside')).toBe(false);
  });

  it('defaults to the current and retained limited six-stars, including after directory loading', () => {
    const selected = (options) => options.filter((item) => item.rarity === 6 && isObservationSeriesSelected(item, { mode: 'recommended', overrides: {}, hasTargets: true })).map((item) => item.itemId);
    expect(selected(build({ resolveRecord: () => null }))).toEqual(['target']);
    expect(selected(build())).toEqual(['target', 'retained']);
  });

  it('keeps explicit checkbox choices on directory refresh and allows featured-only after show-all', () => {
    const six = build().filter((item) => item.rarity === 6);
    const select = (mode, overrides = {}) => six.filter((item) => isObservationSeriesSelected(item, { mode, overrides, hasTargets: true })).map((item) => item.itemId);
    expect(select('all')).toEqual(['target', 'retained', 'standard']);
    expect(select('featured')).toEqual(['target']);
    expect(select('recommended', { retained: false, standard: true })).toEqual(['target', 'standard']);
    expect(select('featured', { target: false })).toEqual([]);
  });

  it('preserves all choices for standard banners and lower-rarity filters', () => {
    const options = build({ featuredNames: [] });
    expect(options.every((item) => isObservationSeriesSelected(item, { mode: 'recommended', overrides: {}, hasTargets: false }))).toBe(true);
    expect(build().filter((item) => item.rarity < 6).every((item) => isObservationSeriesSelected(item, { mode: 'recommended', overrides: {}, hasTargets: true }))).toBe(true);
  });

  it('retains a missing target without fabricating counts or categorizing unknown entries as standard', () => {
    const options = build({ items: [{ itemId: 'unknown', name: '未知', rarity: 6 }] });
    expect(options[0]).toMatchObject({ itemId: 'target', missing: true, group: 'featured', rarity: 6 });
    expect(options[0].count).toBeUndefined();
    expect(options[1].group).toBe('six-other');
  });
});
