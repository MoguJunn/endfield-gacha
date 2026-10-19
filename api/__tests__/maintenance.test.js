// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../_lib/authAdmin.js', () => ({ getSupabaseAdminClient: vi.fn(() => null) }));
import handler, { readMaintenanceNotice, resetMaintenanceNoticeCache } from '../_routes/root/maintenance.js';
import { DEFAULT_MAINTENANCE_NOTICE } from '../../shared/siteMaintenance.js';

const client = result => {
  const read = vi.fn().mockResolvedValue(result);
  const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: vi.fn(() => query), abortSignal: read };
  return { db: { from: vi.fn(() => query) }, query, read };
};
beforeEach(resetMaintenanceNoticeCache);
describe('public maintenance notice', () => {
  it('serves the upgrade notice on a cold start while the database is unavailable without leaking errors', async () => {
    const { db, read } = client({ error: { message: 'private connection information' } });
    const result = await readMaintenanceNotice(db, () => 100000);
    expect(result).toEqual({ notice: DEFAULT_MAINTENANCE_NOTICE, source: 'deployment' });
    expect(JSON.stringify(result)).not.toContain('private');
    await readMaintenanceNotice(db, () => 100001);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('preserves administrator off state during a later outage and reads only the maintenance key', async () => {
    const { db, query, read } = client({ data: { value: JSON.stringify({ enabled: false, secret: 'must-not-escape' }) } });
    expect((await readMaintenanceNotice(db, () => 100000)).notice.enabled).toBe(false);
    expect(query.select).toHaveBeenCalledWith('value');
    expect(query.eq).toHaveBeenCalledWith('key', 'site_maintenance_notice');
    read.mockResolvedValue({ error: {} });
    const result = await readMaintenanceNotice(db, () => 161000);
    expect(result).toMatchObject({ source: 'last-known', notice: { enabled: false } });
    expect(result.notice).not.toHaveProperty('secret');
  });
  it('coalesces simultaneous reads and caches successful settings', async () => {
    const { db, read } = client({ data: { value: JSON.stringify({ enabled: true, showAffectedServices: false }) } });
    const results = await Promise.all(Array.from({ length: 5 }, () => readMaintenanceNotice(db, () => 100000)));
    expect(results.every(result => result.notice.showAffectedServices === false)).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    await readMaintenanceNotice(db, () => 110000);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('rejects public writes and remains readable without a configured database', async () => {
    const res = { setHeader: vi.fn(), getHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn(), end: vi.fn() };
    await handler({ method: 'POST', headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
    res.status.mockClear();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ enabled: true }) }));
  });
});
