import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../.agent-tmp/node_modules/@electric-sql/pglite/dist/index.js';

// Isolated PostgreSQL execution; never connects to the application's database.
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE profiles(id uuid primary key,role text);
  CREATE TABLE pools(id serial,pool_id text primary key,type text DEFAULT 'limited',is_limited_weapon boolean,
    extra_subtype text,extra_rule_profile text,extra_series_key text,extra_series_phase integer,
    up_character text,featured_characters text[],visible boolean DEFAULT true);
  CREATE TABLE characters(id text primary key);
  CREATE TABLE pool_characters(pool_id text,character_id text);
  CREATE TABLE history(id bigint generated always as identity primary key,pool_id text,user_id uuid,
    game_uid text,rarity int,timestamp timestamptz,special_type text,server_id text,
    server_scope text GENERATED ALWAYS AS (COALESCE(NULLIF(btrim(server_id), ''), 'legacy')) STORED);
  CREATE TABLE stats_cache(cache_key text,cached_data jsonb);
  CREATE FUNCTION get_app_visible_pools() RETURNS TABLE(pool_id text,type text,is_limited_weapon boolean,
    extra_subtype text,extra_rule_profile text,extra_series_key text,extra_series_phase integer,
    up_character text,featured_characters text[]) LANGUAGE sql AS
    'SELECT pool_id,type,is_limited_weapon,extra_subtype,extra_rule_profile,extra_series_key,extra_series_phase,
      up_character,featured_characters FROM pools WHERE visible';
  CREATE FUNCTION get_global_stats_cached(int) RETURNS jsonb LANGUAGE sql AS 'SELECT ''{"total":1}''::jsonb';
  CREATE FUNCTION get_character_ranking_stats_cached(int) RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';
  CREATE FUNCTION get_character_catalog_stats_cached(int) RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';
  CREATE FUNCTION refresh_public_analytics_cache() RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';
  INSERT INTO pools(pool_id) VALUES('p'),('q');
  INSERT INTO profiles VALUES('00000000-0000-0000-0000-000000000001','user');
`);
await db.exec(await readFile(new URL('../supabase/migrations/2026092201_schedule_statistics_snapshots.sql', import.meta.url), 'utf8'));
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const lease = '11111111-1111-1111-1111-111111111111';
await db.exec(`INSERT INTO history(pool_id,user_id,game_uid,rarity,timestamp) SELECT 'p','00000000-0000-0000-0000-000000000001','uid',4,now() FROM generate_series(1,10);`);
assert.equal(Number((await one("SELECT total_pulls FROM statistics_jobs WHERE scope_key='pool:p'")).total_pulls), 10);
assert.equal(Number((await one("SELECT total_pulls FROM statistics_jobs WHERE scope_key='pool:q'")).total_pulls), 0);
assert.equal(Number((await one("SELECT revision FROM statistics_jobs WHERE scope_key='pool:p'")).revision), 2, 'One invalidation per batch');
let job = (await one('SELECT claim_statistics_job($1) AS job', [lease])).job;
assert.equal(job.refreshMinutes, 30);
// Pin a pool job to verify compare-and-publish and unchanged snapshot reuse.
await db.exec("UPDATE statistics_jobs SET lease_id=NULL,lease_until=NULL,refresh_minutes=30,next_refresh_at=now()+interval '1 day',computed_at=now(); UPDATE statistics_jobs SET next_refresh_at=now()-interval '1 minute' WHERE scope_key='pool:p'");
job = (await one('SELECT claim_statistics_job($1) AS job', [lease])).job;
assert.equal(job.scopeKey, 'pool:p');
assert.equal((await one('SELECT claim_statistics_job($1) AS job', ['22222222-2222-2222-2222-222222222222'])).job, null, 'No duplicate lease');
await db.exec("UPDATE history SET rarity=5 WHERE id=1");
assert.equal((await one("SELECT publish_statistics_snapshot('pool:p',$1,$2,'{}','public-statistics-v3') AS ok", [job.revision, lease])).ok, false);
assert.equal(Number((await one('SELECT count(*) FROM statistics_snapshots')).count), 0, 'Concurrent changes must not publish');
await db.exec("UPDATE statistics_jobs SET retry_at=NULL,next_refresh_at=now()-interval '1 minute' WHERE scope_key='pool:p'");
job = (await one('SELECT claim_statistics_job($1) AS job', [lease])).job;
assert.equal((await one("SELECT publish_statistics_snapshot('pool:p',$1,$2,'{\"observations\":{\"total\":10}}','public-statistics-v3') AS ok", [job.revision, lease])).ok, true);
assert.equal((await one("SELECT read_statistics_pool_counts() AS counts")).counts.p, 10);
const published = (await one("SELECT read_statistics_snapshot('pool:p') AS value")).value;
assert.equal((await one("SELECT read_statistics_snapshot('pool:p') AS value")).value.next_refresh_at, published.next_refresh_at, 'Reading must not move the next refresh time');
await db.exec("UPDATE statistics_jobs SET next_refresh_at=now()-interval '1 minute' WHERE scope_key='pool:p'");
assert.equal((await one('SELECT claim_statistics_job($1) AS job', [lease])).job, null, 'Skip recalculating unchanged scopes');
assert.equal((await one("SELECT read_statistics_snapshot('pool:p') AS value")).value.computed_at, published.computed_at, 'An idle check must preserve computation time');
await db.exec("UPDATE history SET pool_id='q' WHERE id=1; DELETE FROM history WHERE id=2");
assert.equal(Number((await one("SELECT total_pulls FROM statistics_jobs WHERE scope_key='pool:p'")).total_pulls), 8);
assert.equal(Number((await one("SELECT total_pulls FROM statistics_jobs WHERE scope_key='pool:q'")).total_pulls), 1);
await db.exec("INSERT INTO history(pool_id,user_id,game_uid,rarity,timestamp,special_type) VALUES('q','00000000-0000-0000-0000-000000000001','uid',6,now(),'gift')");
assert.equal(Number((await one("SELECT total_pulls FROM statistics_jobs WHERE scope_key='pool:q'")).total_pulls), 1);
await db.exec("UPDATE statistics_activity SET changed_rows=1000");
await one('SELECT claim_statistics_job($1)', [lease]);
assert.equal((await one("SELECT refresh_minutes FROM statistics_jobs WHERE scope_key='pool:p'")).refresh_minutes, 5);
await db.exec('DELETE FROM statistics_activity');
await one('SELECT claim_statistics_job($1)', [lease]);
assert.equal((await one("SELECT refresh_minutes FROM statistics_jobs WHERE scope_key='pool:p'")).refresh_minutes, 60);
assert.equal((await one("SELECT has_table_privilege('anon','statistics_snapshots','SELECT') AS allowed")).allowed, false);
assert.equal((await one("SELECT has_function_privilege('authenticated','read_statistics_snapshot(text)','EXECUTE') AS allowed")).allowed, false);
assert.equal((await one("SELECT compute_legacy_statistics('global_summary') AS value")).value.total, 1);
await db.exec("INSERT INTO stats_cache VALUES('global_stats:v5','{\"total\":9}'); UPDATE statistics_jobs SET lease_id='11111111-1111-1111-1111-111111111111',lease_until=now()+interval '5 minutes' WHERE scope_key='global_summary'");
assert.equal((await one("SELECT compute_and_publish_legacy_statistics('global_summary',-1,$1,'public-statistics-v3') AS ok", [lease])).ok, false);
assert.equal((await one("SELECT cached_data FROM stats_cache WHERE cache_key='global_stats:v5'")).cached_data.total, 9, 'Rejected publication must restore old legacy caches');
await db.exec("UPDATE statistics_jobs SET lease_id='11111111-1111-1111-1111-111111111111',lease_until=now()+interval '5 minutes' WHERE scope_key='global_summary'");
const legacyRevision = (await one("SELECT revision FROM statistics_jobs WHERE scope_key='global_summary'")).revision;
assert.equal((await one("SELECT compute_and_publish_legacy_statistics('global_summary',$1,$2,'public-statistics-v3') AS ok", [legacyRevision, lease])).ok, true);
assert.equal((await one("SELECT read_statistics_snapshot('global_summary') AS value")).value.payload.total, 1);
const legacyComputed = (await one("SELECT read_statistics_snapshot('global_summary') AS value")).value.computed_at;
assert.equal((await one('SELECT refresh_public_analytics_cache() AS value')).value.queued, true);
assert.equal((await one("SELECT read_statistics_snapshot('global_summary') AS value")).value.computed_at, legacyComputed, 'Import callbacks enqueue without recomputing');
await db.exec("INSERT INTO characters VALUES('a')");
assert.ok(Number((await one("SELECT revision-published_revision AS diff FROM statistics_jobs WHERE scope_key='pool:p'")).diff) > 0);
await db.exec("DELETE FROM profiles WHERE id='00000000-0000-0000-0000-000000000001'");
assert.equal(Number((await one("SELECT count(*) FROM statistics_jobs WHERE scope_key LIKE 'owner:%'")).count), 0);
await db.exec("INSERT INTO profiles VALUES('00000000-0000-0000-0000-000000000002','user')");
assert.equal(Number((await one("SELECT count(*) FROM statistics_jobs WHERE scope_key LIKE 'owner:%'")).count), 1, 'New empty accounts receive an initial job');
await db.exec("DELETE FROM pools WHERE pool_id='q'");
await one('SELECT claim_statistics_job($1)', [lease]);
assert.equal(Number((await one("SELECT count(*) FROM statistics_jobs WHERE scope_key='pool:q'")).count), 0, 'Deleted pools must not retry forever');
// Upgrade with existing history, then verify group-specific behavior against
// real directory columns and the generated server_scope from migration 147.
await db.exec(`
  DELETE FROM history; DELETE FROM pools;
  INSERT INTO pools(pool_id,type,is_limited_weapon,extra_subtype,extra_rule_profile,visible) VALUES
    ('l1','limited',NULL,NULL,NULL,true),('l2','limited_character',NULL,NULL,NULL,true),
    ('wl','weapon',true,NULL,NULL,true),('wl2','limited_weapon',NULL,NULL,NULL,true),
    ('ws','limited_weapon',false,NULL,NULL,true),
    ('r','extra',NULL,'reconstruction','reconstruction_character_v1',true),
    ('rc','extra',NULL,'reconstruction_claim','reconstruction_weapon_v1',true),
    ('standard','standard',NULL,NULL,NULL,true),('beginner','beginner',NULL,NULL,NULL,true),
    ('festival','extra',NULL,'special','brilliance_festival_v1',true),
    ('unclassified','extra',NULL,NULL,NULL,true),
    ('unresolved-reconstruction','extra',NULL,'reconstruction',NULL,true),
    ('unresolved-claim','extra',NULL,'reconstruction_claim',NULL,true),
    ('bad-profile','extra',NULL,'reconstruction','reconstruction_weapon_v1',true),
    ('bad-claim','extra',NULL,'reconstruction_claim','reconstruction_character_v1',true),
    ('bad-type','standard',NULL,'reconstruction','reconstruction_character_v1',true),
    ('joint_1_2_2','extra',NULL,NULL,NULL,true),
    ('hidden','limited',NULL,NULL,NULL,false),
    ('other-user','standard',NULL,NULL,NULL,true),('other-uid','standard',NULL,NULL,NULL,true),
    ('other-server','standard',NULL,NULL,NULL,true);
  INSERT INTO history(pool_id,user_id,game_uid,server_id,rarity,timestamp)
    VALUES('l1','00000000-0000-0000-0000-000000000002','existing','cn',6,now());
  UPDATE pools SET extra_series_key='r1',extra_series_phase=1 WHERE pool_id='r';
  UPDATE pools SET extra_series_key='rc1',extra_series_phase=1 WHERE pool_id='rc';
`);
await db.exec(await readFile(new URL('../supabase/migrations/2026092401_group_statistics_snapshots.sql', import.meta.url), 'utf8'));
// The snapshot-version upgrade must mark every pre-existing scope dirty and
// immediately claimable so pool (legacy section), owner (groups section), group
// and legacy payloads are rebuilt exactly once.
assert.equal(Number((await one(`SELECT count(*) FROM statistics_jobs
  WHERE computed_at IS NOT NULL OR next_refresh_at>now() OR retry_at IS NOT NULL OR revision=published_revision`)).count), 0,
  'Version upgrade marks every existing scope dirty and immediately recomputable');
assert.deepEqual((await db.query(`SELECT scope_key FROM statistics_jobs
  WHERE scope_key IN ('global_summary','character_ranking','character_catalog','public_analytics')
    AND revision>published_revision AND computed_at IS NULL ORDER BY scope_key`)).rows.map((row) => row.scope_key),
  ['character_catalog', 'character_ranking', 'global_summary', 'public_analytics'], 'Legacy scopes republish under the new version');
assert.equal((await one("SELECT revision>published_revision AND computed_at IS NULL AS dirty FROM statistics_jobs WHERE scope_key='owner:00000000-0000-0000-0000-000000000002'")).dirty, true,
  'Owner scopes recompute for the new groups section');
const upgradePending = (await one("SELECT read_statistics_snapshot('pool:p') AS value")).value;
assert.equal(upgradePending.schema_version, 'public-statistics-v3', 'Upgrade keeps old snapshots readable until republished');
assert.equal(upgradePending.pending_changes, true, 'Upgrade marks old snapshots pending for the worker');
const groupKeys = ['group:limited', 'group:weapon_limited', 'group:weapon_standard',
  'group:extra:reconstruction', 'group:extra:reconstruction_claim'].sort();
const countFor = async (scope) => Number((await one('SELECT total_pulls FROM statistics_jobs WHERE scope_key=$1', [scope])).total_pulls);
const groupCounts = async () => (await one('SELECT read_statistics_group_counts() AS value')).value;
assert.deepEqual(Object.keys(await groupCounts()).sort(), groupKeys, 'All five groups registered even without members/history');
assert.equal((await groupCounts())['group:limited'], 1, 'Upgrade counts existing history');
assert.deepEqual((await db.query('SELECT scope_key,pool_id FROM statistics_group_members() ORDER BY scope_key,pool_id')).rows, [
  { scope_key: 'group:extra:reconstruction', pool_id: 'r' },
  { scope_key: 'group:extra:reconstruction', pool_id: 'unresolved-reconstruction' },
  { scope_key: 'group:extra:reconstruction_claim', pool_id: 'bad-claim' },
  { scope_key: 'group:extra:reconstruction_claim', pool_id: 'bad-profile' },
  { scope_key: 'group:extra:reconstruction_claim', pool_id: 'rc' },
  { scope_key: 'group:extra:reconstruction_claim', pool_id: 'unresolved-claim' },
  { scope_key: 'group:limited', pool_id: 'l1' }, { scope_key: 'group:limited', pool_id: 'l2' },
  { scope_key: 'group:weapon_limited', pool_id: 'wl' }, { scope_key: 'group:weapon_limited', pool_id: 'wl2' },
  { scope_key: 'group:weapon_standard', pool_id: 'ws' },
], 'Canonical subtype membership matches shared JS, keeps unresolved profiles, and excludes invisible/standard/beginner/special/unclassified/joint_1_2_2/wrong type');
// The public identity is pool_id; the internal pools.id serial must never leak
// into visibility, job keys, membership or counters.
assert.equal((await db.query('SELECT * FROM get_app_visible_pools() LIMIT 1')).rows[0].id, undefined,
  'get_app_visible_pools must not expose internal pools.id');
assert.deepEqual((await db.query(`SELECT scope_key FROM statistics_jobs j WHERE j.scope_key LIKE 'pool:%'
  AND j.scope_key IN (SELECT 'pool:'||p.id::text FROM pools p WHERE p.pool_id <> p.id::text)`)).rows, [],
  'Job keys are built from pool_id, never from the internal serial id');
assert.deepEqual((await db.query(`SELECT DISTINCT m.pool_id FROM statistics_group_members() m
  WHERE m.pool_id IN (SELECT p.id::text FROM pools p WHERE p.pool_id <> p.id::text)`)).rows, [],
  'Group members are public pool_id values, never internal serial ids');
const userA = '00000000-0000-0000-0000-000000000002';
const userB = '00000000-0000-0000-0000-000000000003';
await db.exec(`INSERT INTO profiles VALUES('${userB}','user');
  INSERT INTO history(pool_id,user_id,game_uid,server_id,rarity,timestamp) VALUES
    ('l1','${userA}','shared','cn',6,now()),('wl','${userA}','shared','cn',6,now()),
    ('r','${userA}','shared','cn',6,now()),('standard','${userA}','shared','cn',6,now()),
    ('other-user','${userB}','shared','cn',6,now()),('other-uid','${userA}','different','cn',6,now()),
    ('other-server','${userA}','shared','eu',6,now()),('rc','${userB}','isolated','cn',6,now()),
    ('ws','${userB}','isolated','cn',6,now());`);
const revisions = async () => Object.fromEntries((await db.query(
  "SELECT scope_key,revision FROM statistics_jobs WHERE scope_key LIKE 'pool:%' OR scope_key LIKE 'group:%' ORDER BY scope_key"
)).rows.map((row) => [row.scope_key, Number(row.revision)]));
const assertChanged = async (before, expected, label) => {
  const after = await revisions();
  assert.deepEqual(Object.keys(after).filter((key) => after[key] !== before[key]).sort(), expected.slice().sort(), label);
  for (const key of expected) assert.equal(after[key], before[key] + 1, `${label}: one revision per statement for ${key}`);
};
const sharedScopes = ['pool:l1', 'pool:wl', 'pool:r', 'pool:standard',
  'group:limited', 'group:weapon_limited', 'group:extra:reconstruction'];
let before = await revisions();
let countsBefore = await groupCounts();
await db.exec(`INSERT INTO history(pool_id,user_id,game_uid,server_id,rarity,timestamp)
  SELECT 'l1','${userA}','shared','cn',4,now() FROM generate_series(1,3)`);
await assertChanged(before, sharedScopes, 'Insert invalidates only the changed account dependencies, not matching UID in other users/servers');
assert.equal((await groupCounts())['group:limited'], countsBefore['group:limited'] + 3);
assert.equal((await groupCounts())['group:weapon_limited'], countsBefore['group:weapon_limited'], 'Dependency invalidation does not change counts');
before = await revisions();
await db.exec(`UPDATE history SET rarity=5 WHERE user_id='${userA}' AND game_uid='shared' AND server_id='cn'`);
await assertChanged(before, sharedScopes, 'Batch update invalidates each shared pool/group once');
before = await revisions();
countsBefore = await groupCounts();
await db.exec(`UPDATE history SET pool_id='ws' WHERE pool_id='wl' AND user_id='${userA}' AND game_uid='shared'`);
await assertChanged(before, [...sharedScopes, 'pool:ws', 'group:weapon_standard'], 'Cross-group move invalidates source, destination and account dependencies');
assert.equal((await groupCounts())['group:weapon_limited'], countsBefore['group:weapon_limited'] - 1);
assert.equal((await groupCounts())['group:weapon_standard'], countsBefore['group:weapon_standard'] + 1);
before = await revisions();
await db.exec(`DELETE FROM history WHERE pool_id='l1' AND user_id='${userA}' AND game_uid='shared'`);
await assertChanged(before, sharedScopes.filter((key) => !['pool:wl', 'group:weapon_limited'].includes(key)).concat('pool:ws', 'group:weapon_standard'),
  'Delete invalidates removed pool and surviving same-account dependencies without transitive fanout through ws');

// Changes to identity must invalidate both old and new account histories.
before = await revisions();
await db.exec(`UPDATE history SET game_uid='different' WHERE pool_id='r' AND user_id='${userA}' AND game_uid='shared'`);
await assertChanged(before, ['pool:r', 'pool:standard', 'pool:ws', 'pool:other-uid',
  'group:extra:reconstruction', 'group:weapon_standard'], 'Account move invalidates old and new UID scopes');
before = await revisions();
await db.exec(`UPDATE history SET server_id='eu' WHERE pool_id='standard' AND user_id='${userA}' AND game_uid='shared' AND server_id='cn'`);
await assertChanged(before, ['pool:standard', 'pool:ws', 'pool:other-server', 'group:weapon_standard'], 'Server move invalidates old and new server scopes');
before = await revisions();
await db.exec(`UPDATE history SET user_id='${userB}',game_uid='isolated' WHERE pool_id='r' AND user_id='${userA}' AND game_uid='different'`);
await assertChanged(before, ['pool:r', 'pool:other-uid', 'pool:ws', 'pool:rc',
  'group:extra:reconstruction', 'group:weapon_standard', 'group:extra:reconstruction_claim'],
  'Owner move invalidates both owners without expanding through unrelated shared pools');

// All five group counters share the pool eligibility predicate. Excluded rows
// still invalidate metrics because gifts and chronology affect account history.
countsBefore = await groupCounts();
await db.exec(`INSERT INTO history(pool_id,user_id,game_uid,server_id,rarity,timestamp,special_type)
  SELECT p.pool_id,'${userB}',x.uid,'cn',x.rarity,x.ts,x.kind
  FROM (VALUES ('l2'),('wl2'),('ws'),('r'),('rc')) p(pool_id)
  CROSS JOIN (VALUES ('valid',4,now(),NULL),('gift',6,now(),'gift'),
    ('',6,now(),NULL),('bad-time',6,to_timestamp(0),NULL),('bad-rarity',3,now(),NULL)) x(uid,rarity,ts,kind);`);
for (const key of groupKeys) assert.equal((await groupCounts())[key], countsBefore[key] + 1, `Eligibility exclusions for ${key}`);
before = await revisions();
countsBefore = await groupCounts();
await db.exec(`INSERT INTO history(pool_id,user_id,game_uid,server_id,rarity,timestamp)
  SELECT pool_id,'${userB}','excluded','cn',6,now() FROM pools
  WHERE pool_id IN ('hidden','standard','beginner','festival','unclassified','bad-type','joint_1_2_2')`);
assert.deepEqual(await groupCounts(), countsBefore, 'Excluded pool types and invisible pools add no group counts');
assert.deepEqual(Object.entries(await revisions()).filter(([key, value]) => key.startsWith('group:') && value !== before[key]), [],
  'Excluded pools on an unrelated account invalidate no groups');

// Canonical subtype membership: reconstruction + weapon profile is the claim
// group, and an unresolved profile still belongs to its group instead of being
// silently dropped.
before = await revisions();
countsBefore = await groupCounts();
await db.exec(`INSERT INTO history(pool_id,user_id,game_uid,server_id,rarity,timestamp)
  VALUES('bad-profile','${userB}','canonical','cn',6,now()),('bad-claim','${userB}','canonical','cn',6,now()),
    ('unresolved-reconstruction','${userB}','canonical','cn',6,now()),('unresolved-claim','${userB}','canonical','cn',6,now())`);
assert.equal((await groupCounts())['group:extra:reconstruction_claim'], countsBefore['group:extra:reconstruction_claim'] + 3,
  'reconstruction+weapon profile and both unresolved claim rows join the claim group');
assert.equal((await groupCounts())['group:extra:reconstruction'], countsBefore['group:extra:reconstruction'] + 1,
  'Unresolved reconstruction profile keeps character group membership');
assert.deepEqual(Object.entries(await revisions()).filter(([key, value]) => key.startsWith('group:') &&
  !['group:extra:reconstruction', 'group:extra:reconstruction_claim'].includes(key) && value !== before[key]), [],
  'Canonical members never invalidate unrelated groups');

// Deleting the last row must resolve every dependency from OLD transition rows:
// the deleted pool itself plus the other member pools of that same account.
const userC = '00000000-0000-0000-0000-000000000004';
const userD = '00000000-0000-0000-0000-000000000005';
const settledCounts = await groupCounts();
await db.exec(`INSERT INTO profiles VALUES('${userC}','user'),('${userD}','user');
  INSERT INTO history(pool_id,user_id,game_uid,server_id,rarity,timestamp) VALUES
    ('rc','${userC}','solo','cn',6,now()),
    ('wl','${userD}','pair','cn',6,now()),('r','${userD}','pair','cn',6,now());`);
before = await revisions();
countsBefore = await groupCounts();
await db.exec(`DELETE FROM history WHERE user_id='${userC}' AND pool_id='rc'`);
await assertChanged(before, ['pool:rc', 'group:extra:reconstruction_claim'],
  'Deleting the last row of an isolated account finds the member group from OLD rows');
assert.equal((await groupCounts())['group:extra:reconstruction_claim'], countsBefore['group:extra:reconstruction_claim'] - 1);
before = await revisions();
countsBefore = await groupCounts();
await db.exec(`DELETE FROM history WHERE user_id='${userD}' AND pool_id='wl'`);
await assertChanged(before, ['pool:wl', 'pool:r', 'group:weapon_limited', 'group:extra:reconstruction'],
  'Deleting the last row in one pool still invalidates the other member pools and groups of that account');
assert.equal((await groupCounts())['group:weapon_limited'], countsBefore['group:weapon_limited'] - 1);
assert.equal((await groupCounts())['group:extra:reconstruction'], countsBefore['group:extra:reconstruction']);
before = await revisions();
await db.exec(`DELETE FROM history WHERE user_id='${userD}' AND pool_id='r'`);
await assertChanged(before, ['pool:r', 'group:extra:reconstruction'],
  'Deleting the very last row of an account still resolves member groups from OLD rows');
assert.deepEqual(await groupCounts(), settledCounts, 'Last-row deletions leave group counters exactly restored');

// Catalog visibility changes recount groups and re-create jobs removed by claim.
countsBefore = await groupCounts();
await db.exec("UPDATE pools SET visible=true WHERE pool_id='hidden'");
assert.equal((await groupCounts())['group:limited'], countsBefore['group:limited'] + 1);
await db.exec("UPDATE pools SET visible=false WHERE pool_id='hidden'");
assert.deepEqual(await groupCounts(), countsBefore);
await one('SELECT claim_statistics_job($1)', [lease]);
assert.equal((await one("SELECT count(*) AS n FROM statistics_jobs WHERE scope_key='pool:hidden'")).n, 0);
assert.equal((await one("SELECT count(*) AS n FROM statistics_jobs WHERE scope_key LIKE 'group:%'")).n, 5, 'Claim never treats groups as pools');
await db.exec("UPDATE pools SET visible=true WHERE pool_id='hidden'");
assert.equal(await countFor('pool:hidden'), 1, 'Reappearing pool restores existing history count');
await db.exec("UPDATE pools SET type='weapon',is_limited_weapon=false WHERE pool_id='hidden'");
assert.equal((await groupCounts())['group:limited'], countsBefore['group:limited']);
assert.equal((await groupCounts())['group:weapon_standard'], countsBefore['group:weapon_standard'] + 1, 'Catalog reclassification moves count');
assert.deepEqual((await db.query(`SELECT g.scope_key,j.total_pulls,
  coalesce(sum(pj.total_pulls),0)::bigint AS member_pulls
  FROM statistics_group_keys() g(scope_key) JOIN statistics_jobs j USING(scope_key)
  LEFT JOIN statistics_group_members() m ON m.scope_key=g.scope_key
  LEFT JOIN statistics_jobs pj ON pj.scope_key='pool:'||m.pool_id
  GROUP BY g.scope_key,j.total_pulls ORDER BY g.scope_key`)).rows.filter((row) => Number(row.total_pulls) !== Number(row.member_pulls)), [],
  'Every group counter equals the sum of visible member counters');

// Member target metadata feeds the stored member signature. Any catalog change
// must invalidate the group scope so the handler never serves a stale signature.
before = await revisions();
await db.exec("UPDATE pools SET up_character='目标六星',featured_characters=ARRAY['目标六星'] WHERE pool_id='l1'");
await assertChanged(before, Object.keys(before), 'Target metadata change invalidates pool and group scopes for the new signature');

// Legacy rows may predate the generated server_scope. A null scope means the
// same fallback bucket as the JS account key ('unknown'), so both pools of that
// account must still be invalidated together.
await db.exec('ALTER TABLE history ALTER COLUMN server_scope DROP EXPRESSION');
await db.exec(`INSERT INTO profiles VALUES('00000000-0000-0000-0000-000000000006','user');
  INSERT INTO history(pool_id,user_id,game_uid,server_id,server_scope,rarity,timestamp)
    VALUES('l1','00000000-0000-0000-0000-000000000006','legacy-null',NULL,NULL,6,now()),
      ('r','00000000-0000-0000-0000-000000000006','legacy-null',NULL,NULL,6,now())`);
before = await revisions();
countsBefore = await groupCounts();
await db.exec(`DELETE FROM history WHERE user_id='00000000-0000-0000-0000-000000000006' AND pool_id='l1'`);
await assertChanged(before, ['pool:l1', 'pool:r', 'group:limited', 'group:extra:reconstruction'],
  'Null legacy server_scope rows stay one account via IS NOT DISTINCT FROM');
assert.equal((await groupCounts())['group:limited'], countsBefore['group:limited'] - 1);
assert.equal((await groupCounts())['group:extra:reconstruction'], countsBefore['group:extra:reconstruction']);

// Publish a group, then reject a stale revision without losing its old payload.
// Activity is normalized so the adaptive cadence (5/30/60) is deterministic here.
const pinGroup = async () => db.exec(`DELETE FROM statistics_activity;
  INSERT INTO statistics_activity(minute_at,contributor_id,changed_rows) VALUES(now(),'${lease}',10);
  UPDATE statistics_jobs SET lease_id=NULL,lease_until=NULL,retry_at=NULL,
  refresh_minutes=30,computed_at=now(),next_refresh_at=now()+interval '1 day';
  UPDATE statistics_jobs SET next_refresh_at=now()-interval '1 minute' WHERE scope_key='group:limited'`);
await pinGroup();
job = (await one('SELECT claim_statistics_job($1) AS job', [lease])).job;
assert.equal(job.scopeKey, 'group:limited');
assert.equal(job.refreshMinutes, 30);
assert.equal((await one('SELECT claim_statistics_job($1) AS job', ['22222222-2222-2222-2222-222222222222'])).job, null, 'No duplicate group lease');
assert.equal((await one("SELECT publish_statistics_snapshot('group:limited',$1,$2,'{\"version\":1}','public-statistics-v4') AS ok", [job.revision, lease])).ok, true);
const originalGroup = (await one("SELECT read_statistics_snapshot('group:limited') AS value")).value;
await db.exec(`UPDATE history SET rarity=5 WHERE pool_id='l2' AND game_uid='valid'`);
await pinGroup();
job = (await one('SELECT claim_statistics_job($1) AS job', [lease])).job;
await db.exec(`UPDATE history SET rarity=6 WHERE pool_id='l2' AND game_uid='valid'`);
assert.equal((await one("SELECT publish_statistics_snapshot('group:limited',$1,$2,'{\"version\":2}','public-statistics-v4') AS ok", [job.revision, lease])).ok, false);
const rejectedGroup = (await one("SELECT read_statistics_snapshot('group:limited') AS value")).value;
assert.deepEqual(rejectedGroup.payload, originalGroup.payload, 'Rejected group revision preserves prior payload');
assert.equal(rejectedGroup.computed_at, originalGroup.computed_at, 'Rejected revision preserves computation time');
const retry = await one("SELECT lease_id,lease_until,retry_at IS NOT NULL AS retry FROM statistics_jobs WHERE scope_key='group:limited'");
assert.deepEqual(retry, { lease_id: null, lease_until: null, retry: true });
await pinGroup();
job = (await one('SELECT claim_statistics_job($1) AS job', [lease])).job;
assert.equal((await one("SELECT publish_statistics_snapshot('group:limited',$1,$2,'{\"version\":3}','public-statistics-v4') AS ok", [job.revision, lease])).ok, true);
await db.exec("UPDATE statistics_jobs SET next_refresh_at=now()-interval '1 minute' WHERE scope_key='group:limited'");
assert.equal((await one('SELECT claim_statistics_job($1) AS job', [lease])).job, null, 'Unchanged group skips recomputation');
await db.exec('UPDATE statistics_activity SET changed_rows=1000');
await one('SELECT claim_statistics_job($1)', [lease]);
assert.equal((await one("SELECT refresh_minutes FROM statistics_jobs WHERE scope_key='group:limited'")).refresh_minutes, 5);
await db.exec('DELETE FROM statistics_activity');
await one('SELECT claim_statistics_job($1)', [lease]);
assert.equal((await one("SELECT refresh_minutes FROM statistics_jobs WHERE scope_key='group:limited'")).refresh_minutes, 60);
await db.exec("INSERT INTO statistics_jobs(scope_key) VALUES('group:unknown'); DELETE FROM pools WHERE pool_id IN ('r','rc','bad-profile','bad-claim','unresolved-reconstruction','unresolved-claim')");
await one('SELECT claim_statistics_job($1)', [lease]);
assert.equal((await one("SELECT count(*) AS n FROM statistics_jobs WHERE scope_key LIKE 'group:%'")).n, 5, 'Empty supported groups survive; invalid groups are removed');
assert.equal((await groupCounts())['group:extra:reconstruction'], 0);
assert.equal((await groupCounts())['group:extra:reconstruction_claim'], 0);
for (const fn of ['statistics_group_keys()', 'statistics_group_members()', 'read_statistics_group_counts()', 'claim_statistics_job(uuid)']) {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal((await one('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed', [role, fn])).allowed,
      role === 'service_role', `${fn} must be service-only`);
  }
}
console.log('PASS: base and group migrations, snapshot-version dirty upgrade, JS-parity canonical membership with unresolved profiles, batched insert/update/delete/move, last-row deletion from OLD rows, account/server dependency isolation including null scopes, group counters and exclusions, target metadata invalidation, catalog reclassification, 5/30/60 cadence, leases, stale revision preservation, cleanup and service-only grants');
await db.close();
