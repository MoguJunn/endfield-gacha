// V2 token-line / evidence-row parser. Catalog aliases replace the demo's old fixed pool list.
import { centerX, centerY, normalizeText, unionRects } from './tokens.js';
import { resolvePoolCapabilities } from '../../../utils/poolCapabilities.js';
import { entitiesForWorkbenchPool } from '../workbenchCatalog.js';
import { isWorkbenchPoolUnopened, workbenchPoolUnavailableMessage } from '../../../../shared/workbenchPoolAvailability.js';

export function poolType(pool) {
  if ((pool?.type || pool?.pool_type) === 'beginner') return 'beginner';
  const capabilities = resolvePoolCapabilities(pool);
  if (!capabilities.isResolved) return 'unknown';
  return capabilities.basePoolType === 'extra' ? 'celebration' : capabilities.basePoolType;
}

export const poolEntityType = pool => resolvePoolCapabilities(pool).entityType;

const aliases = item => [...new Set([item.name, item.name_cn, item.displayName,
  ...(Array.isArray(item.aliases) ? item.aliases : []), ...(Array.isArray(item.nameAliases) ? item.nameAliases : [])].filter(Boolean))];

export function groupTokensIntoLines(tokens) {
  const lines = [];
  for (const token of tokens.filter(t => t.box).slice().sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
    const line = lines.slice(-8).find(l => Math.abs(centerY(l.box) - centerY(token.box)) < Math.max(6, Math.min(l.box.height, token.box.height) * 0.65));
    if (line) { line.tokens.push(token); line.box = unionRects(line.tokens.map(t => t.box)); }
    else lines.push({ tokens: [token], box: token.box });
  }
  return lines.map(line => {
    line.tokens.sort((a, b) => a.box.x - b.box.x);
    return { ...line, text: line.tokens.map(t => t.text).join(''), sourceBox: unionRects(line.tokens.map(t => t.sourceBox || t.box)),
      confidence: line.tokens.reduce((sum, t) => sum + t.confidence, 0) / line.tokens.length };
  });
}

function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i += 1) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j += 1) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1)));
    row = next;
  }
  return row[b.length];
}

export function matchCatalogText(text, catalog) {
  const value = normalizeText(text);
  return catalog.flatMap(item => {
    let best = 0;
    let matchedText = '';
    for (const alias of aliases(item)) {
      const name = normalizeText(alias);
      if (name.length < 2) continue;
      const score = value === name ? 1 : value.includes(name) ? 0.94
        : value.length >= 2 && Math.abs(value.length - name.length) <= 1 && editDistance(value, name) === 1 ? 0.7 : 0;
      if (score > best) { best = score; matchedText = alias; }
    }
    return best ? [{ entityId: String(item.id), name: item.name, rarity: Number(item.rarity), score: best, textScore: best, matchedText }] : [];
  }).sort((a, b) => b.score - a.score || a.entityId.localeCompare(b.entityId)).slice(0, 3);
}

const makeId = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
const distinctCandidates = candidates => {
  const byId = new Map();
  for (const candidate of candidates.slice().sort((a, b) => b.score - a.score)) if (!byId.has(candidate.entityId)) byId.set(candidate.entityId, candidate);
  return [...byId.values()].slice(0, 3);
};
const count = (text, pattern) => { const m = text.match(pattern); return m ? Number(m[1]) : ''; };
const clip = (box, width, height) => ({ x: Math.max(0, box.x), y: Math.max(0, box.y),
  width: Math.max(1, Math.min(box.width, width - Math.max(0, box.x))), height: Math.max(1, Math.min(box.height, height - Math.max(0, box.y))) });

function dateFromText(text, year) {
  const full = text.match(/((?:19|20)\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})(?:日)?(?:\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/u);
  const short = !full && text.match(/(?:^|[^\d])(\d{1,2})[-/月](\d{1,2})(?:日)?/u);
  if (!full && !(short && year)) return { timestamp: '', timePrecision: 'unknown' };
  const y = full ? Number(full[1]) : year;
  const m = Number(full ? full[2] : short[1]);
  const d = Number(full ? full[3] : short[2]);
  if (m < 1 || m > 12 || d < 1 || d > 31 || new Date(y, m - 1, d).getDate() !== d) return { timestamp: '', timePrecision: 'unknown' };
  const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // A visible day is preserved as a day, never assigned an invented exact time.
  return { timestamp: date, timePrecision: 'day' };
}

export function analyzeScreenshot({ tokens = [], diagnostics = {}, pools = [], entities = [], selectedPoolId = '', selectedType: typeChoice = '' }) {
  const width = diagnostics.workWidth || Math.max(1, ...tokens.map(t => t.box.x + t.box.width));
  const height = diagnostics.workHeight || Math.max(1, ...tokens.map(t => t.box.y + t.box.height));
  const scale = diagnostics.scale || 1;
  const selected = pools.find(p => String(p.id) === String(selectedPoolId));
  const selectedType = typeChoice || poolType(selected);
  const catalog = selected || typeChoice ? pools.filter(p => poolType(p) === selectedType) : pools;
  const lines = groupTokensIntoLines(tokens);
  const warnings = [];
  const titles = [];
  for (const line of lines) {
    if (/合计|共计|总计|总抽取|抽数|免费|垫/u.test(line.text)) continue;
    // Use connected windows rather than the entire line (pool date may share its line).
    const spans = line.tokens.flatMap((_, start) => [1, 2, 3, 4].map(length => line.tokens.slice(start, start + length).map(t => t.text).join('')));
    const hits = spans.flatMap(text => matchCatalogText(text, catalog)).sort((a, b) => b.score - a.score);
    if (!hits[0]) continue;
    const prior = titles.at(-1);
    if (prior && Math.abs(centerY(prior.line.box) - centerY(line.box)) < line.box.height * 1.5) continue;
    titles.push({ line, poolId: hits[0].entityId, score: hits[0].score });
  }
  if (!titles.length) {
    const yearLine = lines.find(l => /^(?:19|20)\d{2}年/u.test(normalizeText(l.text)));
    const start = yearLine ? yearLine.box.y : 0;
    titles.push({ line: { box: { x: 0, y: start, width, height: 0 }, text: selected?.name || '未匹配卡池' }, poolId: selectedPoolId || '', score: 0 });
    warnings.push('未识别到目录中的卡池标题，请手动确认所属卡池；顶部账号汇总不会自动作为整池总数。');
  }

  const segments = titles.map((title, index) => {
    const start = title.line.box.y;
    const end = titles[index + 1]?.line.box.y ?? height;
    const relevant = lines.filter(l => centerY(l.box) >= start && centerY(l.box) < end);
    const pool = pools.find(p => String(p.id) === title.poolId);
    const eligible = entitiesForWorkbenchPool(pool || selected, entities).filter(e => [5, 6].includes(Number(e.rarity)));
    const yearAt = y => Number(lines.filter(l => l.box.y <= y && /(?:19|20)\d{2}年/u.test(l.text)).at(-1)?.text.match(/((?:19|20)\d{2})年/u)?.[1]) || null;
    const totalLine = relevant.find(l => /(?:合计|共计|总计)\s*\d+\s*抽/u.test(l.text));
    const pityLine = relevant.find(l => /垫\s*\d+/u.test(l.text));
    const segment = { id: makeId('segment'), poolId: title.poolId, poolName: pool?.name || title.line.text,
      poolConfirmed: false, poolGuess: title.score > 0, confidence: title.score,
      totalPulls: totalLine ? count(totalLine.text, /(?:合计|共计|总计)\s*(\d+)\s*抽/u) : '',
      pity: pityLine ? count(pityLine.text, /垫\s*(\d+)/u) : '', fiveStarCount: '', sixStarCount: '', initialPity: '', complete: false,
      countMeaning: 'unknown', countsConfirmed: false, rows: [],
      box: { x: 0, y: start, width, height: end - start }, sourceBox: { x: 0, y: start / scale, width: width / scale, height: (end - start) / scale } };
    const batchLines = relevant.filter(l => /第\s*\d+\s*个?\s*十[连連]/u.test(l.text));
    const freeMarkers = relevant.filter(l => /免费(?:十[连連]|抽取|招募)?/u.test(l.text));
    const anchors = relevant.flatMap(line => {
      if (/合计|共计|总计|总抽取|抽数|垫\s*\d+/u.test(line.text)) return [];
      const match = normalizeText(line.text).match(/^(\d{1,4})抽(?:歪|up|超欧|超非)?$/u);
      const tokenAnchors = line.tokens.filter(t => /^\d{1,4}抽$/u.test(normalizeText(t.text)));
      if (tokenAnchors.length) return tokenAnchors.map(t => ({ line, token: t, n: Number(normalizeText(t.text).match(/^\d+/u)[0]) }));
      return match ? [{ line, token: { ...line, sourceBox: line.sourceBox }, n: Number(match[1]) }] : [];
    });
    for (let i = 0; i < anchors.length; i += 1) {
      const a = anchors[i];
      const cy = centerY(a.token.box);
      const pitch = Math.max(a.token.box.height * 4, Math.min(anchors[i + 1] ? centerY(anchors[i + 1].token.box) - cy : height, anchors[i - 1] ? cy - centerY(anchors[i - 1].token.box) : height, width * 0.22));
      const rowTokens = tokens.filter(t => centerY(t.box) >= Math.max(start, cy - pitch * 0.48) && centerY(t.box) <= Math.min(end, cy + pitch * 0.48));
      const text = rowTokens.map(t => t.text).join(' ');
      const candidates = rowTokens.flatMap(t => matchCatalogText(t.text, eligible)).sort((a, b) => b.score - a.score);
      const unique = distinctCandidates(candidates);
      const free = freeMarkers.some(l => centerY(l.box) < cy) || /免费/u.test(text);
      const status = /至今|^[?？×x]$/u.test(text) && !unique.length;
      if (status) { if (!free && segment.pity === '') segment.pity = a.n; continue; }
      const dateTokens = rowTokens.filter(t => centerY(t.box) > cy && /\d{1,2}[-/月]\d{1,2}/u.test(t.text));
      const dateTop = dateTokens.map(t => t.box.y).sort((a, b) => a - b)[0];
      const side = Math.min(width * .18, Math.max(72, Math.min(104, a.token.box.height * 1.8)), dateTop > cy ? (dateTop - cy) * 2 : Infinity);
      const gap = Math.max(10, Math.min(16, a.token.box.height * .26));
      const iconBox = clip({ x: Math.min(a.token.box.x - side - gap, ...dateTokens.map(t => t.box.x)), y: cy - side / 2, width: side, height: side }, width, height);
      const sourceIconBox = Object.fromEntries(Object.entries(iconBox).map(([k, v]) => [k, v / scale]));
      segment.rows.push({ id: makeId('row'), entityId: unique[0]?.entityId || '', rarity: unique[0]?.rarity || 6,
        rarityConfirmed: Boolean(unique[0]), entityConfirmed: false, candidates: unique, confidence: a.token.confidence,
        rawPullCount: a.n, pullMeaning: free ? 'index' : 'unknown', pullIndex: '', intervalPulls: '',
        drawMethod: free ? 'free' : 'normal', isOffRate: /歪/u.test(text) ? true : /(?:^|\s)UP(?:\s|$)/iu.test(text) ? false : '',
        ...dateFromText(text, yearAt(cy)), sourceBox: unionRects([...rowTokens.map(t => t.sourceBox || t.box), sourceIconBox]), sourceIconBox,
        sourceSupportBox: { x: Math.max(0, iconBox.x / scale), y: (iconBox.y + iconBox.height + 4) / scale,
          width: Math.max(1, (width * .65 - iconBox.x) / scale), height: Math.max(1, (Math.min(end, cy + pitch * .5) - iconBox.y - iconBox.height - 4) / scale) },
        evidenceText: text, origin: 'bar', included: true, confirmed: false });
    }
    // Weapon ten-pull cards: the square's corner number is quantity, not an absolute pull index.
    for (let i = 0; i < batchLines.length; i += 1) {
      const batch = batchLines[i];
      const batchIndex = count(batch.text, /第\s*(\d+)\s*个?\s*十[连連]/u);
      const cy = centerY(batch.box);
      const pitch = Math.min(batchLines[i + 1] ? centerY(batchLines[i + 1].box) - cy : Infinity, batchLines[i - 1] ? cy - centerY(batchLines[i - 1].box) : Infinity, width * 0.2);
      // The claim label sits to the right of the grid, below its top-right quantity badges.
      const y0 = Math.max(start, cy - Math.max(batch.box.height * 3.5, pitch * 0.65));
      const y1 = Math.min(end, cy + Math.min(batch.box.height, pitch * 0.25));
      const labelToken = batch.tokens.find(t => /第\s*\d+\s*个?\s*十[连連]/u.test(t.text)) || batch;
      const badges = tokens.filter(t => centerY(t.box) > y0 && centerY(t.box) < y1 && centerX(t.box) < labelToken.box.x && /^(?:[x×])?\s*(?:[1-9]|10)$/u.test(t.text.trim()));
      const named = tokens.filter(t => centerY(t.box) > y0 && centerY(t.box) < y1 && centerX(t.box) < labelToken.box.x && matchCatalogText(t.text, eligible).length);
      const anchorsForGrid = badges.length ? badges : named;
      for (const token of anchorsForGrid) {
        const quantity = badges.length ? Number(token.text.replace(/\D/gu, '')) : 1;
        const side = Math.min(width * 0.18, Math.max(token.box.height * 3.2, 28));
        const nearby = named.filter(t => Math.abs(centerX(t.box) - centerX(token.box)) < side && Math.abs(centerY(t.box) - centerY(token.box)) < side);
        const candidates = distinctCandidates(nearby.flatMap(t => matchCatalogText(t.text, eligible)));
        const sourceIconBox = Object.fromEntries(Object.entries(clip({ x: token.box.x + token.box.width - side, y: token.box.y + token.box.height - side, width: side, height: side }, width, height)).map(([k, v]) => [k, v / scale]));
        for (let n = 0; n < quantity; n += 1) segment.rows.push({ id: makeId('grid'), entityId: candidates[0]?.entityId || '', rarity: candidates[0]?.rarity || 6,
          rarityConfirmed: Boolean(candidates[0]), entityConfirmed: false, candidates, confidence: token.confidence,
          rawPullCount: '', pullMeaning: 'unknown', pullIndex: '', intervalPulls: '', batchIndex, badgeQuantity: quantity,
          drawMethod: 'normal', isOffRate: '', timestamp: '', timePrecision: 'unknown', sourceIconBox,
          sourceBox: sourceIconBox, evidenceText: `第${batchIndex}十连 · 方格角标${quantity}（第${n + 1}件）`, origin: 'grid', included: true, confirmed: false });
      }
    }
    return segment;
  });
  if (!segments.some(s => s.rows.length)) warnings.push('未识别到可用高星记录。可以对照原图添加，未知头像或卡池需要人工补充。');
  return { segments, warnings, tokens, diagnostics };
}

export function createManualRow() {
  return { id: makeId('manual'), entityId: '', rarity: 6, rarityConfirmed: false, entityConfirmed: false, candidates: [],
    rawPullCount: '', pullMeaning: 'unknown', pullIndex: '', intervalPulls: '', drawMethod: 'normal', isOffRate: '',
    timestamp: '', timePrecision: 'unknown', evidenceText: '手工补充', origin: 'manual', included: true, confirmed: false };
}

export function createManualSegment() {
  return { id: makeId('segment'), poolId: '', poolName: '手工补充池段', poolConfirmed: false, poolGuess: false,
    totalPulls: '', pity: '', fiveStarCount: '', sixStarCount: '', initialPity: '', complete: false,
    countMeaning: 'unknown', countsConfirmed: false, rows: [] };
}

export function applyNormalCountMeaning(segments, meaning) {
  return segments.map(segment => ({ ...segment, countMeaning: meaning,
    rows: segment.rows.map(row => row.drawMethod === 'normal' && row.origin === 'bar'
      ? { ...row, pullMeaning: 'unknown', confirmed: false } : row) }));
}

export function buildScreenshotEntries(segments, { pools = [], entities = [], scope = null, existingHistory = [], existingEntries = [] } = {}) {
  const warnings = [];
  const errors = [];
  const entries = [];
  if (!segments.length) errors.push('请至少保留或补充一个卡池段');
  const optionalInteger = (value, label, allowZero = true) => {
    if (value === '' || value == null) return undefined;
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < (allowZero ? 0 : 1) || n > 1000000) { errors.push(`${label}必须为${allowZero ? '非负' : '正'}整数`); return undefined; }
    return n;
  };
  for (const segment of segments) {
    const pool = pools.find(p => String(p.id) === String(segment.poolId));
    if (!pool || !segment.poolConfirmed) { errors.push(`${segment.poolName}：请确认目录中的卡池`); continue; }
    if (isWorkbenchPoolUnopened(pool)) { errors.push(workbenchPoolUnavailableMessage(pool)); continue; }
    if (!resolvePoolCapabilities(pool).isResolved) { errors.push(`${pool.name}：卡池规则尚未分类，请选择规则明确的目录卡池`); continue; }
    if (!segment.countsConfirmed) errors.push(`${pool.name}：请核对数量与截图覆盖范围`);
    if (segment.fiveStarHints?.length && !segment.fiveStarHintsReviewed) errors.push(`${pool.name}：请核对横条下方的五星头像提示`);
    const values = { drawMethod: 'normal', coverageMode: 'pool', complete: Boolean(segment.complete), acquisitions: [] };
    for (const key of ['totalPulls', 'fiveStarCount', 'sixStarCount', 'pity', 'initialPity']) {
      const n = optionalInteger(segment[key], `${pool.name} ${key}`);
      if (n != null) values[key] = n;
    }
    for (const row of segment.rows.filter(r => r.included)) {
      const entity = entities.find(e => String(e.id) === String(row.entityId));
      if (!entity || !row.entityConfirmed || !row.confirmed) { errors.push(`${pool.name}：请补充并确认每条角色 / 武器`); continue; }
      if (![5, 6].includes(Number(entity.rarity)) || entity.type !== poolEntityType(pool)) { errors.push(`${pool.name}：实体星级或类型不匹配`); continue; }
      if (!entitiesForWorkbenchPool(pool, entities).includes(entity)) { errors.push(`${pool.name}：该角色或武器不在本池名单中`); continue; }
      const acquisition = { id: row.id, entityId: String(entity.id), rarity: Number(entity.rarity), quantity: 1,
        drawMethod: row.drawMethod, timePrecision: row.timestamp ? row.timePrecision : 'unknown' };
      if (!['normal', 'free', 'gift', 'info_book'].includes(row.drawMethod)) errors.push(`${pool.name}：抽取方式无效`);
      const meaning = row.pullMeaning !== 'unknown' ? row.pullMeaning : row.drawMethod === 'normal' && row.origin === 'bar' ? segment.countMeaning : 'unknown';
      if (row.rawPullCount !== '' && row.rawPullCount != null && meaning === 'unknown') errors.push(`${pool.name}：请确认“N抽”表示出货间隔还是池内位置`);
      for (const key of ['pullIndex', 'intervalPulls']) {
        const raw = row[key] !== '' && row[key] != null ? row[key] : meaning === (key === 'pullIndex' ? 'index' : 'interval') ? row.rawPullCount : '';
        const n = optionalInteger(raw, `${pool.name} ${key}`, false);
        if (n != null) acquisition[key] = n;
      }
      const batchIndex = optionalInteger(row.batchIndex, `${pool.name} 十连批次`, false);
      if (batchIndex != null) acquisition.batchIndex = batchIndex;
      if (row.isOffRate !== '' && row.isOffRate != null) acquisition.isOffRate = row.isOffRate === true || row.isOffRate === 'true';
      if (row.timestamp) {
        if (!Number.isFinite(Date.parse(row.timestamp)) || !['day', 'second'].includes(row.timePrecision)) errors.push(`${pool.name}：时间或精度无效`);
        else acquisition.timestamp = row.timestamp;
      }
      if (acquisition.drawMethod === 'normal' && values.totalPulls != null && acquisition.pullIndex > values.totalPulls) errors.push(`${pool.name}：池内位置超过普通抽数总量`);
      // An interval may exceed this pool's total because pity can carry across pools.
      values.acquisitions.push(acquisition);
    }
    if (!values.acquisitions.length && !Object.keys(values).some(k => ['totalPulls', 'pity', 'fiveStarCount', 'sixStarCount'].includes(k))) errors.push(`${pool.name}：至少填写一个数量或一条高星记录`);
    for (const [rarity, key] of [[5, 'fiveStarCount'], [6, 'sixStarCount']]) {
      if (values[key] != null && values.acquisitions.filter(r => r.drawMethod === 'normal' && r.rarity === rarity).length > values[key]) errors.push(`${pool.name}：已确认${rarity}星记录超过该星级总数`);
    }
    if (values.totalPulls != null && (values.fiveStarCount || 0) + (values.sixStarCount || 0) > values.totalPulls) errors.push(`${pool.name}：高星总数超过总抽数`);
    if (existingEntries.some(e => String(e.poolId) === String(pool.id)) || existingHistory.some(r => String(r.poolId ?? r.pool_id) === String(pool.id))) warnings.push(`${pool.name} 已有数据；此结果作为待审草稿追加，请检查重复及截图日期后的记录。`);
    if (!values.complete) warnings.push(`${pool.name} 未标记完整覆盖，不应据此删除既有记录或推断未出现的高星。`);
    const entryId = globalThis.crypto.randomUUID();
    entries.push({ entryId, kind: 'pool-ledger', source: 'xhh', poolId: String(pool.id), values, timePrecision: 'unknown', reviewState: 'unreviewed',
      evidence: { source: 'xhh', scope, title: segment.poolName } });
  }
  return { entries, warnings: [...new Set(warnings)], errors: [...new Set(errors)] };
}
