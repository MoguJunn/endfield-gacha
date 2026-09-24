// 可重复的布局构造样本，不模拟游戏概率，不代表任何真实玩家或全服结果。
export const PREVIEW_POOLS = [
  { id: 'sample-a', name: ['限定角色池 · 样例 A', 'Character banner · Sample A'], weapon: false },
  { id: 'sample-b', name: ['限定角色池 · 样例 B', 'Character banner · Sample B'], weapon: false },
  { id: 'sample-w', name: ['限定武器池 · 样例', 'Weapon banner · Sample'], weapon: true },
];

export const PREVIEW_ITEMS = {
  alpha: { name: ['目标干员', 'Featured operator'], color: '#ba7900' },
  beta: { name: ['同池干员乙', 'Operator B'], color: '#4e6fd7' },
  gamma: { name: ['同池干员丙', 'Operator C'], color: '#6d9470' },
  five: { name: ['五星干员', 'Five-star operator'], color: '#958055' },
  four: { name: ['四星干员', 'Four-star operator'], color: '#8e8799' },
  'w-alpha': { name: ['目标武器', 'Featured weapon'], color: '#ba7900' },
  'w-beta': { name: ['同池武器乙', 'Weapon B'], color: '#4e6fd7' },
  'w-gamma': { name: ['同池武器丙', 'Weapon C'], color: '#6d9470' },
  'w-five': { name: ['五星武器', 'Five-star weapon'], color: '#958055' },
  'w-four': { name: ['四星武器', 'Four-star weapon'], color: '#8e8799' },
};

export const PREVIEW_ACCOUNTS = Array.from({ length: 36 }, (_, i) => `sample-owner:${i}:cn`);

export const PREVIEW_RECORDS = PREVIEW_ACCOUNTS.flatMap((accountKey, accountIndex) => {
  const owned = new Set();
  const result = [];
  // 部分账号先通过赠送拥有干员乙，用于展示两种“首次”定义的差别。
  if (accountIndex % 2 === 0) {
    owned.add('beta');
    result.push({ id: 'old-gift', accountKey, poolId: 'old', itemId: 'beta', rarity: 6, kind: 'gift', timestamp: 0, sequence: 0, newItem: true });
  }
  PREVIEW_POOLS.forEach((pool, poolIndex) => {
    const prefix = pool.weapon ? 'w-' : '';
    const hits = new Map([
      [12 + (accountIndex * 7) % 53, 'alpha'],
      [69 + (accountIndex * 11) % 30, 'beta'],
      [104 + (accountIndex * 13) % 34, 'alpha'],
      [146 + (accountIndex * 3) % 22, 'gamma'],
      [180 + (accountIndex * 5) % 18, 'beta'],
    ]);
    for (let sequence = 1; sequence <= 210; sequence++) {
      const six = hits.get(sequence);
      const itemId = prefix + (six || (sequence % 9 === 0 ? 'five' : 'four'));
      const kind = !pool.weapon && sequence >= 31 && sequence <= 40 ? 'free'
        : !pool.weapon && poolIndex === 1 && sequence <= 10 ? 'infoBook' : 'pull';
      result.push({
        id: `${pool.id}:${sequence}`, accountKey, poolId: pool.id, itemId,
        rarity: six ? 6 : sequence % 9 === 0 ? 5 : 4,
        kind, timestamp: (poolIndex + 1) * 1000 + sequence, sequence,
        newItem: !owned.has(itemId),
      });
      owned.add(itemId);
    }
  });
  return result;
});
