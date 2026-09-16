import { timingSafeEqual } from 'node:crypto';
import { getSupabaseAdminClient } from '../../_lib/authAdmin.js';
import { decryptLotteryContact } from '../../_lib/lotteryContactCrypto.js';

const CAMPAIGN_ID = 'arknights-p3r-collab-2026';
const CONFIRMATION = `EXPORT ${CAMPAIGN_ID}`;
const MAX_ENTRIES = 1000;

function sendError(res, status, error, code = error) {
  return res.status(status).json({ success: false, error, code });
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return typeof req.body === 'object' ? req.body : {};
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function getExportToken(req) {
  const value = req.headers?.['x-lottery-export-token'];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

export default async function adminSummerLotteryContactExportHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'Method not allowed', 'method_not_allowed');
  }

  const configuredToken = String(process.env.LOTTERY_ONE_TIME_EXPORT_TOKEN || '');
  const providedToken = getExportToken(req);
  if (configuredToken.length < 43 || !safeEqual(providedToken, configuredToken)) {
    return sendError(res, 403, 'Export authorization required', 'export_authorization_required');
  }

  const body = parseBody(req);
  if (body.campaignId !== CAMPAIGN_ID || body.confirmation !== CONFIRMATION) {
    return sendError(res, 400, 'Export confirmation mismatch', 'export_confirmation_required');
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return sendError(res, 503, 'Supabase admin client is not configured', 'supabase_admin_not_configured');
  }

  try {
    const [{ data: campaign, error: campaignError }, superAdminResult] = await Promise.all([
      adminClient
        .from('summer_lottery_campaigns')
        .select('id,contact_retention_until,contacts_cleared_at')
        .eq('id', CAMPAIGN_ID)
        .maybeSingle(),
      adminClient
        .from('profiles')
        .select('id')
        .eq('role', 'super_admin')
        .limit(2),
    ]);
    if (campaignError) throw campaignError;
    if (superAdminResult.error) throw superAdminResult.error;
    if (!campaign) return sendError(res, 404, '活动不存在', 'lottery_campaign_not_found');
    if (campaign.contacts_cleared_at) {
      return sendError(res, 410, '联系方式已清理', 'lottery_contacts_cleared');
    }
    if (new Date(campaign.contact_retention_until).getTime() <= Date.now()) {
      return sendError(res, 410, '联系方式保留期已结束', 'lottery_contact_retention_expired');
    }
    const superAdmins = superAdminResult.data || [];
    if (superAdmins.length !== 1) {
      return sendError(res, 409, '超级管理员数量异常', 'super_admin_ambiguity');
    }

    const [{ data: entries, error: entriesError, count }, { data: winners, error: winnersError }] = await Promise.all([
      adminClient
        .from('summer_lottery_entries')
        .select('id,entry_number,contact_type,contact_value,notification_confirmed_at,eligible,created_at', { count: 'exact' })
        .eq('campaign_id', CAMPAIGN_ID)
        .order('entry_number')
        .range(0, MAX_ENTRIES - 1),
      adminClient
        .from('summer_lottery_winners')
        .select('entry_id,prize_tier,winner_order,claim_status')
        .eq('campaign_id', CAMPAIGN_ID),
    ]);
    if (entriesError) throw entriesError;
    if (winnersError) throw winnersError;
    if (count !== entries.length || count > MAX_ENTRIES) {
      return sendError(res, 409, '报名记录数量超出一次性导出上限', 'lottery_export_entry_limit');
    }

    const winnersByEntryId = new Map((winners || []).map((winner) => [winner.entry_id, winner]));
    const contacts = entries.map((entry) => {
      const winner = winnersByEntryId.get(entry.id) || null;
      return {
        lotteryNumber: `P3R26-${String(entry.entry_number).padStart(6, '0')}`,
        entryNumber: entry.entry_number,
        qq: decryptLotteryContact(entry.contact_value, {
          campaignId: CAMPAIGN_ID,
          contactType: entry.contact_type,
        }),
        eligible: entry.eligible,
        notificationConfirmedAt: entry.notification_confirmed_at,
        prizeTier: winner?.prize_tier || null,
        winnerOrder: winner?.winner_order || null,
        claimStatus: winner?.claim_status || null,
        enteredAt: entry.created_at,
      };
    });

    const { error: auditError } = await adminClient
      .from('summer_lottery_operation_audit')
      .insert({
        campaign_id: CAMPAIGN_ID,
        actor_user_id: superAdmins[0].id,
        operation: 'contact_export',
      });
    if (auditError) throw auditError;

    return res.status(200).json({
      success: true,
      campaignId: CAMPAIGN_ID,
      exportedAt: new Date().toISOString(),
      contacts,
    });
  } catch (error) {
    console.error('[lottery-contact-export] failed', error?.code || error?.message || error);
    return sendError(res, 500, '一次性导出失败', 'lottery_contact_export_failed');
  }
}
