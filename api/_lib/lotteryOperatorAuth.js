import { getSupabaseAdminClient } from './authAdmin.js';
import { resolveAuthenticatedRequestUser } from './siteAuth.js';

export const LOTTERY_CONTACT_READ_CAPABILITY = 'contact_read';
export const LOTTERY_CONTACT_PURGE_CAPABILITY = 'contact_purge';

const ALLOWED_CAPABILITIES = new Set([
  LOTTERY_CONTACT_READ_CAPABILITY,
  LOTTERY_CONTACT_PURGE_CAPABILITY,
]);

export function isLotteryOperatorCapability(value) {
  return ALLOWED_CAPABILITIES.has(String(value || '').trim());
}

export async function requireLotteryOperatorCapability(req, {
  adminClient = getSupabaseAdminClient(),
  campaignId,
  capability,
  touch = true,
} = {}) {
  const authResult = await resolveAuthenticatedRequestUser(req, {
    adminClient,
    touch,
  });
  if (!authResult.ok) return authResult;
  if (!authResult.adminClient) {
    return {
      ok: false,
      status: 503,
      error: 'Auth service not configured',
      code: 'auth_service_not_configured',
    };
  }
  if (!campaignId || !isLotteryOperatorCapability(capability)) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid lottery operator capability request',
      code: 'invalid_lottery_operator_capability_request',
    };
  }

  const { data, error } = await authResult.adminClient.rpc(
    'has_summer_lottery_operator_capability',
    {
      p_campaign_id: campaignId,
      p_user_id: authResult.user.id,
      p_capability: capability,
    },
  );
  if (error) {
    return {
      ok: false,
      status: 500,
      error: 'Failed to verify lottery operator capability',
      code: 'lottery_operator_capability_check_failed',
    };
  }
  if (data !== true) {
    return {
      ok: false,
      status: 403,
      error: 'Lottery operator capability required',
      code: 'lottery_operator_capability_required',
    };
  }

  return {
    ...authResult,
    capability,
    campaignId,
  };
}

export default {
  LOTTERY_CONTACT_PURGE_CAPABILITY,
  LOTTERY_CONTACT_READ_CAPABILITY,
  isLotteryOperatorCapability,
  requireLotteryOperatorCapability,
};
