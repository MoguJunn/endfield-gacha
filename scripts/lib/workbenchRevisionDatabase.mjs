import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

const bootstrap = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role',true),'') $$;
CREATE FUNCTION public.is_request_auth_session_allowed() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, role text, created_at timestamptz DEFAULT now());
CREATE TABLE public.pools(pool_id text PRIMARY KEY, user_id uuid REFERENCES public.profiles(id), name text NOT NULL,
 name_en text, type text NOT NULL, locked boolean DEFAULT false, is_limited_weapon boolean, up_character text,
 description text, banner_url text, start_time timestamptz, end_time timestamptz, featured_characters text[],
 extra_subtype text, extra_rule_profile text, extra_series_key text, extra_series_phase integer,
 created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.characters(id text PRIMARY KEY, name text NOT NULL, rarity integer NOT NULL, type text NOT NULL,
 aliases text[], is_limited boolean DEFAULT false, release_date timestamptz, pool_config jsonb DEFAULT '{"pools":["standard","limited"]}');
CREATE TABLE public.pool_characters(pool_id text REFERENCES public.pools(pool_id), character_id text REFERENCES public.characters(id),
 is_up boolean DEFAULT false, PRIMARY KEY(pool_id,character_id));
CREATE TABLE public.pool_id_aliases(source text, alias_id text, pool_id text REFERENCES public.pools(pool_id),
 is_primary boolean DEFAULT false, note text, updated_at timestamptz DEFAULT now(), PRIMARY KEY(source,alias_id));
CREATE TABLE public.history(id bigserial, user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE, record_id text NOT NULL,
 game_uid text, server_id text, server_scope text NOT NULL DEFAULT 'legacy', seq_id text, pool_id text, character_id text,
 character_name text, item_name text, rarity integer, is_standard boolean DEFAULT false, is_free boolean DEFAULT false,
 is_info_book boolean DEFAULT false, special_type text, timestamp timestamptz, edit_version bigint NOT NULL DEFAULT 1,
 pity integer DEFAULT 0, batch_id text, updated_at timestamptz DEFAULT now(), PRIMARY KEY(user_id,id));
CREATE TABLE public.history_change_log(id bigserial PRIMARY KEY, user_id uuid, record_id text, actor_user_id uuid,
 operation text, changed_fields jsonb, old_values jsonb, new_values jsonb, reason text, source text, created_at timestamptz DEFAULT now());
CREATE TABLE public.history_anomalies(user_id uuid,record_id text,game_uid text,server_scope text,pool_id text,seq_id text,
 status text,resolved_at timestamptz,resolved_by uuid,resolution_note text);
CREATE TABLE public.site_config(key text PRIMARY KEY,value text,label text,category text,updated_at timestamptz);
CREATE TABLE public.stats_cache(cache_key text PRIMARY KEY,cached_data jsonb,updated_at timestamptz DEFAULT now());
GRANT SELECT ON public.profiles TO anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.history TO service_role;
GRANT USAGE ON SEQUENCE public.history_id_seq TO service_role;
CREATE FUNCTION public.get_app_visible_pools() RETURNS SETOF public.pools LANGUAGE sql AS $$ SELECT * FROM public.pools $$;
`;
export async function createWorkbenchRevisionDatabase({ beforeRevisionMigration, historyScopeGenerated = false } = {}) {
  const directory = await mkdtemp(join(process.env.WORKBENCH_PG_TEMP || tmpdir(), 'endfield-revisions-'));
  const port = await new Promise((resolve, reject) => {
    const server = createServer(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
  const postgres = new EmbeddedPostgres({ databaseDir: join(directory, 'cluster'), port,
    user: 'postgres', password: randomBytes(24).toString('hex'), persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'], postgresFlags: ['-h', '127.0.0.1'], onLog() {}, onError() {} });
  const clients = [];
  const close = async () => { for (const client of clients) await client.end().catch(() => {});
    await postgres.stop().catch(() => {}); await rm(directory, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); };
  const connect = async (role = null, ownerId = null) => {
    const client = postgres.getPgClient('postgres', '127.0.0.1'); await client.connect(); clients.push(client);
    if (role) {
      if (!['service_role', 'authenticated', 'anon'].includes(role)) throw new Error('本机数据库角色无效');
      await client.query(`SET ROLE ${role}`);
      await client.query("SELECT set_config('request.jwt.claim.role',$1,false),set_config('request.jwt.claim.sub',$2,false)", [role, ownerId || '']);
    }
    return client;
  };
  const migration = async name => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
  try {
    await postgres.initialise(); await postgres.start();
    const root = await connect(); await root.query(historyScopeGenerated
      ? bootstrap.replace("server_scope text NOT NULL DEFAULT 'legacy'", "server_scope text GENERATED ALWAYS AS (COALESCE(NULLIF(btrim(server_id), ''), 'legacy')) STORED")
      : bootstrap);
    const extract = async (file, name) => {
      const source = await migration(file); const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
      if (start < 0) throw new Error(`未找到本机验证函数 ${name}`);
      const end = source.indexOf('$$;', source.indexOf('AS $$', start)); await root.query(source.slice(start, end + 3));
    };
    await extract('135_fix_service_role_admin_pool_rpc.sql', 'is_super_admin');
    await extract('183_split_reconstruction_claim_subtype.sql', 'admin_upsert_pool_with_aliases');
    await extract('152_add_history_review_and_import_staging.sql', 'recompute_history_scope');
    await extract('152_add_history_review_and_import_staging.sql', 'update_history_record_controlled');
    for (const file of ['173_add_personal_analysis_scope_revisions.sql', '174_add_personal_analysis_snapshot_queue.sql',
      '177_prioritize_active_personal_analysis_jobs.sql', '187_rebuild_personal_analysis_overview_filters.sql',
      '2026100911_create_account_data_workbench.sql', '2026100912_admin_pool_catalog_roster_and_recalculation.sql',
      '2026100913_atomic_workbench_workspace.sql']) await root.query(await migration(file));
    await beforeRevisionMigration?.(root);
    await root.query(await migration('2026101400_exclude_manual_statistics.sql'));
    await root.query(await migration('2026101401_incremental_account_data_revisions.sql'));
    await root.query(await migration('2026101402_restore_revisions_generated_history.sql'));
    await root.query(await migration('2026101403_bound_statistics_pity_interval_work.sql'));
    return { root, connect, close, port };
  } catch (error) { await close(); throw error; }
}
