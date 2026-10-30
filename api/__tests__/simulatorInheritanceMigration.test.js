// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERSONAL_ANALYSIS_SCHEMA_VERSION } from '../_lib/personalAnalysisWorker.js';

const migration = '2026100901_simulator_inheritance_v2.sql';

describe('simulator inheritance v2 snapshot migration', () => {
  it('queues schema v3 rebuilds without replacing snapshots, source identities, ACLs or leases', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations', migration), 'utf8');
    expect(sql.match(/analysis_schema_version SET DEFAULT 3/g)).toHaveLength(2);
    expect(sql).toContain('enforce_personal_analysis_schema_v3');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).not.toMatch(/(?:DROP|CREATE) TABLE/i);
    expect(sql).not.toMatch(/(?:DELETE FROM|UPDATE) public\.personal_analysis_snapshots/i);
    expect(sql).not.toMatch(/lease_(?:id|expires_at)\s*=/i);
    expect(sql).not.toMatch(/source_(?:game_uid|server_scope)\s*=/i);
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.invalidate_personal_analysis_after_pool_change()');
  });

  it('keeps the regenerated baseline inclusive of history pool versions and schema v3', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/baseline/000_complete_schema.sql'), 'utf8');
    expect(sql).toContain('-- >>> BEGIN MIGRATION: active/194_add_history_pool_version.sql');
    expect(sql).toContain(`-- >>> BEGIN MIGRATION: active/${migration}`);
  });

  it('matches the active worker schema to the later trusted-statistics migration', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/2026101400_exclude_manual_statistics.sql'), 'utf8');
    expect(PERSONAL_ANALYSIS_SCHEMA_VERSION).toBeGreaterThanOrEqual(5);
    expect(sql.match(/analysis_schema_version SET DEFAULT 5/g)).toHaveLength(2);
    expect(sql).toContain('enforce_personal_analysis_schema_v5');
  });
  it('queues corrected guarantee rates at the active schema without deleting snapshots or leases', () => {
    const migrationName = '2026103100_personal_win_rate_guarantee.sql';
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations', migrationName), 'utf8');
    expect(PERSONAL_ANALYSIS_SCHEMA_VERSION).toBe(6);
    expect(sql.match(/analysis_schema_version SET DEFAULT 6/g)).toHaveLength(2);
    expect(sql.match(/WHERE analysis_schema_version < 6/g)).toHaveLength(2);
    expect(sql).not.toMatch(/(?:DELETE FROM|UPDATE) public\.personal_analysis_snapshots/i);
    expect(sql).not.toMatch(/lease_(?:id|expires_at)\s*=/i);
    const baseline = fs.readFileSync(path.join(process.cwd(), 'supabase/baseline/000_complete_schema.sql'), 'utf8');
    expect(baseline).toContain(`-- >>> BEGIN MIGRATION: active/${migrationName}`);
  });
});
