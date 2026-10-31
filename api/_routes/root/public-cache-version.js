import { createClient } from '@supabase/supabase-js';
import { rejectDisallowedBrowserOrigin } from '../../_lib/http.js';
import {
  NO_STORE_CACHE_CONTROL,
  resolvePublicCacheVersion,
} from '../../_lib/publicCache.js';
import {
  resolveSupabaseServerKey,
  resolveSupabaseUrl,
} from '../../_lib/supabaseEnv.js';

function getSupabaseClient() {
  const supabaseUrl = resolveSupabaseUrl();
  const supabaseKey = resolveSupabaseServerKey();

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', NO_STORE_CACHE_CONTROL);

  if (rejectDisallowedBrowserOrigin(req, res, {
    methods: 'GET, OPTIONS',
  })) {
    return;
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  const supabase = getSupabaseClient();
  const cacheVersion = await resolvePublicCacheVersion(supabase);
  // This value is public and is requested by every fresh navigation. Keep
  // explicit refreshes uncached; ordinary checks tolerate a 30-second CDN TTL.
  if (supabase && !req.query?.ts) {
    res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=30');
  }

  return res.status(200).json({
    success: true,
    cacheVersion,
    meta: {
      source: supabase ? 'site_config' : 'default',
      cacheVersion,
      cacheKey: 'public-cache-version',
      age: 0,
      partial: false,
      stale: false,
    },
  });
}
