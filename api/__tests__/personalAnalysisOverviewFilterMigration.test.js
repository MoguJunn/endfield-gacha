import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/187_rebuild_personal_analysis_overview_filters.sql'
);

describe('personal analysis overview filter migration', () => {
  it('bumps owner and account scopes to schema v2 and queues snapshot rebuilds', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('personal_analysis_owner_state');
    expect(sql).toContain('personal_analysis_scope_state');
    expect(sql).toContain('analysis_schema_version SET DEFAULT 2');
    expect(sql).toContain('analysis_schema_version = GREATEST(analysis_schema_version, 2)');
    expect(sql.match(/history_revision = history_revision \+ 1/g)).toHaveLength(2);
    expect(sql).toContain('enforce_personal_analysis_schema_v2');
  });
});
