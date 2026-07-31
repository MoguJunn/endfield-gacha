import { timingSafeEqual } from 'node:crypto';
import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function readBearerToken(req) {
  return String(req.headers?.authorization || req.headers?.Authorization || '')
    .replace(/^Bearer\s+/iu, '')
    .trim();
}

function authorizeRetentionWorker(req, env = process.env) {
  const expected = String(env.CRON_SECRET || '').trim();
  if (!expected) return { ok: false, status: 503, code: 'retention_worker_not_configured' };
  if (!safeEqual(readBearerToken(req), expected)) {
    return { ok: false, status: 401, code: 'retention_worker_unauthorized' };
  }
  return { ok: true };
}

async function findDueCampaigns(adminClient, now) {
  const { data, error } = await adminClient
    .from('summer_lottery_campaigns')
    .select('id')
    .in('status', ['drawn', 'cancelled'])
    .lte('contact_retention_until', now)
    .is('contacts_cleared_at', null)
    .order('contact_retention_until', { ascending: true })
    .limit(50);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function purgeDueCampaigns(adminClient, campaigns) {
  const results = [];
  for (const campaign of campaigns) {
    const { data, error } = await adminClient.rpc('purge_expired_summer_lottery_contacts', {
      p_campaign_id: campaign.id,
      p_actor_user_id: null,
    });
    if (error) {
      results.push({ campaignId: campaign.id, success: false, code: 'retention_purge_failed' });
      continue;
    }
    results.push({
      campaignId: data?.campaignId || campaign.id,
      success: true,
      clearedCount: Number(data?.clearedCount || 0),
      contactsClearedAt: data?.contactsClearedAt || null,
    });
  }
  return results;
}

export default async function summerLotteryContactRetentionHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, code: 'method_not_allowed' });
  }

  const auth = authorizeRetentionWorker(req);
  if (!auth.ok) return res.status(auth.status).json({ success: false, code: auth.code });

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return res.status(503).json({ success: false, code: 'supabase_admin_not_configured' });
  }

  try {
    const campaigns = await findDueCampaigns(adminClient, new Date().toISOString());
    const results = await purgeDueCampaigns(adminClient, campaigns);
    const failedCount = results.filter((result) => !result.success).length;
    return res.status(failedCount > 0 ? 207 : 200).json({
      success: failedCount === 0,
      dueCount: campaigns.length,
      failedCount,
      clearedCount: results.reduce((total, result) => total + Number(result.clearedCount || 0), 0),
      results,
    });
  } catch {
    return res.status(500).json({ success: false, code: 'retention_worker_failed' });
  }
}

export const __internal = {
  authorizeRetentionWorker,
  findDueCampaigns,
  purgeDueCampaigns,
};
