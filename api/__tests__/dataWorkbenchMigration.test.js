// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(fileURLToPath(new URL('../../supabase/migrations/2026100911_create_account_data_workbench.sql', import.meta.url)), 'utf8');
const functionSql = name => sql.split(`CREATE FUNCTION public.${name}(`)[1]?.split('\n$$;')[0];

describe('account data workbench migration contract', () => {
  it('invalidates owner and account snapshots for inserts, edits and soft deletes in the write transaction', () => {
    const invalidation = functionSql('invalidate_workbench_personal_analysis');
    expect(sql).toContain('AFTER INSERT OR UPDATE OR DELETE ON public.account_data_workbench_entries');
    expect(sql).toContain('FOR EACH ROW EXECUTE FUNCTION public.invalidate_workbench_personal_analysis()');
    expect(invalidation).toContain('INSERT INTO public.personal_analysis_owner_state');
    expect(invalidation).toContain('INSERT INTO public.personal_analysis_scope_state');
    expect(invalidation).toContain('history_revision = public.personal_analysis_owner_state.history_revision + 1');
    expect(invalidation).toContain('history_revision = public.personal_analysis_scope_state.history_revision + 1');
    expect(invalidation).toContain('IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_row.user_id)');
    expect(invalidation).not.toMatch(/EXCEPTION\s+WHEN/iu);
  });

  it('keeps typed user evidence isolated from official history', () => {
    expect(sql).toContain('UNIQUE (user_id, draft_id, entry_id)');
    expect(sql).toContain("'detail', 'six-star-interval', 'pool-summary', 'batch-summary', 'potential-evidence'");
    expect(sql).toContain('deleted_at TIMESTAMPTZ');
    expect(sql).toContain('revision INTEGER NOT NULL DEFAULT 1');
    expect(sql).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.history\b/iu);
  });

  it('gives owners read-only policies and grants mutations solely through service RPCs', () => {
    for (const table of ['entries', 'commits', 'audit']) {
      expect(sql).toContain(`ALTER TABLE public.account_data_workbench_${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ON public.account_data_workbench_${table}\n  FOR SELECT TO authenticated USING (auth.uid() = user_id AND public.is_request_auth_session_allowed())`);
    }
    expect(sql).not.toMatch(/GRANT\s+(?:ALL|INSERT|UPDATE|DELETE)/iu);
    for (const name of ['read_account_data_workbench_context', 'commit_account_data_workbench', 'mutate_account_data_workbench_entry']) {
      const body = functionSql(name);
      expect(body).toContain('SECURITY DEFINER');
      expect(body).toContain('SET search_path = pg_catalog, public');
      expect(body).toContain("auth.role() IS DISTINCT FROM 'service_role'");
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]+FROM PUBLIC, anon, authenticated;`, 'u'));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]+TO service_role;`, 'u'));
    }
  });

  it('atomically serializes idempotent commits and audits every inserted entry', () => {
    const commit = functionSql('commit_account_data_workbench');
    expect(commit).toContain('jsonb_array_length(p_entries) NOT BETWEEN 1 AND 100');
    expect(commit.indexOf("'workbench-commit:'")).toBeLessThan(commit.indexOf('SELECT * INTO v_prior'));
    expect(commit).toContain('v_prior.payload_hash IS DISTINCT FROM p_payload_hash');
    expect(commit).toContain('RETURN v_prior.result');
    expect(commit).toContain("MESSAGE = 'workbench_entry_already_committed'");
    expect(commit).toMatch(/ON CONFLICT \(user_id, draft_id, entry_id\) DO NOTHING\s+RETURNING \* INTO v_entry;/u);
    expect(commit).toContain("p_draft_id, v_item->>'kind', COALESCE(v_item->>'source', 'manual')");
    expect(commit).toContain('INSERT INTO public.account_data_workbench_audit');
    expect(commit).toContain('INSERT INTO public.account_data_workbench_commits');
    expect(commit).not.toMatch(/EXCEPTION\s+WHEN/iu);
  });

  it('checks revisions under row lock and writes edit/delete audit in the same RPC', () => {
    const mutation = functionSql('mutate_account_data_workbench_entry');
    expect(mutation).toContain('AND deleted_at IS NULL FOR UPDATE');
    expect(mutation).toContain('v_old.revision <> p_expected_revision');
    expect(mutation).toContain('WHERE id = p_id AND user_id = p_user_id AND revision = p_expected_revision');
    expect(mutation).toContain('revision = revision + 1');
    expect(mutation).toContain('SET deleted_at = now()');
    expect(mutation).toContain('to_jsonb(v_old), to_jsonb(v_new)');
    expect(mutation).toContain("MESSAGE = 'workbench_delete_reason_required'");
    expect(mutation).not.toMatch(/EXCEPTION\s+WHEN/iu);
  });

  it('checks complete owner scope and blocks truncated or changed contexts', () => {
    const read = functionSql('read_account_data_workbench_context');
    expect(read).toContain('WHERE user_id = p_user_id');
    expect(read).toContain('WHERE history_row.user_id = p_user_id');
    expect(read).toContain("COALESCE(NULLIF(btrim(history_row.game_uid), ''), 'legacy') = p_game_uid");
    expect(read).toContain('AND history_row.server_scope = p_server_scope');
    expect(read).toContain('game_uid = p_game_uid');
    expect(read).toContain('AND server_scope = p_server_scope');
    expect(read).not.toContain('AND pool_id =');
    expect(read).toContain('LIMIT 50001');
    expect(read).toContain("MESSAGE = 'workbench_scope_too_large'");
    for (const name of ['commit_account_data_workbench', 'mutate_account_data_workbench_entry']) {
      const body = functionSql(name);
      expect(body).toContain("'workbench-scope:'");
      expect(body).toContain("->>'contextToken') IS DISTINCT FROM p_context_token");
      expect(body).toContain("MESSAGE = 'workbench_context_changed'");
      expect(body.indexOf('LOCK TABLE public.history IN SHARE MODE;')).toBeGreaterThan(-1);
      expect(body.indexOf('LOCK TABLE public.history IN SHARE MODE;')).toBeLessThan(body.indexOf("'workbench-scope:'"));
      expect(body.indexOf("'workbench-scope:'")).toBeLessThan(body.indexOf("->>'contextToken'"));
    }
  });
});
