/* eslint-disable no-await-in-loop -- Bounded image decoding batches support cancellation. */
// Seven crop views preserve the previous demo's tolerance for icon alignment.
// Candidate scores only suggest identities; every imported identity is confirmed by the user.
import { entitiesForWorkbenchPool } from '../workbenchCatalog.js';
const descriptorCache = new Map();
const views = [[1, 0, 0], [.9, 0, 0], [.8, 0, 0], [.9, -.06, 0], [.9, .06, 0], [.9, 0, -.06], [.9, 0, .06]];
const abort = signal => { if (signal?.aborted) throw Object.assign(new Error('已取消截图识别'), { name: 'AbortError' }); };

function descriptor(drawable, rect = null, view = views[0]) {
  const width = drawable.width || drawable.naturalWidth;
  const height = drawable.height || drawable.naturalHeight;
  const side = Math.min(width, height);
  const base = rect || { x: (width - side) / 2, y: (height - side) / 2, width: side, height: side };
  const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 48;
  const box = { x: Math.max(0, Math.min(48 - 48 * view[0], 48 * ((1 - view[0]) / 2 + view[1]))),
    y: Math.max(0, Math.min(48 - 48 * view[0], 48 * ((1 - view[0]) / 2 + view[2]))), width: 48 * view[0], height: 48 * view[0] };
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(drawable, base.x, base.y, base.width, base.height, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const inset = Math.round(Math.min(box.width, box.height) * .08);
  const pixels = []; const lum = []; const histogram = new Array(64).fill(0);
  let saturationTotal = 0; let colored = 0;
  for (let at = 0; at < 144; at++) {
    const x = Math.min(canvas.width - 1, Math.round(box.x + inset + (at % 12 + .5) / 12 * (box.width - inset * 2)));
    const y = Math.min(canvas.height - 1, Math.round(box.y + inset + (Math.floor(at / 12) + .5) / 12 * (box.height - inset * 2)));
    const i = (y * canvas.width + x) * 4;
    const alpha = data[i + 3] / 255;
    const [r, g, b] = [0, 1, 2].map(channel => (data[i + channel] * alpha + 244 * (1 - alpha)) / 255);
    const maximum = Math.max(r, g, b); const saturation = maximum > .01 ? (maximum - Math.min(r, g, b)) / maximum : 0;
    saturationTotal += saturation; if (saturation >= .14) colored++;
    pixels.push(r, g, b); lum.push(r * 0.299 + g * 0.587 + b * 0.114);
    histogram[(Math.min(3, Math.floor(r * 4)) * 4 + Math.min(3, Math.floor(g * 4))) * 4 + Math.min(3, Math.floor(b * 4))] += 1 / 144;
  }
  const mean = pixels.reduce((s, n) => s + n, 0) / pixels.length;
  const variance = pixels.reduce((s, n) => s + (n - mean) ** 2, 0) / pixels.length;
  const edges = lum.flatMap((n, i) => [lum[Math.floor(i / 12) * 12 + Math.min(11, i % 12 + 1)] - n, lum[Math.min(11, Math.floor(i / 12) + 1) * 12 + i % 12] - n]);
  canvas.width = 1; canvas.height = 1;
  const edgeMean = edges.reduce((sum, value) => sum + value, 0) / edges.length;
  return { pixels: pixels.map(n => n - mean), edges: edges.map(n => n - edgeMean), histogram, variance,
    placeholder: saturationTotal / 144 <= .08 && colored / 144 <= .08 };
}

function cosine(a, b) {
  const norm = Math.sqrt(a.reduce((s, n) => s + n * n, 0) * b.reduce((s, n) => s + n * n, 0));
  return norm ? Math.max(0, Math.min(1, (a.reduce((s, n, i) => s + n * b[i], 0) / norm + 1) / 2)) : 0;
}

export function compareDescriptors(a, b) {
  return cosine(a.pixels, b.pixels) * 0.5 + cosine(a.edges, b.edges) * 0.3 + a.histogram.reduce((s, n, i) => s + Math.min(n, b.histogram[i]), 0) * 0.2;
}

function descriptorSet(drawable, rect) { return views.map(view => descriptor(drawable, rect, view)); }
function compareSets(a, b) {
  const scores = a.flatMap(left => b.map(right => compareDescriptors(left, right))).sort((x, y) => y - x);
  return scores[0] * .75 + (scores[0] + scores[1] + scores[2]) / 3 * .25;
}

// Detect colored square thumbnails in the support strip before suggesting identity.
function supportBoxes(image, row) {
  const rect = row.sourceSupportBox;
  if (!rect || rect.height < 12 || rect.y >= image.height) return [];
  const scale = Math.min(1, 240 / rect.width);
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(rect.width * scale); canvas.height = Math.ceil(Math.min(rect.height, image.height - rect.y) * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, rect.x, rect.y, rect.width, canvas.height / scale, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const columns = Array.from({ length: canvas.width }, (_, x) => {
    const ys = [];
    for (let y = 0; y < canvas.height; y++) {
      const i = (y * canvas.width + x) * 4; const max = Math.max(data[i], data[i + 1], data[i + 2]); const min = Math.min(data[i], data[i + 1], data[i + 2]);
      if (max - min > 24 && max > 65 && min < 220) ys.push(y);
    }
    return ys;
  });
  const result = []; let start = -1; let last = -1;
  const finish = () => {
    if (start < 0) return;
    const ys = columns.slice(start, last + 1).flat(); const w = last - start + 1; const h = Math.max(...ys) - Math.min(...ys) + 1;
    const main = row.sourceIconBox.width * scale;
    if (w >= main * .2 && w <= main * .95 && h >= main * .2 && h <= main * .95 && w / h > .45 && w / h < 2) {
      const size = Math.min(main * .85, Math.max(w, h) + 4);
      result.push({ x: rect.x + Math.max(0, (start + last + 1 - size) / 2) / scale,
        y: rect.y + Math.max(0, (Math.min(...ys) + Math.max(...ys) + 1 - size) / 2) / scale, width: size / scale, height: size / scale });
    }
    start = -1;
  };
  columns.forEach((ys, x) => { if (ys.length >= 3) { if (start < 0) start = x; last = x; } else if (start >= 0 && x - last > 2) finish(); }); finish();
  return result.slice(0, 12);
}

export async function addVisualCandidates(result, file, { pools, entities, signal, onProgress }) {
  abort(signal);
  const image = await createImageBitmap(file);
  try {
    const allowedIds = new Set(result.segments.flatMap(segment => entitiesForWorkbenchPool(pools.find(p => String(p.id) === String(segment.poolId)), entities).map(entity => String(entity.id))));
    const catalog = entities.filter(e => allowedIds.has(String(e.id)) && [5, 6].includes(Number(e.rarity)));
    const references = [];
    let failures = 0;
    for (let i = 0; i < catalog.length; i += 4) {
      abort(signal);
      await Promise.all(catalog.slice(i, i + 4).map(async entity => {
      const url = entity.avatarUrl || entity.avatar_url || `/avatars/${entity.type}s/${entity.id}.webp`;
      onProgress?.({ message: `核对角色 / 武器头像 ${i + 1} / ${catalog.length}`, current: i, total: catalog.length });
      try {
        let value = descriptorCache.get(url);
        if (!value) {
          const response = await fetch(url, { signal, cache: 'force-cache' });
          if (!response.ok) throw new Error(`头像 ${response.status}`);
          const bitmap = await createImageBitmap(await response.blob());
          try { value = descriptorSet(bitmap); descriptorCache.set(url, value); } finally { bitmap.close(); }
        }
        references.push({ entity, descriptor: value });
      } catch (error) { abort(signal); failures += 1; if (error.name === 'AbortError') throw error; }
      }));
    }
    const cropCache = new Map(); const scoreCache = new WeakMap();
    const cropAt = rect => {
      const key = [rect.x, rect.y, rect.width, rect.height].map(value => value.toFixed(2)).join(':');
      if (!cropCache.has(key)) cropCache.set(key, descriptorSet(image, rect));
      return cropCache.get(key);
    };
    const segments = result.segments.map(segment => {
      abort(signal);
      const allowed = new Set(entitiesForWorkbenchPool(pools.find(p => String(p.id) === String(segment.poolId)), entities).map(entity => String(entity.id)));
      const poolRefs = references.filter(ref => allowed.has(String(ref.entity.id)));
      const rank = (crop, row, rarity) => poolRefs.filter(ref => !rarity || Number(ref.entity.rarity) === rarity).map(({ entity, descriptor: ref }) => {
        if (!scoreCache.has(crop)) scoreCache.set(crop, new Map());
        const cache = scoreCache.get(crop);
        if (!cache.has(entity.id)) cache.set(entity.id, compareSets(crop, ref));
        const iconScore = cache.get(entity.id);
        const textScore = row.candidates.find(c => c.entityId === String(entity.id))?.textScore || 0;
        return { entityId: String(entity.id), name: entity.name, rarity: Number(entity.rarity), score: textScore ? textScore * .45 + iconScore * .55 : iconScore, iconScore, textScore };
      }).sort((a, b) => b.score - a.score).slice(0, 3);
      const fiveStarHints = segment.rows.flatMap(row => supportBoxes(image, row).map(box => {
        const candidates = rank(cropAt(box), { candidates: [] }, 5);
        return { sourceBox: box, drawMethod: row.drawMethod, candidates, entityId: candidates[0]?.iconScore >= .72 ? candidates[0].entityId : '' };
      }));
      return { ...segment, fiveStarHints, fiveStarHintsReviewed: false, rows: segment.rows.map(row => {
        if (!row.sourceIconBox) return row;
        try {
          const crop = cropAt(row.sourceIconBox);
          if (crop[0].variance < 0.0015 || crop[2].placeholder) return { ...row, visualStatus: 'placeholder', entityId: '', candidates: [] };
          const candidates = rank(crop, row, row.origin === 'bar' ? 6 : undefined);
          const top = candidates[0];
          const reliable = top && (top.textScore >= 0.94 || (top.iconScore >= 0.62 && top.score - (candidates[1]?.score || 0) >= 0.03));
          return { ...row, candidates: candidates.length ? candidates : row.candidates, entityId: reliable ? top.entityId : row.entityId,
            rarity: reliable ? top.rarity : row.rarity, visualStatus: reliable ? 'suggested' : 'uncertain', entityConfirmed: false };
        } catch { return { ...row, visualStatus: 'failed' }; }
      }) };
    });
    return { ...result, segments, warnings: [...result.warnings, ...(failures ? [`${failures} 个目录头像未能读取，相关身份请手动确认。`] : [])] };
  } finally { image.close(); }
}
