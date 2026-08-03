import { createHash } from 'node:crypto';

import { loadAuthUserById } from './authAdmin.js';
import { createSiteSession } from './siteSession.js';

const SYNTHETIC_OAUTH_EMAIL_SUFFIX = '@oauth.local.invalid';
const LONG_QUARANTINE_DURATION = '876000h';

function normalizeText(value) {
  return String(value || '').trim();
}

export function normalizeAccountMergeEmail(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized || normalized.length > 320) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
}

export function maskAccountMergeEmail(value) {
  const email = normalizeAccountMergeEmail(value);
  if (!email) return '';
  const [local, domain] = email.split('@');
  const localPrefix = local.slice(0, Math.min(2, local.length));
  return `${localPrefix}${local.length > localPrefix.length ? '***' : ''}@${domain}`;
}

export function hashAccountMergeVerificationCode({
  intentId,
  sourceUserId,
  code,
} = {}) {
  return createHash('sha256')
    .update(`${normalizeText(intentId)}:${normalizeText(sourceUserId)}:${normalizeText(code)}`, 'utf8')
    .digest('hex');
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] || null : data || null;
}

async function runRpc(adminClient, name, payload) {
  if (typeof adminClient?.rpc !== 'function') {
    const error = new Error('OAuth email merge service unavailable');
    error.code = 'oauth_email_merge_unavailable';
    throw error;
  }
  const query = adminClient.rpc(name, payload);
  const { data, error } = typeof query?.maybeSingle === 'function'
    ? await query.maybeSingle()
    : await query;
  if (error) {
    const wrapped = new Error(error.message || 'OAuth email merge operation failed');
    wrapped.code = error.code || 'oauth_email_merge_failed';
    throw wrapped;
  }
  return firstRow(data);
}

export async function inspectOAuthEmailArtifactMerge(adminClient, {
  sourceUserId,
  targetEmail,
} = {}) {
  const normalizedEmail = normalizeAccountMergeEmail(targetEmail);
  if (!sourceUserId || !normalizedEmail) {
    return {
      eligible: false,
      reason: 'invalid_merge_candidate',
      artifactUserId: null,
      targetEmail: normalizedEmail,
      maskedEmail: maskAccountMergeEmail(normalizedEmail),
    };
  }

  const row = await runRpc(adminClient, 'inspect_oauth_email_artifact_merge', {
    p_source_user_id: sourceUserId,
    p_target_email: normalizedEmail,
  });
  return {
    eligible: row?.eligible === true,
    reason: row?.reason || 'oauth_email_merge_not_available',
    artifactUserId: row?.artifact_user_id || null,
    targetEmail: row?.target_email || normalizedEmail,
    maskedEmail: maskAccountMergeEmail(row?.target_email || normalizedEmail),
  };
}

export async function startOAuthEmailArtifactMerge(adminClient, {
  intentId,
  sourceUserId,
  startedSessionId,
  targetEmail,
  verificationCode,
  expiresAt,
} = {}) {
  return runRpc(adminClient, 'start_oauth_email_artifact_merge', {
    p_intent_id: intentId,
    p_source_user_id: sourceUserId,
    p_started_session_id: startedSessionId,
    p_target_email: normalizeAccountMergeEmail(targetEmail),
    p_verification_code_hash: hashAccountMergeVerificationCode({
      intentId,
      sourceUserId,
      code: verificationCode,
    }),
    p_expires_at: expiresAt,
  });
}

export async function verifyOAuthEmailArtifactMerge(adminClient, {
  intentId,
  sourceUserId,
  verificationCode,
} = {}) {
  return runRpc(adminClient, 'verify_oauth_email_artifact_merge', {
    p_intent_id: intentId,
    p_source_user_id: sourceUserId,
    p_verification_code_hash: hashAccountMergeVerificationCode({
      intentId,
      sourceUserId,
      code: verificationCode,
    }),
  });
}

async function loadMergeIntent(adminClient, intentId, sourceUserId) {
  const { data, error } = await adminClient
    .from('account_email_merge_intents')
    .select('id, source_user_id, artifact_user_id, target_email, quarantine_email, status, expires_at, verified_at, started_session_id, handoff_session_id, last_error_code')
    .eq('id', intentId)
    .eq('source_user_id', sourceUserId)
    .maybeSingle();
  if (error) {
    const wrapped = new Error(error.message || 'Failed to load OAuth email merge intent');
    wrapped.code = error.code || 'oauth_email_merge_intent_load_failed';
    throw wrapped;
  }
  return data || null;
}

async function updateAuthUserAndReconcile(adminClient, userId, payload, predicate) {
  let updateError = null;
  try {
    const { error } = await adminClient.auth.admin.updateUserById(userId, payload);
    updateError = error || null;
  } catch (error) {
    updateError = error;
  }

  const currentUser = await loadAuthUserById(adminClient, userId).catch(() => null);
  if (currentUser && predicate(currentUser)) {
    return { ok: true, user: currentUser, reconciled: Boolean(updateError) };
  }
  return {
    ok: false,
    user: currentUser,
    code: updateError?.code || 'auth_user_update_failed',
  };
}

function getUserMetadata(authUser) {
  return authUser?.user_metadata || authUser?.raw_user_meta_data || {};
}

function getRestoredArtifactMetadata(authUser) {
  const metadata = { ...getUserMetadata(authUser) };
  delete metadata.legacy_email_action_artifact;
  delete metadata.legacy_email_released_at;
  delete metadata.oauth_email_merge_intent_id;
  return metadata;
}

function isSyntheticOAuthUser(authUser) {
  return normalizeAccountMergeEmail(authUser?.email).endsWith(SYNTHETIC_OAUTH_EMAIL_SUFFIX)
    || getUserMetadata(authUser).synthetic_oauth_email === true;
}

async function markCoordinationRequired(adminClient, intent, code) {
  await runRpc(adminClient, 'mark_oauth_email_artifact_merge_coordination_required', {
    p_intent_id: intent.id,
    p_source_user_id: intent.source_user_id,
    p_error_code: code,
  }).catch(() => null);
}

async function restoreArtifactAfterRollback(adminClient, intent, originalArtifact) {
  return updateAuthUserAndReconcile(
    adminClient,
    intent.artifact_user_id,
    {
      email: intent.target_email,
      email_confirm: true,
      ban_duration: 'none',
      user_metadata: getRestoredArtifactMetadata(originalArtifact),
    },
    (user) => normalizeAccountMergeEmail(user?.email) === intent.target_email
  );
}

async function releaseClaimAndRestoreArtifact(adminClient, intent, artifactAuthUser, code) {
  const released = await runRpc(adminClient, 'release_oauth_email_artifact_merge_claim', {
    p_intent_id: intent.id,
    p_source_user_id: intent.source_user_id,
    p_error_code: code,
  }).catch(() => null);
  const restored = released?.id
    ? await restoreArtifactAfterRollback(adminClient, intent, artifactAuthUser)
    : { ok: false };
  return { released: Boolean(released?.id), restored };
}

async function revokeHandoffSession(adminClient, intent) {
  if (!intent?.handoff_session_id) {
    return;
  }
  await adminClient
    .from('app_sessions')
    .update({
      revoked_at: new Date().toISOString(),
      revoke_reason: 'oauth_email_artifact_merge_handoff_superseded',
    })
    .eq('id', intent.handoff_session_id)
    .is('revoked_at', null)
    .catch(() => null);
}

async function recordHandoffSession(adminClient, intentId, sourceUserId, sessionId) {
  await adminClient
    .from('account_email_merge_intents')
    .update({ handoff_session_id: sessionId, handoff_completed_at: new Date().toISOString() })
    .eq('id', intentId)
    .eq('source_user_id', sourceUserId)
    .catch(() => null);
}

async function revokeStartedSession(adminClient, intent) {
  if (!intent?.started_session_id) {
    return;
  }
  await adminClient
    .from('app_sessions')
    .update({
      revoked_at: new Date().toISOString(),
      revoke_reason: 'oauth_email_artifact_merge_handoff',
    })
    .eq('id', intent.started_session_id)
    .is('revoked_at', null)
    .catch(() => null);
}

async function createHandoffSession(adminClient, intent, req, res) {
  const sessionResult = await createSiteSession(adminClient, {
    userId: intent.source_user_id,
    req,
    res,
    provider: 'oauth_email_artifact_merge',
  });
  if (sessionResult.ok) {
    await recordHandoffSession(adminClient, intent.id, intent.source_user_id, sessionResult.session.id);
    await revokeStartedSession(adminClient, intent);
  }
  return sessionResult;
}

export async function completeOAuthEmailArtifactMerge(adminClient, {
  intentId,
  sourceUserId,
  startedSessionId,
  req,
  res,
} = {}) {
  const intent = await loadMergeIntent(adminClient, intentId, sourceUserId);
  if (!intent) {
    return { ok: false, code: 'oauth_email_merge_intent_not_found' };
  }

  if (intent.status === 'completed') {
    await revokeHandoffSession(adminClient, intent);
    const sessionResult = await createHandoffSession(adminClient, intent, req, res);
    if (!sessionResult.ok) {
      return {
        ok: false,
        code: 'oauth_email_merge_session_recreate_failed',
        mergeCompleted: true,
      };
    }
    return {
      ok: true,
      status: 'completed',
      intentId: intent.id,
      email: intent.target_email,
      maskedEmail: maskAccountMergeEmail(intent.target_email),
      mergeCompleted: true,
      currentSessionRecreated: true,
    };
  }

  if (!['verified', 'claimed', 'ownership_transferred'].includes(intent.status)) {
    return {
      ok: false,
      code: intent.status === 'coordination_required'
        ? 'oauth_email_merge_coordination_required'
        : 'oauth_email_merge_verification_required',
    };
  }
  if (intent.status === 'verified') {
    if (
      !intent.expires_at
      || new Date(intent.expires_at).getTime() <= Date.now()
      || !startedSessionId
      || intent.started_session_id !== startedSessionId
    ) {
      return {
        ok: false,
        code: startedSessionId && intent.started_session_id === startedSessionId
          ? 'oauth_email_merge_verification_expired'
          : 'oauth_email_merge_site_session_required',
      };
    }

    try {
      const claimed = await runRpc(adminClient, 'claim_oauth_email_artifact_merge', {
        p_intent_id: intent.id,
        p_source_user_id: intent.source_user_id,
        p_current_session_id: startedSessionId,
      });
      if (!claimed?.id) {
        return { ok: false, code: 'oauth_email_merge_candidate_changed' };
      }
    } catch (error) {
      const latest = await loadMergeIntent(adminClient, intent.id, intent.source_user_id).catch(() => intent);
      if (latest.status !== 'claimed') {
        return {
          ok: false,
          code: String(error.message || '').includes('oauth_email_merge_candidate_changed')
            ? 'oauth_email_merge_candidate_changed'
            : (error.code || 'oauth_email_merge_claim_failed'),
        };
      }
    }
  }

  const latestIntent = await loadMergeIntent(adminClient, intent.id, intent.source_user_id);
  if (!latestIntent) {
    return { ok: false, code: 'oauth_email_merge_intent_not_found' };
  }
  if (latestIntent.status === 'completed') {
    const sessionResult = await createHandoffSession(adminClient, latestIntent, req, res);
    return sessionResult.ok
      ? {
        ok: true,
        status: 'completed',
        intentId: latestIntent.id,
        email: latestIntent.target_email,
        maskedEmail: maskAccountMergeEmail(latestIntent.target_email),
        mergeCompleted: true,
        currentSessionRecreated: true,
      }
      : { ok: false, code: 'oauth_email_merge_session_recreate_failed', mergeCompleted: true };
  }

  let stage = latestIntent.status;
  if (stage === 'ownership_transferred') {
    // Database transfer already committed; continue with the source binding.
  }

  const [sourceAuthUser, artifactAuthUser] = await Promise.all([
    loadAuthUserById(adminClient, latestIntent.source_user_id),
    loadAuthUserById(adminClient, latestIntent.artifact_user_id),
  ]);
  if (!sourceAuthUser?.id || !artifactAuthUser?.id) {
    return { ok: false, code: 'oauth_email_merge_auth_user_missing' };
  }

  if (stage === 'claimed') {
    if (!isSyntheticOAuthUser(sourceAuthUser)) {
      await releaseClaimAndRestoreArtifact(adminClient, latestIntent, artifactAuthUser, 'source_changed');
      return { ok: false, code: 'oauth_email_merge_source_changed' };
    }

    const releasedAt = new Date().toISOString();
    const artifactRelease = await updateAuthUserAndReconcile(
      adminClient,
      latestIntent.artifact_user_id,
      {
        email: latestIntent.quarantine_email,
        email_confirm: true,
        ban_duration: LONG_QUARANTINE_DURATION,
        user_metadata: {
          ...getUserMetadata(artifactAuthUser),
          legacy_email_action_artifact: true,
          legacy_email_released_at: releasedAt,
          oauth_email_merge_intent_id: latestIntent.id,
        },
      },
      (user) => (
        normalizeAccountMergeEmail(user?.email) === latestIntent.quarantine_email
        && getUserMetadata(user).oauth_email_merge_intent_id === latestIntent.id
      )
    );
    if (!artifactRelease.ok) {
      await releaseClaimAndRestoreArtifact(adminClient, latestIntent, artifactAuthUser, 'quarantine_failed');
      return { ok: false, code: 'oauth_email_artifact_quarantine_failed' };
    }

    let transferred;
    try {
      transferred = await runRpc(adminClient, 'prepare_oauth_email_artifact_ownership_transfer', {
        p_intent_id: latestIntent.id,
        p_source_user_id: latestIntent.source_user_id,
      });
    } catch (error) {
      const afterError = await loadMergeIntent(adminClient, latestIntent.id, latestIntent.source_user_id).catch(() => latestIntent);
      if (afterError.status === 'ownership_transferred') {
        stage = 'ownership_transferred';
      } else {
        const released = await releaseClaimAndRestoreArtifact(
          adminClient,
          afterError,
          artifactAuthUser,
          error.code || 'ownership_transfer_failed'
        );
        if (!released.restored.ok) {
          await markCoordinationRequired(adminClient, afterError, 'ownership_transfer_and_restore_failed');
          return { ok: false, code: 'oauth_email_merge_coordination_required' };
        }
        return { ok: false, code: error.code || 'oauth_email_merge_ownership_transfer_failed', compensated: true };
      }
    }
    if (!transferred?.id && stage !== 'ownership_transferred') {
      await markCoordinationRequired(adminClient, latestIntent, 'ownership_transfer_empty');
      return { ok: false, code: 'oauth_email_merge_coordination_required' };
    }
    if (stage !== 'ownership_transferred') {
      stage = 'ownership_transferred';
    }
  }

  let currentSource = await loadAuthUserById(adminClient, latestIntent.source_user_id).catch(() => sourceAuthUser);
  if (stage === 'ownership_transferred' && normalizeAccountMergeEmail(currentSource?.email) !== latestIntent.target_email) {
    const sourceBinding = await updateAuthUserAndReconcile(
      adminClient,
      latestIntent.source_user_id,
      {
        email: latestIntent.target_email,
        email_confirm: true,
        user_metadata: {
          ...getUserMetadata(currentSource),
          synthetic_oauth_email: false,
          email_bound_from_profile: true,
          legacy_email_conflict_repaired: true,
          legacy_email_conflict_repaired_at: new Date().toISOString(),
        },
      },
      (user) => normalizeAccountMergeEmail(user?.email) === latestIntent.target_email
    );

    if (!sourceBinding.ok) {
      let rollback;
      try {
        rollback = await runRpc(adminClient, 'rollback_oauth_email_artifact_ownership_transfer', {
          p_intent_id: latestIntent.id,
          p_source_user_id: latestIntent.source_user_id,
          p_error_code: sourceBinding.code,
        });
      } catch {
        const afterRollback = await loadMergeIntent(adminClient, latestIntent.id, latestIntent.source_user_id).catch(() => latestIntent);
        if (afterRollback.status === 'ownership_transferred') {
          await markCoordinationRequired(adminClient, afterRollback, 'source_bind_and_rollback_failed');
          return { ok: false, code: 'oauth_email_merge_coordination_required' };
        }
        rollback = afterRollback;
      }
      const restored = rollback?.id
        ? await restoreArtifactAfterRollback(adminClient, latestIntent, artifactAuthUser)
        : { ok: false };
      if (!rollback?.id || !restored.ok) {
        await markCoordinationRequired(adminClient, latestIntent, 'source_bind_and_compensation_failed');
        return { ok: false, code: 'oauth_email_merge_coordination_required' };
      }
      return { ok: false, code: 'oauth_email_merge_source_bind_failed', compensated: true };
    }
    currentSource = sourceBinding.user;
  }

  let completedIntent;
  try {
    completedIntent = await runRpc(adminClient, 'complete_oauth_email_artifact_merge', {
      p_intent_id: latestIntent.id,
      p_source_user_id: latestIntent.source_user_id,
    });
  } catch (error) {
    const afterComplete = await loadMergeIntent(adminClient, latestIntent.id, latestIntent.source_user_id).catch(() => latestIntent);
    if (afterComplete.status !== 'completed') {
      await markCoordinationRequired(adminClient, afterComplete, error.code || 'merge_completion_failed');
      return {
        ok: false,
        code: 'oauth_email_merge_coordination_required',
        emailUpdated: normalizeAccountMergeEmail(currentSource?.email) === latestIntent.target_email,
      };
    }
    completedIntent = afterComplete;
  }
  if (!completedIntent?.id) {
    return { ok: false, code: 'oauth_email_merge_completion_failed' };
  }

  const sessionResult = await createHandoffSession(adminClient, completedIntent, req, res);
  if (!sessionResult.ok) {
    return {
      ok: false,
      code: 'oauth_email_merge_session_recreate_failed',
      mergeCompleted: true,
    };
  }

  return {
    ok: true,
    status: 'completed',
    intentId: completedIntent.id,
    email: completedIntent.target_email,
    maskedEmail: maskAccountMergeEmail(completedIntent.target_email),
    mergeCompleted: true,
    currentSessionRecreated: true,
  };
}

export default {
  completeOAuthEmailArtifactMerge,
  hashAccountMergeVerificationCode,
  inspectOAuthEmailArtifactMerge,
  maskAccountMergeEmail,
  normalizeAccountMergeEmail,
  startOAuthEmailArtifactMerge,
  verifyOAuthEmailArtifactMerge,
};
