// Synthetic OCR metadata only. Real image regression reads _docs paths in place.
export const pools = [
  { id: 'limited-1', name: '熔火灼痕', type: 'limited', aliases: ['熔火灼痕池'], rosterEntityIds: ['char-6', 'char-5'] },
  { id: 'weapon-1', name: '新芽申领', type: 'weapon', aliases: ['新芽申領'], rosterEntityIds: ['weapon-6', 'weapon-5'] },
  { id: 'standard-1', name: '基础寻访', type: 'standard', rosterEntityIds: ['char-6', 'char-5'] },
];
export const entities = [
  { id: 'char-6', name: '莱万汀', type: 'character', rarity: 6 },
  { id: 'char-5', name: '弧光', type: 'character', rarity: 5 },
  { id: 'weapon-6', name: '熔铸火焰', type: 'weapon', rarity: 6 },
  { id: 'weapon-5', name: '钢铁余音', type: 'weapon', rarity: 5 },
];
let i = 0;
export const token = (text, x, y, width = 90, height = 20, confidence = .96) => ({ id: `fixture-${++i}`, text, confidence,
  box: { x, y, width, height }, sourceBox: { x: x * 2, y: y * 2, width: width * 2, height: height * 2 }, tileIds: ['fixture'], conflicts: [] });
export const barTokens = () => [
  token('总抽取 630 抽', 80, 25, 180), token('2026年', 35, 100), token('熔火灼痕池', 50, 130, 180),
  token('合计40抽', 50, 165), token('垫27抽', 220, 165),
  token('78抽', 180, 250), token('莱万汀', 300, 250), token('歪', 430, 250, 20), token('04-20', 310, 277),
  token('免费十连', 40, 350, 130), token('3抽', 180, 400), token('莱万汀', 300, 400),
];
export const bounds = { workWidth: 600, workHeight: 700, sourceWidth: 1200, sourceHeight: 1400, scale: .5 };
