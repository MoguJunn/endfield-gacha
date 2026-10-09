const KINDS = ['paid', 'free', 'info_book', 'gift'];

/** Dictionary + column rows keep the full outcome history without repeating field names or entity names. */
export function encodeHistories(histories) {
  const entities = [];
  const entityIndex = new Map();
  const pools = {};
  for (const [poolId, records] of Object.entries(histories)) {
    pools[poolId] = records.map((record) => {
      const entity = [record.characterId ?? null, record.characterName];
      const key = JSON.stringify(entity);
      if (!entityIndex.has(key)) {
        entityIndex.set(key, entities.length);
        entities.push(entity);
      }
      return [
        record.eventId,
        record.sequenceIndex,
        KINDS.indexOf(record.kind),
        record.rarity,
        record.isUp ? 1 : 0,
        entityIndex.get(key),
        record.timestamp,
        record.pityBefore ?? null,
      ];
    });
  }
  return { version: 1, entities, pools };
}

export function decodeHistories(encoded) {
  if (
    encoded?.version !== 1 ||
    !Array.isArray(encoded.entities) ||
    !encoded.pools ||
    typeof encoded.pools !== 'object'
  ) {
    throw new Error('simulator_history_codec_invalid');
  }
  return Object.fromEntries(
    Object.entries(encoded.pools).map(([poolId, rows]) => {
      if (!Array.isArray(rows)) throw new Error('simulator_history_codec_invalid');
      return [
        poolId,
        rows.map((row) => {
          const entity = encoded.entities[row?.[5]];
          if (
            !Array.isArray(row) ||
            row.length !== 8 ||
            !entity ||
            !KINDS[row[2]] ||
            !Number.isFinite(row[3]) ||
            typeof row[0] !== 'string' ||
            !Number.isInteger(row[1]) ||
            row[1] < 1 ||
            (row[6] !== null && !Number.isFinite(row[6]))
          ) {
            throw new Error('simulator_history_codec_invalid');
          }
          return {
            eventId: row[0],
            sequenceIndex: row[1],
            kind: KINDS[row[2]],
            rarity: row[3],
            isUp: row[4] === 1,
            characterId: entity[0],
            characterName: entity[1],
            timestamp: row[6],
            poolId,
            ...(row[7] == null ? {} : { pityBefore: row[7] }),
          };
        }),
      ];
    })
  );
}

export function packInheritanceProjection(projection) {
  return { ...projection, historyEncoding: 1, histories: encodeHistories(projection.histories) };
}

export function unpackInheritanceProjection(projection) {
  if (projection?.historyEncoding !== 1) throw new Error('simulator_history_codec_invalid');
  return { ...projection, histories: decodeHistories(projection.histories) };
}
