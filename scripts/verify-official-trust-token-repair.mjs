import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { calculateHistoryPity } from '../shared/historyPity.js';

const container = `trust-token-repair-${process.pid}`;
const run = (args, input) => {
  const result = spawnSync('docker', args, { encoding: 'utf8', input, timeout: 60000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout);
  return result.stdout;
};
const sql = (input, variables = []) => run(['exec', '-i', container, 'psql', '-X', '-At',
  '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', ...variables], input);
const maintenance = readFileSync(new URL('../supabase/manual/repair_official_trust_token_gifts.sql', import.meta.url), 'utf8');
try {
  run(['run', '-d', '--name', container, '-e', 'POSTGRES_PASSWORD=synthetic-test-only',
    process.env.TEST_POSTGRES_IMAGE || 'postgres:17-alpine']);
  for (let i = 0; i < 60; i++) {
    if (spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).status === 0) break;
    if (i === 59) throw new Error('Test PostgreSQL did not become ready');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  sql(`CREATE TABLE pools (pool_id text, type text, up_character text);
    CREATE TABLE history (user_id text,record_id text,game_uid text,server_scope text,pool_id text,
      character_name text,item_name text,rarity integer,special_type text,character_id text,
      is_free boolean default false,is_info_book boolean default false,edit_version bigint default 1,
      seq_id text,timestamp timestamptz,pity integer,is_standard boolean default false,updated_at timestamptz,
      primary key(user_id,game_uid,server_scope,pool_id,seq_id));
    CREATE TABLE history_change_log (user_id text,record_id text);
    CREATE TABLE official_import_tasks (id text,status text,user_id text,game_uid text,server_id text);
    CREATE TABLE official_import_staged_records (task_id text,pool_id text,seq_id text,timestamp timestamptz,
      item_name text,item_id text,quality integer);
    CREATE TABLE history_anomalies (user_id text,record_id text,game_uid text,server_scope text,
      pool_id text,seq_id text,issue_code text,status text,
      resolved_at timestamptz,resolution_note text);
    INSERT INTO pools VALUES ('old','limited','目标'),('new','limited','目标');
    INSERT INTO official_import_tasks VALUES ('task','committed','user','game','1');`);
  const history = Array.from({ length: 291 }, (_, i) => ({
    user_id: 'user', record_id: String(i + 1), game_uid: 'game', server_scope: '1',
    pool_id: i < 250 ? 'old' : 'new', character_name: '角色', item_name: '角色',
    rarity: [204, 274].includes(i) ? 6 : 4, seq_id: String(i < 240 ? i + 1 : i + 3),
    timestamp: new Date(Date.UTC(2026, 8, 1, 0, 0, i + 1)).toISOString(),
  }));
  const token = { ...history[239], record_id: 'token', seq_id: '241',
    character_name: '目标的信物', item_name: '目标的信物' };
  const free = { ...history[239], record_id: 'free', seq_id: '242', rarity: 6, isFree: true, is_free: true };
  const wrong = { ...history[10], user_id: 'other', record_id: 'wrong', character_name: '其他的信物', item_name: '其他的信物' };
  const collision = { ...history[239], record_id: 'token', game_uid: 'other-game', seq_id: '241', pity: 77 };
  const rows = calculateHistoryPity([...history, token, free]);
  const insert = (records) => sql(`INSERT INTO history SELECT user_id,record_id,game_uid,server_scope,pool_id,
    character_name,item_name,rarity,special_type,character_id,COALESCE(is_free,false),false,1,
    seq_id,timestamp,pity,false,now() FROM jsonb_to_recordset('${JSON.stringify(records)}'::jsonb)
    AS r(user_id text,record_id text,game_uid text,server_scope text,pool_id text,character_name text,
      item_name text,rarity integer,special_type text,character_id text,is_free boolean,seq_id text,
      timestamp timestamptz,pity integer);`);
  insert([...rows, wrong, collision]);
  sql(`INSERT INTO official_import_staged_records VALUES ('task','old','241','${token.timestamp}','目标的信物',NULL,NULL);
    INSERT INTO history_anomalies VALUES ('user','token','game','1','old','241','OFFICIAL_IMPORT_UNKNOWN_ITEM','pending',NULL,NULL);`);
  const vars = ['-v', 'expected_token_count=1', '-v', 'backup_file=/tmp/token-test-backup.json'];
  assert.match(sql(maintenance, vars), /ROLLBACK/);
  assert.equal(sql("SELECT rarity FROM history WHERE record_id='token' AND game_uid='game';").trim(), '4');
  assert.match(sql(maintenance, [...vars, '-v', 'apply_repair=true']), /COMMIT/);
  assert.equal(sql(`CREATE TEMP TABLE backup_read (payload jsonb);
    COPY backup_read FROM '/tmp/token-test-backup.json';
    SELECT jsonb_array_length(payload->'anomalies') FROM backup_read;`).trim().split('\n').at(-1), '1');
  const actual = JSON.parse(sql("SELECT jsonb_agg(to_jsonb(h)) FROM history h WHERE user_id='user' AND game_uid='game';").trim());
  const corrected = rows.map((row) => row.record_id === 'token'
    ? { ...row, special_type: 'gift', rarity: 6, character_name: '目标' } : row);
  const expected = new Map(calculateHistoryPity(corrected).map((row) => [row.record_id, row.pity]));
  actual.forEach((row) => assert.equal(row.pity, expected.get(row.record_id), `pity ${row.record_id}`));
  assert.equal(actual.find((row) => row.record_id === 'token').special_type, 'gift');
  assert.equal(sql("SELECT status FROM history_anomalies;").trim(), 'resolved');
  assert.equal(sql("SELECT rarity FROM history WHERE record_id='wrong';").trim(), '4');
  assert.equal(sql("SELECT pity FROM history WHERE record_id='token' AND game_uid='other-game';").trim(), '77');
  assert.match(sql(maintenance, ['-v', 'expected_token_count=0', '-v', 'backup_file=/tmp/repeat.json']), /"tokens": 0/);
  console.log('PASS: preview rollback, evidence-bound repair, account isolation with colliding record IDs, cross-banner pity, free six-star, token preservation, anomaly resolution, idempotency.');
} finally {
  spawnSync('docker', ['rm', '-f', container], { encoding: 'utf8' });
}
