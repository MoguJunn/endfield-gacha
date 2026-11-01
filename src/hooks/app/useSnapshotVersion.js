import { useEffect, useState } from 'react';
import { checkSnapshotVersions, getKnownSnapshotVersions, SNAPSHOT_EVENT_MIN_INTERVAL_MS, subscribeSnapshotChanges } from '../../services/snapshotChangeService.js';

export function useSnapshotVersion(ownerId = '') {
  const [versions, setVersions] = useState(() => getKnownSnapshotVersions(ownerId));
  useEffect(() => {
    let active = true;
    const accept = value => {
      if (!active) return;
      setVersions(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value);
    };
    const unsubscribe = subscribeSnapshotChanges(ownerId, accept);
    void checkSnapshotVersions(ownerId, { force: true, minIntervalMs: SNAPSHOT_EVENT_MIN_INTERVAL_MS }).then(accept).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, [ownerId]);
  return versions;
}
