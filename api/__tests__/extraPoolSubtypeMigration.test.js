// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/181_add_extra_pool_subtypes.sql');
const splitSubtypeMigrationPath = path.resolve(
  process.cwd(),
  'supabase/migrations/183_split_reconstruction_claim_subtype.sql'
);
const baselinePath = path.resolve(process.cwd(), 'supabase/baseline/000_complete_schema.sql');

describe('extra pool subtype migration', () => {
  it('keeps extra as the coarse type and classifies only the exact known Joint id', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain("WHERE pool_id = 'joint_1_2_2'");
    expect(sql).toContain("extra_rule_profile = 'brilliance_festival_v1'");
    expect(sql).not.toMatch(/split_part\s*\(\s*pool_id[^;]+extra_subtype\s*=\s*'special'/isu);
    expect(sql).toContain("type = 'extra'");
  });

  it('exposes and writes all four fields through the visible, admin, and import RPC contracts', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    for (const field of [
      'extra_subtype',
      'extra_rule_profile',
      'extra_series_key',
      'extra_series_phase',
    ]) {
      expect(sql.match(new RegExp(field, 'g'))?.length).toBeGreaterThan(5);
    }
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_app_visible_pools()');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.admin_upsert_pool_with_aliases(');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.commit_official_import_records(');
  });

  it('is included in the generated baseline', () => {
    const baseline = fs.readFileSync(baselinePath, 'utf8');
    expect(baseline).toContain('active/181_add_extra_pool_subtypes.sql');
    expect(baseline).toContain('active/182_seed_reconstruction_pools_and_promotion.sql');
    expect(baseline).toContain('active/183_split_reconstruction_claim_subtype.sql');
  });

  it('splits reconstruction claims while keeping the legacy weapon tuple compatible', () => {
    const sql = fs.readFileSync(splitSubtypeMigrationPath, 'utf8');

    expect(sql).toContain("extra_subtype IN ('reconstruction', 'reconstruction_claim', 'special')");
    expect(sql).toMatch(/extra_subtype = 'reconstruction'\s+AND extra_rule_profile = 'reconstruction_character_v1'/u);
    expect(sql).toMatch(/extra_subtype = 'reconstruction_claim'\s+AND extra_rule_profile = 'reconstruction_weapon_v1'/u);
    expect(sql).toMatch(/NEW\.type = 'extra'[\s\S]+NEW\.extra_subtype = 'reconstruction'[\s\S]+NEW\.extra_rule_profile = 'reconstruction_weapon_v1'[\s\S]+NEW\.extra_subtype := 'reconstruction_claim'/u);
    expect(sql).toMatch(/UPDATE public\.pools[\s\S]+extra_subtype = 'reconstruction_claim'[\s\S]+WHERE type = 'extra'[\s\S]+extra_subtype = 'reconstruction'[\s\S]+extra_rule_profile = 'reconstruction_weapon_v1'/u);
  });

  it('rebuilds only the JSON admin overload and keeps both promotion products service-only', () => {
    const sql = fs.readFileSync(splitSubtypeMigrationPath, 'utf8');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.admin_upsert_pool_with_aliases(');
    expect(sql).toContain('TEXT, JSONB, JSONB, JSONB, JSONB, UUID');
    expect(sql).not.toContain('p_name TEXT');
    expect(sql).toContain("v_extra_subtype = 'reconstruction_claim'");
    expect(sql).toContain("v_manual.extra_subtype = 'reconstruction'");
    expect(sql).toContain("v_manual.extra_subtype = 'reconstruction_claim'");
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.promote_manual_pool_to_official_id(TEXT, JSONB)');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.promote_manual_pool_to_official_id(TEXT, JSONB)');
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
