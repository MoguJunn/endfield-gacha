const pinyin = new Intl.Collator('zh-Hans-u-co-pinyin', { numeric: true, sensitivity: 'base' });
const GROUP_ORDER = ['featured', 'limited', 'standard', 'six-other', 'five', 'four'];
const COLORS = ['#d99a16', '#5485c5', '#2d9d90', '#b9799a', '#8074bc', '#bc704d', '#6f9950', '#4c9eaf'];

export function observationItemGroupLabel(group, t) {
  return ({
    featured: t('本期目标 · 六星', 'Featured · 6★'),
    limited: t('池内其他限定 · 六星', 'Other limited items in this banner · 6★'),
    standard: t('常驻 · 六星', 'Standard · 6★'),
    'six-other': t('其他六星', 'Other 6★ items'),
    five: t('五星', '5★ items'),
    four: t('四星', '4★ items'),
  })[group];
}

/** Only classify items already present in this banner's records, plus its explicit targets.
 * Directory-wide limited flags never add unrelated or rotated-out items to the banner. */
export function buildObservationItemOptions({ items, featuredNames, resolveRecord, english = false }) {
  const targets = featuredNames.map((name) => ({ name, record: resolveRecord(name) }));
  const options = items.map((item) => {
    const record = resolveRecord(item.itemId) || resolveRecord(item.name);
    const rarity = Number(item.rarity);
    const isFeatured = targets.some((target) => target.record?.id === item.itemId || target.name === item.name || target.name === item.nameEn);
    const group = rarity === 6 ? isFeatured ? 'featured' : record?.is_limited === true ? 'limited'
      : record?.is_limited === false ? 'standard' : 'six-other' : rarity === 5 ? 'five' : 'four';
    return { ...item, rarity, group, canonicalName: item.name, avatarUrl: record?.avatar_url || null,
      name: english ? item.nameEn || record?.name_en || item.name || item.itemId : item.name || item.itemId };
  });
  for (const target of targets) {
    if (options.some((item) => item.itemId === target.record?.id || item.canonicalName === target.name || item.nameEn === target.name)) continue;
    options.push({ itemId: target.record?.id || `featured:${target.name}`, canonicalName: target.name,
      name: english && target.record?.name_en ? target.record.name_en : target.name,
      rarity: Number(target.record?.rarity || 6), group: 'featured', avatarUrl: target.record?.avatar_url || null, missing: true });
  }
  return options.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
    || pinyin.compare(a.canonicalName, b.canonicalName) || a.itemId.localeCompare(b.itemId))
    .map((item, index) => ({ ...item, color: COLORS[index % COLORS.length] }));
}

export function isObservationSeriesSelected(item, { mode, overrides, hasTargets }) {
  if (Object.hasOwn(overrides, item.itemId)) return overrides[item.itemId];
  if (mode === 'featured') return item.group === 'featured';
  if (mode === 'all') return true;
  return !hasTargets || item.rarity !== 6 || item.group === 'featured' || item.group === 'limited';
}
