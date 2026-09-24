// Official poolVersion is record metadata, never part of the pool identity.
export function normalizePoolVersion(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!['number', 'string'].includes(typeof value)) return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const version = Number(value);
  return Number.isInteger(version) && version > 0 && version <= 2147483647 ? version : null;
}

export function getRecordPoolVersion(record) {
  return normalizePoolVersion(record?.poolVersion ?? record?.pool_version);
}
