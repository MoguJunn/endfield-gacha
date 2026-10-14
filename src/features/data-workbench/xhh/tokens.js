// Module port of xhh-demo/xhh-ocr-v2-core.mjs (V2 tile geometry and deduplication).
export const normalizeText = value => String(value || '').normalize('NFKC').replace(/[\s\u200b-\u200d\ufeff，,·]/gu, '').toLowerCase();
export const centerY = box => box.y + box.height / 2;
export const centerX = box => box.x + box.width / 2;
export const unionRects = boxes => {
  const valid = boxes.filter(Boolean);
  if (!valid.length) return null;
  const x = Math.min(...valid.map(b => b.x));
  const y = Math.min(...valid.map(b => b.y));
  return { x, y, width: Math.max(...valid.map(b => b.x + b.width)) - x, height: Math.max(...valid.map(b => b.y + b.height)) - y };
};

export function buildTilePlan(width, height, { maxWorkWidth = 1152, tileHeight = 960, overlap = 128 } = {}) {
  if (!(width > 0 && height > 0)) throw new Error('图片尺寸无效');
  const scale = Math.min(1, maxWorkWidth / width);
  const workWidth = Math.max(1, Math.round(width * scale));
  const workHeight = Math.max(1, Math.round(height * scale));
  const size = Math.min(workHeight, Math.max(64, tileHeight));
  const step = Math.max(1, size - Math.min(size - 1, Math.max(0, overlap)));
  const tiles = [];
  let y = 0;
  while (y < workHeight) {
    const h = Math.min(size, workHeight - y);
    tiles.push({ id: `tile-${tiles.length + 1}`, work: { x: 0, y, width: workWidth, height: h },
      source: { x: 0, y: y / scale, width, height: Math.min(height - y / scale, h / scale) } });
    if (y + h >= workHeight) break;
    const next = Math.min(y + step, workHeight - size);
    if (next <= y) break;
    y = next;
  }
  return { sourceWidth: width, sourceHeight: height, workWidth, workHeight, scale, tiles };
}

export function normalizeOcrBox(item) {
  const b = item?.poly || item?.box || item?.bbox || item?.points || item?.dtPoly || item?.boundingBox;
  if (!b) return null;
  if (Number.isFinite(Number(b.x)) && Number(b.width) > 0 && Number(b.height) > 0) {
    return { x: Number(b.x), y: Number(b.y), width: Number(b.width), height: Number(b.height) };
  }
  const raw = Array.isArray(b) ? b : b.points || b.vertices || [];
  const points = raw.length && raw.every(p => Number.isFinite(Number(p)))
    ? raw.reduce((a, p, i) => { if (i % 2 === 0 && i + 1 < raw.length) a.push({ x: Number(p), y: Number(raw[i + 1]) }); return a; }, [])
    : raw.map(p => ({ x: Number(p.x ?? p[0]), y: Number(p.y ?? p[1]) }));
  if (!points.length || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const x = Math.min(...points.map(p => p.x));
  const y = Math.min(...points.map(p => p.y));
  const rect = { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y };
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

export function mapOcrItemsToTokens(items, tile, plan) {
  return (items || []).flatMap((item, i) => {
    const text = String(item.text || item.recText || item.label || '').trim();
    const local = normalizeOcrBox(item);
    if (!text || !local) return [];
    const x = Math.max(0, local.x + tile.work.x);
    const y = Math.max(0, local.y + tile.work.y);
    const box = { x, y, width: Math.min(local.width, plan.workWidth - x), height: Math.min(local.height, plan.workHeight - y) };
    if (box.width <= 0 || box.height <= 0) return [];
    const score = Number(item.score ?? item.confidence ?? item.recScore) || 0;
    return [{ id: `${tile.id}-${i}`, text, normalizedText: normalizeText(text), confidence: Math.min(1, Math.max(0, score > 1 ? score / 100 : score)),
      box, sourceBox: Object.fromEntries(Object.entries(box).map(([key, n]) => [key, n / plan.scale])), tileIds: [tile.id], conflicts: [] }];
  });
}

export function dedupeOcrTokens(tokens) {
  const result = [];
  for (const token of tokens.slice().sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
    const index = result.findIndex(other => {
      if (other.tileIds.some(id => token.tileIds.includes(id))) return false;
      const a = other.box; const b = token.box;
      const area = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      return area / Math.min(a.width * a.height, b.width * b.height) >= (other.normalizedText === token.normalizedText ? 0.5 : 0.72);
    });
    if (index < 0) result.push({ ...token });
    else {
      const prior = result[index];
      const winner = token.confidence > prior.confidence ? token : prior;
      result[index] = { ...winner, tileIds: [...new Set([...prior.tileIds, ...token.tileIds])],
        conflicts: [...prior.conflicts, ...(prior.normalizedText !== token.normalizedText ? [winner === token ? prior.text : token.text] : [])] };
    }
  }
  return result.map((token, i) => ({ ...token, id: `ocr-${i + 1}` }));
}
