import { describe, expect, it } from 'vitest';
import {
  decodeHistories,
  encodeHistories,
  packInheritanceProjection,
  unpackInheritanceProjection,
} from '../../../../shared/simulator/historyCodec.js';

describe('compact inheritance history', () => {
  it('round-trips all kinds, entity identities, pool sequence and pity without altering inputs', () => {
    const histories = {
      a: ['paid', 'free', 'info_book', 'gift'].map((kind, i) => ({
        poolId: 'a',
        eventId: `r${i}`,
        sequenceIndex: i + 1,
        kind,
        rarity: i % 2 ? 6 : 4,
        isUp: i % 2 === 1,
        characterId: 'same',
        characterName: '对象',
        timestamp: i,
        pityBefore: 12,
      })),
    };
    const original = JSON.stringify(histories);
    const encoded = encodeHistories(histories);
    expect(encoded.entities).toHaveLength(1);
    expect(decodeHistories(encoded)).toEqual(histories);
    expect(unpackInheritanceProjection(packInheritanceProjection({ contractVersion: 2, histories })).histories).toEqual(
      histories
    );
    expect(JSON.stringify(histories)).toBe(original);
  });
  it('rejects corrupt rows rather than rebuilding incomplete outcomes', () => {
    const encoded = { version: 1, entities: [['id', '对象']], pools: { a: [['id', 1, 99, 4, 0, 0, 100, null]] } };
    expect(() => decodeHistories(encoded)).toThrow('simulator_history_codec_invalid');
  });
});
