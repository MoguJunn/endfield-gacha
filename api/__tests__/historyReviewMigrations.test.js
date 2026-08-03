// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
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

function readMissingOfficialImportAnomalyRepair() {
  return readFileSync(
    new URL(
      '../../supabase/manual/data-backfill/170_backfill_missing_official_import_anomalies.sql',
      import.meta.url
    ),
    'utf8'
  );
}

function readLatestOfficialImportCommitMigration() {
  const migrationDirectory = new URL('../../supabase/migrations/', import.meta.url);
  const migrationNames = readdirSync(migrationDirectory)
    .filter((name) => /^\d+_.+\.sql$/i.test(name))
    .sort((left, right) => {
      const leftNumber = Number(left.match(/^(\d+)/)?.[1] || 0);
      const rightNumber = Number(right.match(/^(\d+)/)?.[1] || 0);
      return leftNumber - rightNumber || left.localeCompare(right);
    });
  let latest = null;

  migrationNames.forEach((name) => {
    const sql = readMigration(name);
    if (sql.includes('CREATE OR REPLACE FUNCTION public.commit_official_import_records')) {
      latest = { name, sql };
    }
  });

  return latest;
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

  it('keeps the latest official import commit aligned with the server-scoped history key', () => {
    const latest = readLatestOfficialImportCommitMigration();
    expect(latest).not.toBeNull();

    const normalizedSql = latest.sql.replace(/\s+/g, ' ');
    expect(normalizedSql).toContain(
      'ON CONFLICT (user_id, game_uid, server_scope, pool_id, seq_id)'
    );
    expect(normalizedSql).not.toContain(
      'ON CONFLICT (user_id, game_uid, server_id, pool_id, seq_id, record_id)'
    );
    expect(normalizedSql).toContain('IF NOT public.is_account_credential_allowed(p_user_id)');
    expect(normalizedSql).toContain("v_task.summary ->> 'newRecords'");
    expect(normalizedSql).toContain('nick_name, rarity, character_name, item_name, character_id');
    expect(normalizedSql).toContain('pity, is_free, is_info_book, is_new, is_standard');
    expect(normalizedSql).toContain('server_id, region, batch_id, special_type');
    expect(normalizedSql).toContain('committed_at = NOW()');
    expect(normalizedSql).toContain("AND status = 'confirming'");
    expect(normalizedSql).toContain('official_import_history_conflict_constraint_missing');
    expect(normalizedSql).toContain('official_import_history_conflict_target_invalid');
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
    expect(baseline).toContain('active/170_restore_official_import_atomic_commit.sql');
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

  it('repairs missing official-import anomaly markers from exact history parent rows', () => {
    const sql = readMissingOfficialImportAnomalyRepair();
    const normalizedSql = sql.replace(/\s+/g, ' ');

    expect(normalizedSql).toContain('IF v_candidate_count <> 10 THEN');
    expect(normalizedSql).toContain('INSERT INTO public.history_anomalies');
    expect(normalizedSql).toContain('FROM public.history AS history_row');
    expect(normalizedSql).toContain("anomaly.issue_code = 'OFFICIAL_IMPORT_UNKNOWN_ITEM'");
    expect(normalizedSql).toContain("history_row.rarity = 4");
    expect(normalizedSql).toContain('history_row.special_type IS NULL');
    expect(normalizedSql).toContain(
      'ON CONFLICT (user_id, game_uid, server_scope, pool_id, seq_id, issue_code) DO NOTHING'
    );
    expect(normalizedSql).toContain("'repairSource', 'production_repair_2026_08_03'");
    expect(normalizedSql).toContain('IF v_inserted_count <> v_candidate_count THEN');
  });
});
