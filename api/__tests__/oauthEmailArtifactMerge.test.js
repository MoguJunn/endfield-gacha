// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadAuthUserById: vi.fn(),
  createSiteSession: vi.fn(),
}));

vi.mock('../_lib/authAdmin.js', () => ({
  loadAuthUserById: mocks.loadAuthUserById,
}));

vi.mock('../_lib/siteSession.js', () => ({
  createSiteSession: mocks.createSiteSession,
}));

import {
  completeOAuthEmailArtifactMerge,
  hashAccountMergeVerificationCode,
  inspectOAuthEmailArtifactMerge,
  maskAccountMergeEmail,
} from '../_lib/oauthEmailArtifactMerge.js';

const SOURCE_ID = '00000000-0000-4000-8000-000000000001';
const ARTIFACT_ID = '00000000-0000-4000-8000-000000000002';
const INTENT_ID = '10000000-0000-4000-8000-000000000001';
const SESSION_ID = '50000000-0000-4000-8000-000000000001';

function createAdminClient({
  failQuarantine = false,
  quarantineCommitThenError = false,
  failSourceBinding = false,
} = {}) {
  const intent = {
    id: INTENT_ID,
    source_user_id: SOURCE_ID,
    artifact_user_id: ARTIFACT_ID,
    target_email: 'legacy@example.com',
    quarantine_email: 'legacy.merge.artifact@oauth.local.invalid',
    status: 'verified',
    expires_at: '2099-08-03T12:00:00.000Z',
    verified_at: '2026-08-03T11:00:00.000Z',
    started_session_id: SESSION_ID,
    handoff_session_id: null,
  };
  const users = {
    [SOURCE_ID]: {
      id: SOURCE_ID,
      email: 'github.subject@oauth.local.invalid',
      user_metadata: { synthetic_oauth_email: true },
    },
    [ARTIFACT_ID]: {
      id: ARTIFACT_ID,
      email: 'legacy@example.com',
      user_metadata: { email_verified: true },
    },
  };
  let quarantineAttempts = 0;
  const rpc = vi.fn(async (name) => {
    if (name === 'claim_oauth_email_artifact_merge') {
      intent.status = 'claimed';
      return { data: [{ ...intent }], error: null };
    }
    if (name === 'quarantine_oauth_email_artifact_for_merge') {
      quarantineAttempts += 1;
      if (failQuarantine) {
        return { data: null, error: { code: 'quarantine_failed' } };
      }
      users[ARTIFACT_ID] = {
        ...users[ARTIFACT_ID],
        email: intent.quarantine_email,
        user_metadata: {
          ...users[ARTIFACT_ID].user_metadata,
          legacy_email_action_artifact: true,
          oauth_email_merge_intent_id: intent.id,
        },
      };
      if (quarantineCommitThenError && quarantineAttempts === 1) {
        return { data: null, error: { code: 'network_response_lost' } };
      }
      return { data: [{ ...intent }], error: null };
    }
    if (name === 'prepare_oauth_email_artifact_ownership_transfer') {
      intent.status = 'ownership_transferred';
      return { data: [{ ...intent }], error: null };
    }
    if (name === 'rollback_oauth_email_artifact_ownership_transfer') {
      intent.status = 'verified';
      return { data: [{ ...intent }], error: null };
    }
    if (name === 'release_oauth_email_artifact_merge_claim') {
      intent.status = 'verified';
      return { data: [{ ...intent }], error: null };
    }
    if (name === 'complete_oauth_email_artifact_merge') {
      intent.status = 'completed';
      return { data: [{ ...intent }], error: null };
    }
    if (name === 'mark_oauth_email_artifact_merge_coordination_required') {
      intent.status = 'coordination_required';
      return { data: null, error: null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
  const updateUserById = vi.fn(async (userId, payload) => {
    if (failSourceBinding && userId === SOURCE_ID && payload.email === intent.target_email) {
      return { data: null, error: { code: 'auth_update_failed' } };
    }
    users[userId] = {
      ...users[userId],
      ...(payload.email ? { email: payload.email } : {}),
      ...(payload.user_metadata ? { user_metadata: payload.user_metadata } : {}),
    };
    return { data: { user: users[userId] }, error: null };
  });
  const chainable = {
    eq() {
      return chainable;
    },
    is() {
      return chainable;
    },
    catch: async () => null,
  };
  const adminClient = {
    rpc,
    auth: { admin: { updateUserById } },
    from(table) {
      if (table === 'account_email_merge_intents') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: { ...intent }, error: null })),
              })),
            })),
          })),
          update: vi.fn((payload) => {
            if (payload.handoff_session_id) {
              intent.handoff_session_id = payload.handoff_session_id;
            }
            return chainable;
          }),
        };
      }
      if (table === 'app_sessions') {
        return {
          update: vi.fn(() => chainable),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  return { adminClient, intent, rpc, updateUserById, users };
}

describe('OAuth email artifact merge helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSiteSession.mockResolvedValue({ ok: true, session: { id: 'session-1' } });
  });

  it('binds verification hashes to intent, user, and code', () => {
    const first = hashAccountMergeVerificationCode({
      intentId: INTENT_ID,
      sourceUserId: SOURCE_ID,
      code: '123456',
    });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAccountMergeVerificationCode({
      intentId: INTENT_ID,
      sourceUserId: SOURCE_ID,
      code: '654321',
    })).not.toBe(first);
    expect(maskAccountMergeEmail('Legacy.User@Example.com')).toBe('le***@example.com');
  });

  it('maps database eligibility without exposing the artifact user id to clients', async () => {
    const adminClient = {
      rpc: vi.fn(async () => ({
        data: [{
          eligible: true,
          reason: 'legacy_email_artifact',
          artifact_user_id: ARTIFACT_ID,
          target_email: 'legacy@example.com',
        }],
        error: null,
      })),
    };

    await expect(inspectOAuthEmailArtifactMerge(adminClient, {
      sourceUserId: SOURCE_ID,
      targetEmail: 'Legacy@Example.com',
    })).resolves.toEqual({
      eligible: true,
      reason: 'legacy_email_artifact',
      artifactUserId: ARTIFACT_ID,
      targetEmail: 'legacy@example.com',
      maskedEmail: 'le***@example.com',
    });
  });

  it('claims, quarantines the artifact, transfers ownership, binds the OAuth user, and recreates a session', async () => {
    const context = createAdminClient();
    mocks.loadAuthUserById.mockImplementation(async (_client, userId) => context.users[userId]);

    const result = await completeOAuthEmailArtifactMerge(context.adminClient, {
      intentId: INTENT_ID,
      sourceUserId: SOURCE_ID,
      startedSessionId: SESSION_ID,
      req: { headers: {} },
      res: { setHeader: vi.fn() },
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      email: 'legacy@example.com',
      currentSessionRecreated: true,
    });
    expect(context.users[ARTIFACT_ID]).toMatchObject({
      email: 'legacy.merge.artifact@oauth.local.invalid',
      user_metadata: {
        legacy_email_action_artifact: true,
        oauth_email_merge_intent_id: INTENT_ID,
      },
    });
    expect(context.users[SOURCE_ID]).toMatchObject({
      email: 'legacy@example.com',
      user_metadata: {
        synthetic_oauth_email: false,
        legacy_email_conflict_repaired: true,
      },
    });
    expect(context.rpc.mock.calls.map(([name]) => name)).toEqual([
      'claim_oauth_email_artifact_merge',
      'quarantine_oauth_email_artifact_for_merge',
      'prepare_oauth_email_artifact_ownership_transfer',
      'complete_oauth_email_artifact_merge',
    ]);
    expect(context.rpc.mock.calls[0][1]).toMatchObject({
      p_intent_id: INTENT_ID,
      p_source_user_id: SOURCE_ID,
      p_current_session_id: SESSION_ID,
    });
    expect(context.intent.handoff_session_id).toBe('session-1');
    expect(mocks.createSiteSession).toHaveBeenCalledWith(
      context.adminClient,
      expect.objectContaining({ userId: SOURCE_ID })
    );
  });

  it('restores the artifact and database ownership when source Auth binding fails', async () => {
    const context = createAdminClient({ failSourceBinding: true });
    mocks.loadAuthUserById.mockImplementation(async (_client, userId) => context.users[userId]);

    const result = await completeOAuthEmailArtifactMerge(context.adminClient, {
      intentId: INTENT_ID,
      sourceUserId: SOURCE_ID,
      startedSessionId: SESSION_ID,
      req: { headers: {} },
      res: { setHeader: vi.fn() },
    });

    expect(result).toEqual({
      ok: false,
      code: 'oauth_email_merge_source_bind_failed',
      compensated: true,
    });
    expect(context.users[ARTIFACT_ID]).toMatchObject({
      email: 'legacy@example.com',
      user_metadata: { email_verified: true },
    });
    expect(context.rpc.mock.calls.map(([name]) => name)).toEqual([
      'claim_oauth_email_artifact_merge',
      'quarantine_oauth_email_artifact_for_merge',
      'prepare_oauth_email_artifact_ownership_transfer',
      'rollback_oauth_email_artifact_ownership_transfer',
    ]);
    expect(mocks.createSiteSession).not.toHaveBeenCalled();
  });

  it('keeps a failed atomic quarantine fail-closed for operator coordination', async () => {
    const context = createAdminClient({ failQuarantine: true });
    mocks.loadAuthUserById.mockImplementation(async (_client, userId) => context.users[userId]);

    const result = await completeOAuthEmailArtifactMerge(context.adminClient, {
      intentId: INTENT_ID,
      sourceUserId: SOURCE_ID,
      startedSessionId: SESSION_ID,
      req: { headers: {} },
      res: { setHeader: vi.fn() },
    });

    expect(result).toEqual({
      ok: false,
      code: 'oauth_email_merge_coordination_required',
    });
    expect(context.intent.status).toBe('coordination_required');
    expect(context.users[ARTIFACT_ID]).toMatchObject({
      email: 'legacy@example.com',
      user_metadata: { email_verified: true },
    });
    expect(context.updateUserById).not.toHaveBeenCalledWith(
      ARTIFACT_ID,
      expect.anything()
    );
    expect(context.rpc.mock.calls.map(([name]) => name)).toEqual([
      'claim_oauth_email_artifact_merge',
      'quarantine_oauth_email_artifact_for_merge',
      'quarantine_oauth_email_artifact_for_merge',
      'mark_oauth_email_artifact_merge_coordination_required',
    ]);
    expect(mocks.createSiteSession).not.toHaveBeenCalled();
  });

  it('retries an idempotent quarantine after the commit response is lost', async () => {
    const context = createAdminClient({ quarantineCommitThenError: true });
    mocks.loadAuthUserById.mockImplementation(async (_client, userId) => context.users[userId]);

    const result = await completeOAuthEmailArtifactMerge(context.adminClient, {
      intentId: INTENT_ID,
      sourceUserId: SOURCE_ID,
      startedSessionId: SESSION_ID,
      req: { headers: {} },
      res: { setHeader: vi.fn() },
    });

    expect(result).toMatchObject({ ok: true, status: 'completed' });
    expect(context.rpc.mock.calls.map(([name]) => name)).toEqual([
      'claim_oauth_email_artifact_merge',
      'quarantine_oauth_email_artifact_for_merge',
      'quarantine_oauth_email_artifact_for_merge',
      'prepare_oauth_email_artifact_ownership_transfer',
      'complete_oauth_email_artifact_merge',
    ]);
  });

  it('requires the original site session to claim a verified intent', async () => {
    const context = createAdminClient();
    mocks.loadAuthUserById.mockImplementation(async (_client, userId) => context.users[userId]);

    const result = await completeOAuthEmailArtifactMerge(context.adminClient, {
      intentId: INTENT_ID,
      sourceUserId: SOURCE_ID,
      startedSessionId: null,
      req: { headers: {} },
      res: { setHeader: vi.fn() },
    });

    expect(result).toEqual({
      ok: false,
      code: 'oauth_email_merge_site_session_required',
    });
    expect(context.rpc).not.toHaveBeenCalled();
    expect(mocks.createSiteSession).not.toHaveBeenCalled();
  });
});
