// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readMigration(name) {
  return readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
}

function readBaseline() {
  return readFileSync(new URL('../../supabase/baseline/000_complete_schema.sql', import.meta.url), 'utf8');
}

function readBackfillScript() {
  return readFileSync(new URL('../../scripts/backfill-history-anomalies.mjs', import.meta.url), 'utf8');
}

describe('history review database migrations', () => {
  it('uses exact record identity and service-role-only controlled mutations', () => {
    const sql = readMigration('152_add_history_review_and_import_staging.sql');

    expect(sql).toContain('game_uid TEXT NOT NULL');
    expect(sql).toContain('server_scope TEXT NOT NULL');
    expect(sql).toContain('seq_id TEXT NOT NULL');
    expect(sql).toContain('ALTER COLUMN record_id TYPE TEXT');
    expect(sql).toContain('USING record_id::NUMERIC::TEXT');
    expect(sql).not.toContain('FOREIGN KEY (user_id, record_id)');
    expect(sql).toContain('FOREIGN KEY (user_id, game_uid, server_scope, pool_id, seq_id)');
    expect(sql).toContain('AND record_id = v_record.record_id');
    expect(sql).toContain('AND seq_id = v_record.seq_id');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.update_history_record_controlled');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.delete_history_record_controlled');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.delete_history_records_controlled');
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.update_history_record_controlled[\s\S]+FROM PUBLIC, anon, authenticated;/
    );
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.delete_history_record_controlled[\s\S]+TO service_role;/);
  });

  it('commits official pools, history, and task status in one database function', () => {
    const sql = readMigration('153_commit_official_import_records_atomically.sql');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.commit_official_import_records');
    expect(sql).toContain('FOR UPDATE;');
    expect(sql).toContain('INSERT INTO public.pools');
    expect(sql).toContain('INSERT INTO public.history');
    expect(sql).toContain('ON CONFLICT (user_id, game_uid, server_scope, pool_id, seq_id)');
    expect(sql).toContain("status = 'committed'");
    expect(sql).toContain("'atomicCommit', TRUE");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.commit_official_import_records[\s\S]+FROM PUBLIC, anon, authenticated;/
    );
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.commit_official_import_records[\s\S]+TO service_role;/);
  });

  it('rejects ambiguous legacy batch deletion before deleting exact locked rows', () => {
    const sql = readMigration('155_guard_ambiguous_history_batch_delete.sql');

    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('jsonb_build_array(to_jsonb(v_current))');
    expect(sql).toContain('jsonb_to_recordset(v_records)');
    expect(sql).toContain('HAVING COUNT(*) > 1');
    expect(sql).toContain("MESSAGE = 'ambiguous_history_record_id'");
    expect(sql).toContain('jsonb_populate_recordset(NULL::public.history, v_records)');
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.delete_history_records_controlled[\s\S]+TO service_role;/);
  });

  it('includes the review and atomic commit migrations in the fresh-install baseline', () => {
    const baseline = readBaseline();

    expect(baseline).toContain('active/153_commit_official_import_records_atomically.sql');
    expect(baseline).toContain('active/155_guard_ambiguous_history_batch_delete.sql');
    expect(baseline).toContain('CREATE OR REPLACE FUNCTION public.update_history_record_controlled');
    expect(baseline).toContain('CREATE OR REPLACE FUNCTION public.commit_official_import_records');
    expect(baseline).toContain("MESSAGE = 'ambiguous_history_record_id'");
  });

  it('keeps the anomaly backfill read-only by default and guarded by the reviewed snapshot', () => {
    const script = readBackfillScript();

    expect(script).toContain('const EXPECTED_RECORDS = 159;');
    expect(script).toContain('const EXPECTED_USERS = 119;');
    expect(script).toContain("const EXPECTED_POOL_IDS = new Set(['special_1_4_1', 'weponbox_1_4_1']);");
    expect(script).toContain('new Map(rows.map((row) => [getHistoryScopeKey(row), row]))');
    expect(script).toContain("const shouldApply = process.argv.includes('--apply');");
    expect(script).toContain('if (!shouldApply)');
    expect(script).toContain('CONFIRM_HISTORY_ANOMALY_BACKFILL');
    expect(script).toContain('const APPLY_CONFIRMATION = `${EXPECTED_RECORDS}:${EXPECTED_USERS}`;');
    expect(script).toContain('await verifyAnomalyMarkers(client, anomalies);');
  });
});
