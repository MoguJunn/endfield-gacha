import { targetProbabilityDistribution } from './targetProbabilityDistribution.js';
import { readStorageValue, writeStorageValue } from './storageUtils.js';

// Bump this version when the model changes. Rule values and every input are
// also part of the key, so a catalog/rule update cannot reuse the old curve.
const STORAGE_KEY = 'endfield-target-probability-v1';
const MODEL_VERSION = 1;
const MAX_CURVES = 12;

export function cachedTargetProbabilityDistribution({ rules, unit = 'pull', currentPity = 0,
  guaranteeProgress = 0, guaranteeUsed = false, horizon = 160 }) {
  const options = { rules, unit, currentPity, guaranteeProgress, guaranteeUsed, horizon };
  const key = JSON.stringify({ ...options, rules: Object.fromEntries(Object.entries(rules || {}).sort(([a], [b]) => a.localeCompare(b))) });
  let curves = [];
  try {
    const saved = JSON.parse(readStorageValue(STORAGE_KEY, null, { raw: true }));
    if (saved?.modelVersion === MODEL_VERSION && Array.isArray(saved.curves)) curves = saved.curves.filter(curve => typeof curve?.key === 'string');
    const result = curves.find(curve => curve.key === key)?.result;
    if (result?.unit === unit && result.points?.length === horizon + 1
      && Number.isFinite(result.expectedCapped) && Number.isFinite(result.tailProbability)
      && result.points.every(point => Number.isFinite(point.cost) && Number.isFinite(point.probability) && Number.isFinite(point.cumulativeRate))) {
      return result;
    }
  } catch { /* Recompute missing or corrupt local results. */ }
  const result = targetProbabilityDistribution(options);
  try {
    writeStorageValue(STORAGE_KEY, JSON.stringify({ modelVersion: MODEL_VERSION,
      curves: [{ key, result }, ...curves.filter(curve => curve.key !== key)].slice(0, MAX_CURVES) }), { raw: true });
  } catch { /* The computed result remains usable when browser storage is denied. */ }
  return result;
}
