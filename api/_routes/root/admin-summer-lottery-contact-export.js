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
    const { data, error } = await adminClient.rpc('export_summer_lottery_contacts_once', {
      p_campaign_id: CAMPAIGN_ID,
    });
    if (error) throw error;
    const entries = Array.isArray(data?.contacts) ? data.contacts : [];
    if (entries.length > MAX_ENTRIES) {
      return sendError(res, 409, '报名记录数量超出一次性导出上限', 'lottery_export_entry_limit');
    }

    const contacts = entries.map((entry) => {
      return {
        lotteryNumber: entry.lotteryNumber,
        entryNumber: entry.entryNumber,
        qq: decryptLotteryContact(entry.encryptedContact, {
          campaignId: CAMPAIGN_ID,
          contactType: entry.contactType,
        }),
        eligible: entry.eligible,
        notificationConfirmedAt: entry.notificationConfirmedAt,
        prizeTier: entry.prizeTier || null,
        winnerOrder: entry.winnerOrder || null,
        claimStatus: entry.claimStatus || null,
        enteredAt: entry.enteredAt,
      };
    });

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
