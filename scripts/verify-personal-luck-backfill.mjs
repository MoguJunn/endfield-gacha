import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import('../.agent-tmp/node_modules/@electric-sql/pglite/dist/index.js');
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE statistics_jobs(scope_key text PRIMARY KEY, revision bigint, published_revision bigint,
      lease_until timestamptz, computed_at timestamptz DEFAULT '2020-01-01', next_refresh_at timestamptz DEFAULT '2020-01-02');
    CREATE TABLE statistics_snapshots(scope_key text PRIMARY KEY, schema_version text, payload jsonb,
      computed_at timestamptz DEFAULT '2020-01-01', source_revision bigint);
    INSERT INTO statistics_jobs(scope_key, revision, published_revision) VALUES
      ('owner:stable',1,1),('owner:changed',2,1),('owner:leased',1,1),('owner:done',1,1);
    UPDATE statistics_jobs SET lease_until=now()+interval '5 minutes' WHERE scope_key='owner:leased';
    INSERT INTO statistics_snapshots(scope_key,schema_version,payload,source_revision)
      SELECT scope_key,'public-statistics-v6','{"summary":{"total":120},"catalogs":{"safe":true}}',1 FROM statistics_jobs;
    UPDATE statistics_snapshots SET payload=payload||'{"luck":{"version":1}}' WHERE scope_key='owner:done';`);
  await db.exec(await readFile(new URL('../supabase/migrations/2026103101_backfill_personal_luck.sql', import.meta.url), 'utf8'));
  const list = await db.query('SELECT read_personal_luck_backfill_batch() AS jobs');
  assert.deepEqual(list.rows[0].jobs, [
    { scopeKey: 'owner:done', revision: 1, hasAccounts: true, needsLuck: false },
    { scopeKey: 'owner:stable', revision: 1, hasAccounts: true, needsLuck: true },
  ]);
  const luck = { version: 1, accounts: [], fetchedAt: '2026-10-31T00:00:00Z' };
  const publish = (scope, revision = 1, payload = luck) => db.query(
    'SELECT publish_personal_luck_backfill($1,$2,$3::jsonb) AS ok', [scope, revision, JSON.stringify(payload)]);
  assert.equal((await publish('owner:changed')).rows[0].ok, false);
  assert.equal((await publish('owner:leased')).rows[0].ok, false);
  assert.equal((await publish('owner:done')).rows[0].ok, false);
  assert.equal((await publish('owner:stable')).rows[0].ok, true);
  const { rows: [result] } = await db.query(`SELECT s.payload,s.source_revision,j.revision,j.published_revision,
    s.computed_at::text AS computed_at,j.next_refresh_at::text AS next_refresh_at
    FROM statistics_jobs j JOIN statistics_snapshots s USING(scope_key) WHERE scope_key='owner:stable'`);
  assert.deepEqual(result.payload, { summary: { total: 120 }, catalogs: { safe: true }, luck });
  assert.equal(result.source_revision, result.revision);
  assert.equal(result.revision, result.published_revision);
  assert.match(result.computed_at, /^2020-01-01/);
  assert.match(result.next_refresh_at, /^2020-01-02/);
  assert.equal((await publish('owner:stable', 2)).rows[0].ok, false);
  await assert.rejects(publish('pool:invalid'), /Invalid personal luck result/);
  await assert.rejects(publish('owner:stable', 2, { version: 1 }), /Invalid personal luck result/);
  const acl = await db.query(`SELECT has_function_privilege('anon',
    'publish_personal_luck_backfill(text,bigint,jsonb)','EXECUTE') AS anon,
    has_function_privilege('authenticated','publish_personal_luck_backfill(text,bigint,jsonb)','EXECUTE') AS authenticated,
    has_function_privilege('service_role','publish_personal_luck_backfill(text,bigint,jsonb)','EXECUTE') AS service`);
  assert.deepEqual(acl.rows[0], { anon: false, authenticated: false, service: true });
  await db.exec(`INSERT INTO statistics_jobs(scope_key, revision, published_revision)
    SELECT 'owner:test-'||lpad(i::text,3,'0'),1,1 FROM generate_series(1,40) i;
    INSERT INTO statistics_snapshots(scope_key,schema_version,payload,source_revision)
      SELECT scope_key,'public-statistics-v6','{"accounts":[],"luck":{"version":1}}',1
      FROM statistics_jobs WHERE scope_key LIKE 'owner:test-%';
    INSERT INTO statistics_jobs(scope_key, revision, published_revision) VALUES ('owner:zz-empty',1,1);
    INSERT INTO statistics_snapshots(scope_key,schema_version,payload,source_revision)
      VALUES('owner:zz-empty','public-statistics-v6','{"accounts":[]}',1);`);
  let after = '', pages = 0, missing = [];
  for (;;) {
    const { rows: [page] } = await db.query('SELECT read_personal_luck_backfill_batch($1,100) AS jobs', [after]);
    assert.ok(page.jobs.length <= 20);
    if (!page.jobs.length) break;
    pages++;
    missing.push(...page.jobs.filter(job => job.needsLuck));
    after = page.jobs.at(-1).scopeKey;
  }
  assert.equal(pages, 3);
  assert.deepEqual(missing, [{ scopeKey: 'owner:zz-empty', revision: 1, hasAccounts: false, needsLuck: true }]);
  await db.exec(await readFile(new URL('../supabase/migrations/2026103104_personal_luck_release_boundaries.sql', import.meta.url), 'utf8'));
  const latestLuck = { ...luck, calculationVersion: 2 };
  const upgrade = (scope, revision = 1) => publish(scope, revision, latestLuck);
  const upgradedList = (await db.query('SELECT read_personal_luck_backfill_batch() AS jobs')).rows[0].jobs;
  assert.equal(upgradedList.find(job => job.scopeKey === 'owner:stable').needsLuck, true);
  await assert.rejects(publish('owner:stable', 2), /Invalid personal luck result/);
  assert.equal((await upgrade('owner:changed')).rows[0].ok, false);
  assert.equal((await upgrade('owner:leased')).rows[0].ok, false);
  assert.equal((await upgrade('owner:stable', 2)).rows[0].ok, true);
  assert.equal((await upgrade('owner:stable', 3)).rows[0].ok, false);
  const upgraded = (await db.query(`SELECT s.payload,s.source_revision,s.computed_at::text AS computed_at,
    j.revision,j.published_revision FROM statistics_snapshots s JOIN statistics_jobs j USING(scope_key)
    WHERE scope_key='owner:stable'`)).rows[0];
  assert.deepEqual(upgraded.payload, { summary: { total: 120 }, catalogs: { safe: true }, luck: latestLuck });
  assert.equal(upgraded.source_revision, 3); assert.equal(upgraded.revision, 3); assert.equal(upgraded.published_revision, 3);
  assert.match(upgraded.computed_at, /^2020-01-01/);
  const latestList = (await db.query('SELECT read_personal_luck_backfill_batch() AS jobs')).rows[0].jobs;
  assert.equal(latestList.find(job => job.scopeKey === 'owner:stable').needsLuck, false);
  console.log('Luck backfill SQL verified: bounded pagination, revision/lease conflict, idempotency, payload/time preservation and ACL');
} finally { await db.close(); }
