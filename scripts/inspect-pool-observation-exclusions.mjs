import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { resolveSupabaseUrl, resolveSupabaseServerKey } from '../api/_lib/supabaseEnv.js';

// Read-only diagnosis. Print aggregate item IDs/counts, never raw history or account identities.
const env = { ...loadEnv('development', process.cwd(), ''), ...process.env };
const db = createClient(resolveSupabaseUrl(env), resolveSupabaseServerKey(env));
const poolId = process.argv[2] || 'special_1_5_1';
const { data: directory, error } = await db.from('characters').select('id,name,aliases,rarity');
if (error) throw new Error('Could not read character catalog');
const ids = directory.map((item) => item.id);
const { data: missing, error: missingError, count } = await db.from('history')
  .select('character_id,character_name,rarity', { count: 'exact' }).eq('pool_id', poolId)
  .or(`character_id.is.null,character_id.not.in.(${ids.join(',')})`).limit(1000);
if (missingError) throw new Error('Could not inspect missing catalog references');
const grouped = new Map();
for (const row of missing) {
  const matched = directory.filter((item) => [item.name, ...(item.aliases || [])].includes(row.character_name) && item.rarity === row.rarity);
  const key = JSON.stringify({ id: row.character_id, rarity: row.rarity, canonicalNameMatch: matched.map((item) => item.id),
    nameOnlyMatch: matched.length ? undefined : directory.filter((item) => [item.name, ...(item.aliases || [])].includes(row.character_name)).map((item) => ({ id: item.id, rarity: item.rarity })),
    missingName: !row.character_name });
  grouped.set(key, (grouped.get(key) || 0) + 1);
}
console.log(JSON.stringify({ poolId, catalogSize: ids.length, count, missing: [...grouped] }, null, 2));
