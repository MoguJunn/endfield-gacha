import { describe, expect, it } from 'vitest';
import { getMostImportantAnnouncement } from '../announcementMeta.js';

describe('getMostImportantAnnouncement', () => {
  it('uses the most severe temporary announcement color before numeric priority', () => {
    const result = getMostImportantAnnouncement([
      { id: 'warning', severity: 'warning', priority: 999 },
      { id: 'critical', severity: 'critical', priority: 1 },
      { id: 'success', severity: 'success', priority: 2000 },
    ]);

    expect(result?.id).toBe('critical');
  });

  it('uses priority and update time to break ties', () => {
    const result = getMostImportantAnnouncement([
      { id: 'older', severity: 'warning', priority: 10, updated_at: '2026-08-20T00:00:00Z' },
      { id: 'newer', severity: 'warning', priority: 10, updated_at: '2026-08-21T00:00:00Z' },
      { id: 'lower', severity: 'warning', priority: 5, updated_at: '2026-08-22T00:00:00Z' },
    ]);

    expect(result?.id).toBe('newer');
  });
});
