import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Real PostgreSQL, isolated container without host ports or production credentials.
const container = `catalog-count-reuse-${process.pid}`;
function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout);
  return result.stdout.trim();
}
const sql = (input) => docker(['exec', '-i', container, 'psql', '-X', '-At', '-h', '127.0.0.1',
  '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], input);
const migration = (name) => sql(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
const patchName = '2026100601_reuse_pool_counts_for_catalog_groups.sql';
const compareCounts = () => {
  const mismatch = sql(`WITH expected AS (
    SELECT g.scope_key,count(h.id) FILTER (WHERE h.special_type IS DISTINCT FROM 'gift'
      AND h.rarity IN (4,5,6) AND nullif(btrim(h.game_uid),'') IS NOT NULL
      AND h.timestamp>to_timestamp(0)) AS total
    FROM statistics_group_keys() g(scope_key)
    LEFT JOIN statistics_group_members() m ON m.scope_key=g.scope_key
    LEFT JOIN history h ON h.pool_id=m.pool_id GROUP BY g.scope_key
  ) SELECT count(*) FROM expected e LEFT JOIN statistics_jobs j USING(scope_key)
    WHERE e.total IS DISTINCT FROM j.total_pulls;`);
  assert.equal(mismatch, '0', 'Group counts must match direct eligible-history aggregation');
};
try {
  docker(['run', '-d', '--name', container, '-e', 'POSTGRES_PASSWORD=synthetic-test-only',
    process.env.TEST_POSTGRES_IMAGE || 'postgres:17-alpine']);
  for (let i = 0; i < 60; i++) {
    if (spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).status === 0) break;
    if (i === 59) throw new Error('Test PostgreSQL did not become ready');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  migration(patchName); // Optional rollout absent: no function should be created.
  assert.equal(sql("SELECT to_regprocedure('public.invalidate_statistics_catalog()') IS NULL;"), 't');
  sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE profiles(id uuid primary key,role text);
    CREATE TABLE pools(pool_id text primary key,type text DEFAULT 'limited',is_limited_weapon boolean,
      extra_subtype text,extra_rule_profile text,extra_series_key text,extra_series_phase integer,
      up_character text,featured_characters text[],visible boolean DEFAULT true);
    CREATE TABLE characters(id text primary key);
    CREATE TABLE pool_characters(pool_id text,character_id text,primary key(pool_id,character_id));
    CREATE TABLE history(id bigint generated always as identity primary key,pool_id text,user_id uuid,
      game_uid text,rarity int,timestamp timestamptz,special_type text,server_scope text DEFAULT 'cn');
    CREATE TABLE stats_cache(cache_key text,cached_data jsonb);
    CREATE FUNCTION get_app_visible_pools() RETURNS SETOF pools LANGUAGE sql AS
      'SELECT * FROM pools WHERE visible';
    CREATE FUNCTION get_global_stats_cached(int) RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';
    CREATE FUNCTION get_character_ranking_stats_cached(int) RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';
    CREATE FUNCTION get_character_catalog_stats_cached(int) RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';
    CREATE FUNCTION refresh_public_analytics_cache() RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';
    INSERT INTO pools(pool_id,type,is_limited_weapon,extra_subtype,extra_rule_profile,visible) VALUES
      ('limited','limited',NULL,NULL,NULL,true),('hidden','limited',NULL,NULL,NULL,false),
      ('weapon','weapon',true,NULL,NULL,true),('weapon-standard','weapon',false,NULL,NULL,true),
      ('reconstruction','extra',NULL,'reconstruction','reconstruction_character_v1',true),
      ('claim','extra',NULL,'reconstruction_claim','reconstruction_weapon_v1',true);`);
  migration('2026092201_schedule_statistics_snapshots.sql');
  migration(patchName); // Initial rollout without groups remains valid.
  migration('2026092401_group_statistics_snapshots.sql');
  const aclBefore = sql("SELECT proacl FROM pg_proc WHERE oid='public.invalidate_statistics_catalog()'::regprocedure;");
  migration(patchName);
  migration(patchName); // Idempotent.
  assert.equal(sql("SELECT proacl FROM pg_proc WHERE oid='public.invalidate_statistics_catalog()'::regprocedure;"), aclBefore);
  sql(`INSERT INTO history(pool_id,user_id,game_uid,rarity,timestamp,special_type)
    SELECT p.pool_id,'00000000-0000-0000-0000-000000000001','uid',4,now(),NULL
      FROM pools p CROSS JOIN generate_series(1,3);
    INSERT INTO history(pool_id,game_uid,rarity,timestamp,special_type) VALUES
      ('limited','uid',6,now(),'gift'),('limited','',4,now(),NULL),
      ('limited','uid',3,now(),NULL),('limited','uid',4,to_timestamp(0),NULL),
      ('limited','uid',4,now(),NULL);
    INSERT INTO characters VALUES('synthetic') ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id;`);
  compareCounts();
  assert.equal(sql("SELECT total_pulls FROM statistics_jobs WHERE scope_key='group:limited';"), '4');
  const beforeRevision = Number(sql("SELECT revision FROM statistics_jobs WHERE scope_key='group:limited';"));
  sql("UPDATE characters SET id=id;");
  assert.ok(Number(sql("SELECT revision FROM statistics_jobs WHERE scope_key='group:limited';")) > beforeRevision);
  // These edits must succeed even when the history relation cannot be queried.
  // Their payloads change, but their stored eligible-row totals do not.
  sql(`ALTER TABLE history RENAME TO unavailable_history;
    INSERT INTO characters VALUES('synthetic') ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id;
    DELETE FROM pool_characters WHERE pool_id='limited';
    INSERT INTO pool_characters VALUES('limited','synthetic')
      ON CONFLICT(pool_id,character_id) DO UPDATE SET character_id=EXCLUDED.character_id;
    ALTER TABLE unavailable_history RENAME TO history;`);
  compareCounts();
  // Existing hidden history must be included when exposed, even if its job was pruned.
  sql("DELETE FROM statistics_jobs WHERE scope_key='pool:hidden'; UPDATE pools SET visible=true WHERE pool_id='hidden';");
  compareCounts();
  assert.equal(sql("SELECT total_pulls FROM statistics_jobs WHERE scope_key='group:limited';"), '7');
  sql("UPDATE pools SET type='weapon',is_limited_weapon=false WHERE pool_id='hidden';");
  compareCounts();
  sql("UPDATE pools SET visible=false WHERE pool_id='limited'; DELETE FROM pools WHERE pool_id='weapon';");
  compareCounts();
  assert.equal(sql("SELECT total_pulls FROM statistics_jobs WHERE scope_key='group:limited';"), '0');
  // Protect compare-and-publish: a catalog write still invalidates an active lease.
  sql(`UPDATE statistics_jobs SET published_revision=revision,lease_id='11111111-1111-1111-1111-111111111111',
    lease_until=now()+interval '5 minutes' WHERE scope_key='group:limited'; UPDATE characters SET id=id;`);
  assert.equal(sql(`SELECT publish_statistics_snapshot('group:limited',
    (SELECT published_revision FROM statistics_jobs WHERE scope_key='group:limited'),
    '11111111-1111-1111-1111-111111111111','{}','test');`), 'f');
  console.log('PASS: exact counts, eligibility, hidden history, visibility, reclassification, empty groups, character/roster edits without history access, catalog upserts, revision/lease invalidation, ACL preservation and idempotency.');
} finally {
  spawnSync('docker', ['rm', '-f', container], { encoding: 'utf8' });
}
