// LCX's generic template labels an unidentified Endfield 4★ result as 3★.
// Keep the pull and its rarity without assigning it to a real catalog entity.
export const LCX_FOUR_STAR_PLACEHOLDER = 'lcx_unknown_four_star';
export const LCX_FOUR_STAR_EXCESS = 'lcx_unknown_four_star_excess';

export function isLcxFourStarPlaceholder(record) {
  return Number(record?.rarity) === 4
    && [LCX_FOUR_STAR_PLACEHOLDER, LCX_FOUR_STAR_EXCESS].includes(record?.specialType || record?.special_type);
}
