import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_SITE_CONFIG_KEYS } from '../../shared/publicSiteConfig.js';

const repoRoot = process.cwd();

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function parseSqlStringList(sqlFragment) {
  return [...sqlFragment.matchAll(/'([^']+)'/gu)].map((match) => match[1]);
}

describe('public database contract', () => {
  it('keeps the anonymous visible-pools RPC free of creator identity columns', () => {
    const migration = readRepoFile('supabase/migrations/185_remove_pool_creator_fields_from_public_rpc.sql');
    const returnTable = migration.match(/RETURNS TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE sql/u)?.[1] || '';

    expect(returnTable).not.toMatch(/\buser_id\b/u);
    expect(returnTable).not.toMatch(/\bcreator_username\b/u);
    expect(returnTable).not.toMatch(/\bcreator_role\b/u);
    expect(migration).not.toContain('WHEN prof.role');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.get_app_visible_pools() TO anon, authenticated');
  });

  it('keeps the RLS public key list equal to the shared frontend contract', () => {
    const migration = readRepoFile('supabase/migrations/184_restrict_public_site_config_reads.sql');
    const keyBlock = migration.match(/key IN\s*\(([\s\S]*?)\)\s*OR EXISTS/u)?.[1] || '';

    expect(new Set(parseSqlStringList(keyBlock))).toEqual(new Set(PUBLIC_SITE_CONFIG_KEYS));
  });

  it('removes pool ownership UUIDs from anonymous REST column grants', () => {
    const migration = readRepoFile('supabase/migrations/186_restrict_public_pool_column_reads.sql');
    const grantColumns = migration.match(/GRANT SELECT\s*\(([\s\S]*?)\)\s*ON TABLE public\.pools/u)?.[1] || '';

    expect(migration).toContain('REVOKE SELECT ON TABLE public.pools FROM anon, authenticated');
    expect(grantColumns).toContain('pool_id');
    expect(grantColumns).not.toMatch(/\buser_id\b/u);
  });
});
