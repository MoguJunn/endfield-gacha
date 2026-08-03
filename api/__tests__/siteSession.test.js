// @vitest-environment node

import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSyntheticOAuthEmail,
  createOrLinkOAuthUserAndSession,
  createSiteSession,
  createSiteSessionFromBearer,
  createSupabaseCompatAccessToken,
  linkOAuthIdentityToSiteSession,
  loadActiveSiteSessionById,
  loadSiteAuthIdentities,
  loadSiteSession,
  parseCookieHeader,
  revokeSiteSession,
  revokeAllSiteSessionsForUser,
  serializeCookie,
  unlinkSiteAuthIdentity,
} from '../_lib/siteSession.js';

class SessionLifecycleQuery {
  constructor(rows) {
    this.rows = rows;
    this.operation = 'select';
    this.payload = null;
    this.filters = [];
  }

  select() {
    return this;
  }

  update(payload) {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }

  eq(column, value) {
    this.filters.push({ op: 'eq', column, value });
    return this;
  }

  is(column, value) {
    this.filters.push({ op: 'is', column, value });
    return this;
  }

  gt(column, value) {
    this.filters.push({ op: 'gt', column, value });
    return this;
  }

  maybeSingle() {
    const result = this.execute();
    return Promise.resolve({
      data: Array.isArray(result.data) ? result.data[0] || null : result.data,
      error: result.error,
    });
  }

  then(resolve) {
    resolve(this.execute());
  }

  execute() {
    const matching = this.rows.filter((row) => this.filters.every((filter) => {
      if (filter.op === 'eq') return row[filter.column] === filter.value;
      if (filter.op === 'is') return row[filter.column] === filter.value;
      if (filter.op === 'gt') return row[filter.column] > filter.value;
      return false;
    }));
    if (this.operation === 'update') {
      matching.forEach((row) => Object.assign(row, this.payload));
    }
    return { data: matching.map((row) => ({ ...row })), error: null };
  }
}

function createSessionLifecycleAdminClient(rows) {
  return {
    rpc(name, payload) {
      if (name === 'revoke_app_session_by_token_hashes') {
        let revokedCount = 0;
        rows.forEach((row) => {
          const matches = row.session_token_hash === payload.p_session_token_hash
            || row.refresh_token_hash === payload.p_refresh_token_hash
            || row.refresh_token_aliases?.includes(payload.p_refresh_token_hash);
          if (matches && row.revoked_at === null) {
            row.revoked_at = payload.p_revoked_at;
            row.revoke_reason = payload.p_reason;
            revokedCount += 1;
          }
        });
        return Promise.resolve({ data: revokedCount, error: null });
      }
      if (name !== 'revoke_all_app_sessions_for_user') {
        throw new Error(`Unexpected RPC: ${name}`);
      }
      let revokedCount = 0;
      rows.forEach((row) => {
        if (row.user_id === payload.p_user_id && row.revoked_at === null) {
          row.revoked_at = payload.p_revoked_at;
          row.revoke_reason = payload.p_reason;
          revokedCount += 1;
        }
      });
      return Promise.resolve({ data: revokedCount, error: null });
    },
    from(table) {
      if (table !== 'app_sessions') {
        throw new Error(`Unexpected table: ${table}`);
      }
      return new SessionLifecycleQuery(rows);
    },
  };
}

function createResponseRecorder() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    getHeader(name) {
      return this.headers[name];
    },
  };
}

function createRequest() {
  return {
    headers: {
      host: 'ef-gacha.mogujun.icu',
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '203.0.113.24',
      'user-agent': 'Vitest',
    },
    socket: {
      remoteAddress: '127.0.0.1',
    },
  };
}

function createInsertOnlyAdminClient(calls) {
  return {
    from(table) {
      return {
        insert(payload) {
          calls.push({ table, operation: 'insert', payload });
          return {
            select() {
              return {
                single: async () => ({
                  data: {
                    id: 'session-id',
                    ...payload,
                  },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };
}

function createIdentityAdminClient(rows) {
  return {
    from(table) {
      return {
        select(fields) {
          return {
            eq(column, value) {
              const state = { table, fields, eq: [column, value], includeDisabled: true };
              const query = {
                order(orderColumn, options) {
                  state.order = [orderColumn, options];
                  return Promise.resolve({ data: rows, error: null });
                },
                is(isColumn, isValue) {
                  state.is = [isColumn, isValue];
                  return {
                    order(orderColumn, options) {
                      state.order = [orderColumn, options];
                      return Promise.resolve({
                        data: rows.filter((row) => row.disabled_at === null),
                        error: null,
                      });
                    },
                  };
                },
              };
              return query;
            },
          };
        },
      };
    },
  };
}

function createRefreshableSessionAdminClient({ sessionRow = null, refreshRow = null, profileRow = null, identityRows = [] } = {}) {
  const update = vi.fn((payload) => {
    const filters = {};
    const query = {
      eq: vi.fn((column, value) => {
        filters[column] = value;
        return query;
      }),
      is: vi.fn((column, value) => {
        filters[column] = value;
        return query;
      }),
      select: vi.fn(() => query),
      maybeSingle: vi.fn(async () => {
        if (
          !refreshRow
          || filters.id !== refreshRow.id
          || filters.refresh_token_hash !== refreshRow.refresh_token_hash
          || filters.revoked_at !== null
        ) {
          return { data: null, error: null };
        }
        Object.assign(refreshRow, payload);
        return { data: { ...refreshRow }, error: null };
      }),
      single: vi.fn(async () => query.maybeSingle()),
      then(resolve) {
        resolve({ error: null });
      },
    };
    return query;
  });
  const rpc = vi.fn(async (name, payload) => {
    if (name === 'is_account_credential_allowed') {
      return { data: true, error: null };
    }
    if (name !== 'rotate_app_session_tokens') {
      throw new Error(`Unexpected RPC: ${name}`);
    }
    if (
      !refreshRow
      || refreshRow.id !== payload.p_session_id
      || refreshRow.refresh_token_hash !== payload.p_expected_refresh_token_hash
      || refreshRow.revoked_at !== null
    ) {
      return { data: null, error: null };
    }
    Object.assign(refreshRow, {
      session_token_hash: payload.p_new_session_token_hash,
      refresh_token_hash: payload.p_new_refresh_token_hash,
      expires_at: payload.p_expires_at,
      last_seen_at: new Date().toISOString(),
    });
    return { data: { ...refreshRow }, error: null };
  });
  return {
    __mocks: {
      rpc,
      update,
    },
    rpc,
    from(table) {
      if (table === 'app_sessions') {
        const buildRowResult = (row) => ({
          is() {
            return {
              gt() {
                return {
                  gt() {
                    return {
                      maybeSingle: async () => ({ data: row, error: null }),
                    };
                  },
                  maybeSingle: async () => ({ data: row, error: null }),
                };
              },
            };
          },
        });
        return {
          select() {
            return {
              eq(column, _value) {
                if (column === 'session_token_hash') {
                  return buildRowResult(sessionRow);
                }

                if (column === 'refresh_token_hash') {
                  return buildRowResult(
                    refreshRow?.refresh_token_hash === _value ? refreshRow : null
                  );
                }

                return {
                  maybeSingle: async () => ({ data: null, error: null }),
                };
              },
            };
          },
          update,
        };
      }

      if (table === 'profiles') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: profileRow, error: null }),
                };
              },
            };
          },
          update: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: null })),
          })),
        };
      }

      if (table === 'app_auth_identities') {
        return {
          select() {
            return {
              eq() {
                return {
                  is() {
                    return {
                      order: async () => ({ data: identityRows, error: null }),
                    };
                  },
                  order: async () => ({ data: identityRows, error: null }),
                };
              },
            };
          },
        };
      }

      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: null, error: null }),
              };
            },
          };
        },
      };
    },
  };
}

function createSiteIdentityMutationAdminClient({
  sessionRow,
  profileRow,
  identityRows = [],
  authUserById = {},
  identityInsertConflictRow = null,
  withIdentityRpc = false,
  verifiedPasswordLogin = null,
  authUsersForRecovery = null,
} = {}) {
  const identities = [...identityRows];
  const updates = [];
  const upserts = [];
  const auditEvents = [];
  const securityStates = [];
  const nowIso = new Date(Date.now() + 3600000).toISOString();

  function activeIdentitiesForUser(userId) {
    return identities.filter((row) => row.user_id === userId && row.disabled_at === null);
  }

  return {
    __mocks: {
      identities,
      updates,
      upserts,
      auditEvents,
      securityStates,
    },
    ...(withIdentityRpc ? {
      rpc: vi.fn(async (name, payload) => {
        if (name === 'has_verified_password_login') {
          const authUser = authUserById[payload.p_user_id] || null;
          return {
            data: verifiedPasswordLogin ?? Boolean(authUser?.encrypted_password),
            error: null,
          };
        }
        if (name === 'refresh_oauth_account_security_state') {
          const authUser = authUserById[payload.p_user_id] || null;
          const hasPassword = verifiedPasswordLogin ?? Boolean(authUser?.encrypted_password);
          const state = {
            user_id: payload.p_user_id,
            email_verification_required: payload.p_requires_email === true,
            password_change_required: !hasPassword,
            password_setup_capability_id: payload.p_created ? payload.p_capability_id : null,
            password_setup_capability_status: payload.p_created && !hasPassword ? 'available' : null,
          };
          if (payload.p_requires_email || !hasPassword) {
            securityStates.push(state);
          }
          return { data: state, error: null };
        }
        if (name !== 'claim_oauth_identity_v2') {
          throw new Error(`Unexpected RPC: ${name}`);
        }
        const current = identities.find((identity) => (
          identity.provider === payload.p_provider
          && identity.provider_subject_hash === payload.p_current_hash
        ));
        const previous = identities.find((identity) => (
          identity.provider === payload.p_provider
          && payload.p_candidate_hashes.includes(identity.provider_subject_hash)
        ));
        const identity = current || previous;
        if (identity && identity.user_id !== payload.p_user_id) {
          return { data: null, error: { code: 'P0001', message: 'oauth_identity_already_linked' } };
        }
        const row = identity || {
          id: `identity-${identities.length + 1}`,
          user_id: payload.p_user_id,
          provider: payload.p_provider,
          linked_at: nowIso,
          disabled_at: null,
        };
        row.provider_subject_hash = payload.p_current_hash;
        row.provider_subject_hash_key_version = payload.p_current_version;
        if (!identity) {
          identities.push(row);
        }
        return { data: row, error: null };
      }),
    } : {}),
    auth: {
      admin: {
        ...(Array.isArray(authUsersForRecovery) ? {
          listUsers: vi.fn(async () => ({
            data: {
              users: authUsersForRecovery,
              total: authUsersForRecovery.length,
            },
            error: null,
          })),
        } : {}),
        getUserById: vi.fn(async (userId) => ({
          data: {
            user: authUserById[userId] || null,
          },
          error: null,
        })),
        createUser: vi.fn(async (payload) => ({
          data: {
            user: {
              id: '00000000-0000-4000-8000-000000000099',
              email: payload.email,
              user_metadata: payload.user_metadata,
            },
          },
          error: null,
        })),
        deleteUser: vi.fn(async () => ({ data: null, error: null })),
      },
    },
    from(table) {
      if (table === 'app_sessions') {
        return {
          insert(payload) {
            return {
              select() {
                return {
                  single: async () => ({
                    data: {
                      id: 'session-id',
                      created_at: nowIso,
                      last_seen_at: nowIso,
                      revoked_at: null,
                      ...payload,
                    },
                    error: null,
                  }),
                };
              },
            };
          },
          select() {
            return {
              eq(column) {
                if (column === 'session_token_hash') {
                  return {
                    is() {
                      return {
                        gt() {
                          return {
                            gt() {
                              return {
                                maybeSingle: async () => ({ data: sessionRow, error: null }),
                              };
                            },
                          };
                        },
                      };
                    },
                  };
                }
                return {
                  maybeSingle: async () => ({ data: null, error: null }),
                };
              },
            };
          },
          update(payload) {
            updates.push({ table, payload });
            return {
              eq: vi.fn(async () => ({ error: null })),
            };
          },
        };
      }

      if (table === 'profiles') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: profileRow, error: null }),
                };
              },
            };
          },
          upsert(payload) {
            return {
              select() {
                return {
                  single: async () => ({
                    data: {
                      created_at: nowIso,
                      updated_at: nowIso,
                      last_seen_at: null,
                      ...payload,
                    },
                    error: null,
                  }),
                };
              },
            };
          },
          update(payload) {
            updates.push({ table, payload });
            return {
              eq: vi.fn(async () => ({ error: null })),
            };
          },
        };
      }

      if (table === 'app_auth_audit_events') {
        return {
          insert(payload) {
            auditEvents.push(payload);
            return Promise.resolve({ data: payload, error: null });
          },
        };
      }

      if (table === 'app_auth_identities') {
        return {
          select() {
            return {
              eq(column, value) {
                if (column === 'provider') {
                  const provider = value;
                  return {
                    eq(subjectColumn, subjectValue) {
                      const row = identities.find((identity) => (
                        identity.provider === provider
                        && identity.provider_subject_hash === subjectValue
                      )) || null;
                      return {
                        maybeSingle: async () => ({ data: row, error: null }),
                      };
                    },
                  };
                }
                if (column === 'id') {
                  const row = identities.find((identity) => identity.id === value) || null;
                  return {
                    maybeSingle: async () => ({ data: row, error: null }),
                  };
                }
                if (column === 'user_id') {
                  return {
                    is() {
                      return {
                        order: async () => ({ data: activeIdentitiesForUser(value), error: null }),
                      };
                    },
                    order: async () => ({ data: activeIdentitiesForUser(value), error: null }),
                  };
                }
                return {
                  maybeSingle: async () => ({ data: null, error: null }),
                };
              },
            };
          },
          insert(payload) {
            upserts.push(payload);
            const existingIndex = identities.findIndex((identity) => (
              identity.provider === payload.provider
              && identity.provider_subject_hash === payload.provider_subject_hash
            ));
            if (existingIndex >= 0 || identityInsertConflictRow) {
              if (existingIndex < 0) {
                identities.push({ ...identityInsertConflictRow });
              }
              return {
                select() {
                  return {
                    single: async () => ({
                      data: null,
                      error: { code: '23505', message: 'duplicate identity' },
                    }),
                  };
                },
              };
            }
            const row = {
              id: `identity-${identities.length + 1}`,
              linked_at: nowIso,
              ...payload,
            };
            identities.push(row);
            return {
              select() {
                return {
                  single: async () => ({ data: row, error: null }),
                };
              },
            };
          },
          update(payload) {
            const state = {};
            const query = {
              eq(column, value) {
                state[column] = value;
                return query;
              },
              is(column, value) {
                state[column] = value;
                return query;
              },
              select() {
                return query;
              },
              async single() {
                const index = identities.findIndex((identity) => (
                  Object.entries(state).every(([column, value]) => identity[column] === value)
                ));
                if (index >= 0) {
                  identities[index] = { ...identities[index], ...payload };
                }
                updates.push({ table, payload, state: { ...state } });
                return {
                  data: index >= 0 ? identities[index] : null,
                  error: index >= 0 ? null : { code: 'not_found', message: 'not found' },
                };
              },
            };
            return query;
          },
        };
      }

      if (table === 'account_security_states') {
        return {
          upsert(payload) {
            securityStates.push(payload);
            return {
              select() {
                return {
                  maybeSingle: async () => ({ data: payload, error: null }),
                };
              },
            };
          },
        };
      }

      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: null, error: null }),
              };
            },
          };
        },
      };
    },
  };
}

function decodeJwtPayload(token) {
  const [, payload] = String(token || '').split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

beforeEach(() => {
  delete process.env.APP_SESSION_SECRET;
  delete process.env.APP_SESSION_TTL_SECONDS;
  delete process.env.APP_SESSION_IDLE_TTL_SECONDS;
  delete process.env.APP_SESSION_ABSOLUTE_TTL_SECONDS;
  delete process.env.APP_REFRESH_COOKIE_NAME;
  delete process.env.APP_SESSION_COMPAT_JWT_ENABLED;
  delete process.env.SUPABASE_JWT_SECRET;
  delete process.env.SUPABASE_URL;
});

describe('siteSession utilities', () => {
  it('serializes and parses HttpOnly cookies', () => {
    const cookie = serializeCookie('__Host-eg_session', 'token value', {
      maxAgeSeconds: 60,
      secure: true,
    });

    expect(cookie).toContain('__Host-eg_session=token%20value');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(parseCookieHeader(cookie)['__Host-eg_session']).toBe('token value');
  });

  it('builds deterministic synthetic OAuth emails under the internal invalid domain', () => {
    expect(buildSyntheticOAuthEmail('Linux.do', 'abcdef1234567890abcdef1234567890')).toBe(
      'linuxdo.abcdef1234567890abcdef1234567890@oauth.local.invalid'
    );
  });

  it('creates a site session and stores only token hashes in the database payload', async () => {
    process.env.APP_SESSION_SECRET = 'site-session-test-secret';
    const calls = [];
    const res = createResponseRecorder();

    const result = await createSiteSession(createInsertOnlyAdminClient(calls), {
      userId: '00000000-0000-4000-8000-000000000001',
      req: createRequest(),
      res,
      provider: 'linuxdo',
    });

    expect(result.ok).toBe(true);
    expect(calls[0].table).toBe('app_sessions');
    expect(calls[0].payload.session_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(calls[0].payload.refresh_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(String(calls[0].payload.session_token_hash)).not.toContain('eg_session');
    expect(Date.parse(calls[0].payload.expires_at) - Date.now()).toBeLessThanOrEqual(2 * 60 * 60 * 1000);
    expect(res.headers['Set-Cookie']).toHaveLength(2);
    expect(res.headers['Set-Cookie'][0]).toContain('__Host-eg_session=');
    expect(res.headers['Set-Cookie'][0]).toContain('Max-Age=7200');
    expect(res.headers['Set-Cookie'][1]).toContain('__Secure-eg_refresh=');
    expect(res.headers['Set-Cookie'][1]).toContain('Path=/api/auth/session');
  });

  it('normalizes a legacy __Host- refresh cookie override to a valid __Secure- cookie', async () => {
    process.env.APP_SESSION_SECRET = 'site-session-test-secret';
    process.env.APP_REFRESH_COOKIE_NAME = '__Host-eg_refresh';
    const res = createResponseRecorder();

    const result = await createSiteSession(createInsertOnlyAdminClient([]), {
      userId: '00000000-0000-4000-8000-000000000001',
      req: createRequest(),
      res,
    });

    expect(result.ok).toBe(true);
    expect(res.headers['Set-Cookie'][1]).toContain('__Secure-eg_refresh=');
    expect(res.headers['Set-Cookie'][1]).toContain('Path=/api/auth/session');
    expect(res.headers['Set-Cookie'][1]).not.toContain('__Host-eg_refresh=');
  });

  it('creates one bearer-bound site session through the atomic database RPC', async () => {
    process.env.APP_SESSION_SECRET = 'site-session-test-secret';
    const rpc = vi.fn(async (_name, payload) => ({
      data: {
        id: 'bearer-session-id',
        user_id: payload.p_user_id,
        source_auth_session_id: payload.p_source_auth_session_id,
      },
      error: null,
    }));
    const adminClient = {
      rpc,
      from: vi.fn(() => ({
        insert: vi.fn(async () => ({ data: null, error: null })),
      })),
    };
    const res = createResponseRecorder();
    const nowSeconds = Math.floor(Date.now() / 1000);

    const result = await createSiteSessionFromBearer(adminClient, {
      userId: '00000000-0000-4000-8000-000000000001',
      sourceAuthSessionId: '10000000-0000-4000-8000-000000000001',
      bearerIssuedAt: nowSeconds,
      bearerExpiresAt: nowSeconds + 3600,
      req: createRequest(),
      res,
    });

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('create_or_rotate_bearer_app_session', expect.objectContaining({
      p_user_id: '00000000-0000-4000-8000-000000000001',
      p_source_auth_session_id: '10000000-0000-4000-8000-000000000001',
      p_session_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_refresh_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(res.headers['Set-Cookie']).toHaveLength(2);
  });

  it('creates a Supabase-compatible access token when the JWT secret is available', () => {
    process.env.SUPABASE_JWT_SECRET = 'supabase-jwt-secret';
    process.env.SUPABASE_URL = 'https://db.example.test';

    const token = createSupabaseCompatAccessToken({
      user: {
        id: '00000000-0000-4000-8000-000000000001',
        email: null,
      },
      profile: {
        username: 'linuxdo_user',
      },
      sessionBinding: '10000000-0000-4000-8000-0000000000ab',
      ttlSeconds: 300,
    });

    expect(token.accessToken.split('.')).toHaveLength(3);
    expect(token.expiresIn).toBe(300);
    const payload = decodeJwtPayload(token.accessToken);
    expect(payload.sub).toBe('00000000-0000-4000-8000-000000000001');
    expect(payload.role).toBe('authenticated');
    expect(payload.user_metadata.username).toBe('linuxdo_user');
    expect(payload.session_binding).toBe('10000000-0000-4000-8000-0000000000ab');
    expect(payload.session_id).toBeUndefined();
  });

  it('revokes every active session for a user and invalidates compatibility token lookup', async () => {
    const now = Date.parse('2026-07-25T12:00:00.000Z');
    const rows = [
      {
        id: 'session-1',
        user_id: 'user-1',
        revoked_at: null,
        expires_at: '2026-07-25T13:00:00.000Z',
        absolute_expires_at: '2026-07-26T12:00:00.000Z',
      },
      {
        id: 'session-2',
        user_id: 'user-1',
        revoked_at: null,
        expires_at: '2026-07-25T13:00:00.000Z',
        absolute_expires_at: '2026-07-26T12:00:00.000Z',
      },
      {
        id: 'other-session',
        user_id: 'user-2',
        revoked_at: null,
        expires_at: '2026-07-25T13:00:00.000Z',
        absolute_expires_at: '2026-07-26T12:00:00.000Z',
      },
    ];
    const adminClient = createSessionLifecycleAdminClient(rows);

    await expect(loadActiveSiteSessionById(adminClient, {
      sessionId: 'session-1',
      userId: 'user-1',
      now,
    })).resolves.toMatchObject({ ok: true, active: true });

    await expect(revokeAllSiteSessionsForUser(adminClient, {
      userId: 'user-1',
      reason: 'password_changed',
      now,
    })).resolves.toEqual({ ok: true, revokedCount: 2 });

    await expect(loadActiveSiteSessionById(adminClient, {
      sessionId: 'session-1',
      userId: 'user-1',
      now,
    })).resolves.toMatchObject({ ok: true, active: false });
    expect(rows[2].revoked_at).toBeNull();
  });

  it('revokes the database session when only the refresh cookie remains', async () => {
    process.env.APP_SESSION_SECRET = 'site-session-test-secret';
    const refreshToken = 'refresh-only-token';
    const rows = [{
      id: 'refresh-only-session',
      user_id: 'user-1',
      session_token_hash: 'expired-session-token-hash',
      refresh_token_hash: createHmac('sha256', process.env.APP_SESSION_SECRET)
        .update(`refresh:${refreshToken}`, 'utf8')
        .digest('hex'),
      revoked_at: null,
    }];
    const req = createRequest();
    req.headers.cookie = `__Secure-eg_refresh=${refreshToken}`;
    const res = createResponseRecorder();

    await revokeSiteSession(createSessionLifecycleAdminClient(rows), { req, res });

    expect(rows[0]).toMatchObject({
      revoke_reason: 'user_logout',
      revoked_at: expect.any(String),
    });
    expect(res.headers['Set-Cookie']).toHaveLength(2);
  });

  it('revokes a rotated session family through a historical refresh hash', async () => {
    process.env.APP_SESSION_SECRET = 'site-session-test-secret';
    const oldRefreshToken = 'stolen-old-refresh-token';
    const oldRefreshHash = createHmac('sha256', process.env.APP_SESSION_SECRET)
      .update(`refresh:${oldRefreshToken}`, 'utf8')
      .digest('hex');
    const rows = [{
      id: 'rotated-session',
      user_id: 'user-1',
      session_token_hash: 'current-session-token-hash',
      refresh_token_hash: 'current-refresh-token-hash',
      refresh_token_aliases: [oldRefreshHash],
      revoked_at: null,
    }];
    const req = createRequest();
    req.headers.cookie = `__Secure-eg_refresh=${oldRefreshToken}`;

    const result = await revokeSiteSession(createSessionLifecycleAdminClient(rows), {
      req,
      res: createResponseRecorder(),
    });

    expect(result).toEqual({ ok: true, revokedCount: 1 });
    expect(rows[0].revoked_at).toEqual(expect.any(String));
  });

  it('reports database revocation errors while still clearing cookies', async () => {
    process.env.APP_SESSION_SECRET = 'site-session-test-secret';
    const req = createRequest();
    req.headers.cookie = '__Secure-eg_refresh=refresh-token';
    const res = createResponseRecorder();
    const adminClient = {
      rpc: vi.fn(async () => ({
        data: null,
        error: { code: 'database_unavailable', message: 'database unavailable' },
      })),
    };

    const result = await revokeSiteSession(adminClient, { req, res });

    expect(result).toMatchObject({
      ok: false,
      code: 'database_unavailable',
    });
    expect(res.headers['Set-Cookie']).toHaveLength(2);
  });

  it('loads redacted site-managed OAuth identities for the settings page', async () => {
    const identities = await loadSiteAuthIdentities(createIdentityAdminClient([
      {
        id: 'identity-1',
        provider: 'github',
        display_name: 'Octo User',
        avatar_url: 'https://avatars.example.test/u/1',
        email_verified: true,
        linked_at: '2026-05-30T00:00:00.000Z',
        last_used_at: '2026-05-30T01:00:00.000Z',
        disabled_at: null,
      },
    ]), {
      userId: '00000000-0000-4000-8000-000000000001',
    });

    expect(identities).toEqual([
      expect.objectContaining({
        id: 'identity-1',
        provider: 'github',
        source: 'site_session',
        created_at: '2026-05-30T00:00:00.000Z',
        identity_data: expect.objectContaining({
          username: 'Octo User',
          email_verified: true,
          site_session: true,
        }),
      }),
    ]);
    expect(JSON.stringify(identities)).not.toContain('provider_subject');
    expect(JSON.stringify(identities)).not.toContain('access_token');
  });

  it('allows the Supabase-compatible token bridge to be disabled', () => {
    process.env.SUPABASE_JWT_SECRET = 'supabase-jwt-secret';
    process.env.APP_SESSION_COMPAT_JWT_ENABLED = 'false';

    expect(createSupabaseCompatAccessToken({
      user: {
        id: '00000000-0000-4000-8000-000000000001',
      },
    })).toBeNull();
  });

  it('restores a site session from the refresh cookie when the session cookie is stale', async () => {
    process.env.APP_SESSION_SECRET = 'site-session-test-secret';
    process.env.SUPABASE_JWT_SECRET = 'supabase-jwt-secret';
    process.env.SUPABASE_URL = 'https://db.example.test';

    const oldRefreshHash = createHmac('sha256', 'site-session-test-secret')
      .update('refresh:refresh-token-value', 'utf8')
      .digest('hex');
    const adminClient = createRefreshableSessionAdminClient({
      sessionRow: null,
      refreshRow: {
        id: 'session-id',
        user_id: '00000000-0000-4000-8000-000000000001',
        compat_session_binding: '10000000-0000-4000-8000-0000000000ab',
        session_token_hash: 'old-session-hash',
        refresh_token_hash: oldRefreshHash,
        revoked_at: null,
        absolute_expires_at: new Date(Date.now() + 3600000).toISOString(),
        expires_at: new Date(Date.now() - 1000).toISOString(),
        last_seen_at: new Date(Date.now() - 1000).toISOString(),
      },
      profileRow: {
        id: '00000000-0000-4000-8000-000000000001',
        username: 'site_user',
        email: 'user@example.com',
        role: 'user',
        created_at: '2026-05-30T00:00:00.000Z',
        updated_at: '2026-05-30T01:00:00.000Z',
        last_seen_at: '2026-05-30T01:00:00.000Z',
      },
      identityRows: [
        {
          id: 'identity-1',
          provider: 'github',
          display_name: 'site_user',
          avatar_url: null,
          email_verified: true,
          linked_at: '2026-05-30T00:00:00.000Z',
          last_used_at: '2026-05-30T01:00:00.000Z',
          disabled_at: null,
        },
      ],
    });
    const req = {
      headers: {
        cookie: '__Host-eg_session=stale-session-token; __Secure-eg_refresh=refresh-token-value',
        host: 'ef-gacha.mogujun.icu',
        'x-forwarded-proto': 'https',
        'user-agent': 'Vitest',
      },
      socket: {
        remoteAddress: '127.0.0.1',
      },
    };
    const res = createResponseRecorder();

    const result = await loadSiteSession(adminClient, {
      req,
      res,
    });

    expect(result.ok).toBe(true);
    expect(result.authenticated).toBe(true);
    expect(result.session.id).toBe('session-id');
    expect(result.user.id).toBe('00000000-0000-4000-8000-000000000001');
    expect(result.identities).toHaveLength(1);
    expect(adminClient.__mocks.rpc).toHaveBeenCalledWith(
      'rotate_app_session_tokens',
      expect.objectContaining({
        p_session_id: 'session-id',
        p_expected_refresh_token_hash: oldRefreshHash,
      })
    );
    expect(res.headers['Set-Cookie']).toHaveLength(2);
    expect(res.headers['Set-Cookie'][1]).toContain('__Secure-eg_refresh=');
    expect(res.headers['Set-Cookie'][1]).toContain('Path=/api/auth/session');

    const replayResponse = createResponseRecorder();
    const replay = await loadSiteSession(adminClient, {
      req,
      res: replayResponse,
    });
    expect(replay.authenticated).toBe(false);
    expect(replay.code).toBe('site_session_refresh_replayed');
    expect(replayResponse.headers['Set-Cookie']).toBeUndefined();
  });

  it('keeps email verification from the Auth user after OAuth identities are unlinked', async () => {
    process.env.APP_SESSION_SECRET = 'site-session-test-secret';
    const userId = '00000000-0000-4000-8000-000000000001';
    const verifiedAt = '2026-06-01T00:00:00.000Z';
    const adminClient = createSiteIdentityMutationAdminClient({
      sessionRow: {
        id: 'session-id',
        user_id: userId,
        absolute_expires_at: new Date(Date.now() + 3600000).toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        last_seen_at: new Date().toISOString(),
      },
      profileRow: {
        id: userId,
        username: 'site_user',
        email: 'user@example.com',
        role: 'user',
      },
      identityRows: [],
      authUserById: {
        [userId]: {
          id: userId,
          email: 'user@example.com',
          email_confirmed_at: verifiedAt,
          user_metadata: {
            username: 'site_user',
          },
        },
      },
    });

    const result = await loadSiteSession(adminClient, {
      req: {
        ...createRequest(),
        headers: {
          ...createRequest().headers,
          cookie: '__Host-eg_session=session-token',
        },
      },
      touch: false,
    });

    expect(result.ok).toBe(true);
    expect(result.authenticated).toBe(true);
    expect(result.identities).toHaveLength(0);
    expect(result.user.email).toBe('user@example.com');
    expect(result.user.email_confirmed_at).toBe(verifiedAt);
    expect(result.user.user_metadata.email_verified).toBe(true);
  });

  it('links an OAuth identity to the current site session user', async () => {
    process.env.APP_SESSION_SECRET = 'site-session-test-secret';
    const sessionRow = {
      id: 'session-id',
      user_id: '00000000-0000-4000-8000-000000000001',
      absolute_expires_at: new Date(Date.now() + 3600000).toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      last_seen_at: new Date().toISOString(),
    };
    const profileRow = {
      id: sessionRow.user_id,
      username: 'site_user',
      email: 'user@example.com',
      role: 'user',
      created_at: '2026-05-30T00:00:00.000Z',
      updated_at: '2026-05-30T01:00:00.000Z',
      last_seen_at: '2026-05-30T01:00:00.000Z',
    };
    const adminClient = createSiteIdentityMutationAdminClient({
      sessionRow,
      profileRow,
      identityRows: [],
    });

    const result = await linkOAuthIdentityToSiteSession(adminClient, {
      profile: {
        provider: 'github',
        subject: '123',
        username: 'octo-user',
        displayName: 'Octo User',
        emailVerified: false,
      },
      subjectHash: 'subject-hash',
      profileHash: 'profile-hash',
      req: {
        ...createRequest(),
        headers: {
          ...createRequest().headers,
          cookie: '__Host-eg_session=session-token',
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.identity).toMatchObject({
      provider: 'github',
      source: 'site_session',
    });
    expect(adminClient.__mocks.upserts[0]).toMatchObject({
      user_id: sessionRow.user_id,
      provider: 'github',
      provider_subject_hash: 'subject-hash',
      disabled_at: null,
    });
  });

  it('creates GitHub OAuth users without adopting provider email as site email', async () => {
    process.env.APP_SESSION_SECRET = 'site-session-test-secret';
    const adminClient = createSiteIdentityMutationAdminClient({
      profileRow: null,
      identityRows: [],
    });

    const result = await createOrLinkOAuthUserAndSession(adminClient, {
      profile: {
        provider: 'github',
        subject: '123',
        username: 'octo-user',
        displayName: 'Octo User',
        email: 'github-user@example.com',
        emailVerified: true,
      },
      subjectHash: 'abcdef1234567890abcdef1234567890',
      profileHash: 'profile-hash',
      req: createRequest(),
      res: createResponseRecorder(),
    });

    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(result.profile.email).toBeNull();
    expect(result.user.email).toBeNull();
    expect(adminClient.auth.admin.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: 'github.abcdef1234567890abcdef1234567890@oauth.local.invalid',
      email_confirm: true,
      user_metadata: expect.objectContaining({
        synthetic_oauth_email: true,
      }),
    }));
    expect(adminClient.__mocks.upserts).toEqual([
      expect.objectContaining({
        provider: 'github',
        email_hash: null,
        email_verified: false,
      }),
    ]);
    expect(adminClient.__mocks.securityStates).toEqual([
      expect.objectContaining({
        email_verification_required: true,
        email_verification_reason: 'oauth_email_setup_required',
        password_change_required: true,
        password_change_reason: 'oauth_password_setup_required',
      }),
    ]);
  });

  it('migrates a previous OAuth identity hash to the current dedicated key version', async () => {
    process.env.APP_SESSION_SECRET = 'site-session-test-secret';
    const userId = '00000000-0000-4000-8000-000000000001';
    const adminClient = createSiteIdentityMutationAdminClient({
      withIdentityRpc: true,
      profileRow: {
        id: userId,
        username: 'octo-user',
        email: 'user@example.com',
        role: 'user',
      },
      identityRows: [{
        id: 'identity-legacy',
        user_id: userId,
        provider: 'github',
        provider_subject_hash: 'previous-subject-hash',
        provider_subject_hash_key_version: 'v1',
        display_name: 'Octo User',
        disabled_at: null,
      }],
      authUserById: {
        [userId]: {
          id: userId,
          email: 'user@example.com',
          email_confirmed_at: '2026-06-01T00:00:00.000Z',
          encrypted_password: '$2a$10$hash',
          user_metadata: { site_password_set: true },
        },
      },
    });

    const result = await createOrLinkOAuthUserAndSession(adminClient, {
      profile: {
        provider: 'github',
        subject: '123',
        username: 'octo-user',
        displayName: 'Octo User',
      },
      subjectHash: 'current-subject-hash',
      subjectHashVersion: 'v2',
      previousSubjectHash: 'previous-subject-hash',
      previousSubjectHashVersion: 'v1',
      profileHash: 'profile-hash-v2',
      req: createRequest(),
      res: createResponseRecorder(),
    });

    expect(result.ok).toBe(true);
    expect(result.created).toBe(false);
    expect(adminClient.auth.admin.createUser).not.toHaveBeenCalled();
    expect(adminClient.rpc).toHaveBeenCalledWith('claim_oauth_identity_v2', expect.objectContaining({
      p_current_hash: 'current-subject-hash',
      p_current_version: 'v2',
      p_candidate_hashes: ['previous-subject-hash'],
    }));
    expect(adminClient.__mocks.identities[0]).toMatchObject({
      user_id: userId,
      provider_subject_hash: 'current-subject-hash',
      provider_subject_hash_key_version: 'v2',
    });
  });

  it('reuses an account stored with the real legacy state-secret hash', async () => {
    process.env.APP_SESSION_SECRET = 'site-session-test-secret';
    const userId = '00000000-0000-4000-8000-000000000001';
    const adminClient = createSiteIdentityMutationAdminClient({
      withIdentityRpc: true,
      profileRow: {
        id: userId,
        username: 'legacy-user',
        email: 'legacy@example.com',
        role: 'user',
      },
      identityRows: [{
        id: 'identity-real-legacy',
        user_id: userId,
        provider: 'github',
        provider_subject_hash: 'real-legacy-state-hash',
        provider_subject_hash_key_version: 'legacy_state_v1',
        display_name: 'Legacy User',
        disabled_at: null,
      }],
      authUserById: {
        [userId]: {
          id: userId,
          email: 'legacy@example.com',
          email_confirmed_at: '2026-06-01T00:00:00.000Z',
          encrypted_password: '$2a$10$hash',
        },
      },
    });

    const result = await createOrLinkOAuthUserAndSession(adminClient, {
      profile: {
        provider: 'github',
        subject: '123',
        username: 'legacy-user',
        displayName: 'Legacy User',
      },
      subjectHash: 'current-dedicated-hash',
      subjectHashVersion: 'v2',
      previousSubjectHash: 'previous-dedicated-hash',
      previousSubjectHashVersion: 'v1',
      legacySubjectHash: 'real-legacy-state-hash',
      legacySubjectHashVersion: 'legacy_state_v1',
      profileHash: 'profile-hash-v2',
      req: createRequest(),
      res: createResponseRecorder(),
    });

    expect(result).toMatchObject({ ok: true, created: false });
    expect(adminClient.auth.admin.createUser).not.toHaveBeenCalled();
    expect(adminClient.rpc).toHaveBeenCalledWith('claim_oauth_identity_v2', expect.objectContaining({
      p_current_hash: 'current-dedicated-hash',
      p_candidate_hashes: ['previous-dedicated-hash', 'real-legacy-state-hash'],
    }));
    expect(adminClient.__mocks.identities[0]).toMatchObject({
      user_id: userId,
      provider_subject_hash: 'current-dedicated-hash',
      provider_subject_hash_key_version: 'v2',
    });
  });

  it('recovers an old orphan Auth user that predates identity hash metadata', async () => {
    process.env.APP_SESSION_SECRET = 'site-session-test-secret';
    const userId = '00000000-0000-4000-8000-000000000077';
    const legacyHash = 'a'.repeat(64);
    const oldAuthUser = {
      id: userId,
      email: buildSyntheticOAuthEmail('github', legacyHash),
      email_confirmed_at: '2026-05-01T00:00:00.000Z',
      user_metadata: {
        auth_provider: 'github',
        synthetic_oauth_email: true,
        username: 'legacy-orphan',
      },
    };
    const adminClient = createSiteIdentityMutationAdminClient({
      withIdentityRpc: true,
      profileRow: null,
      authUsersForRecovery: [oldAuthUser],
      authUserById: { [userId]: oldAuthUser },
    });

    const result = await createOrLinkOAuthUserAndSession(adminClient, {
      profile: {
        provider: 'github',
        subject: '123',
        username: 'legacy-orphan',
        displayName: 'Legacy Orphan',
      },
      subjectHash: 'b'.repeat(64),
      subjectHashVersion: 'v2',
      legacySubjectHash: legacyHash,
      legacySubjectHashVersion: 'legacy_state_v1',
      profileHash: 'profile-hash-v2',
      req: createRequest(),
      res: createResponseRecorder(),
    });

    expect(result).toMatchObject({ ok: true, created: false });
    expect(adminClient.auth.admin.createUser).not.toHaveBeenCalled();
    expect(adminClient.__mocks.identities[0]).toMatchObject({
      user_id: userId,
      provider_subject_hash: 'b'.repeat(64),
      provider_subject_hash_key_version: 'v2',
    });
  });

  it('does not require password setup when the database confirms an existing password login', async () => {
    process.env.APP_SESSION_SECRET = 'site-session-test-secret';
    const userId = '00000000-0000-4000-8000-000000000001';
    const adminClient = createSiteIdentityMutationAdminClient({
      withIdentityRpc: true,
      verifiedPasswordLogin: true,
      profileRow: {
        id: userId,
        username: 'site_user',
        email: 'user@example.com',
        role: 'user',
      },
      identityRows: [{
        id: 'identity-existing',
        user_id: userId,
        provider: 'github',
        provider_subject_hash: 'subject-hash',
        provider_subject_hash_key_version: 'v2',
        display_name: 'Site User',
        disabled_at: null,
      }],
      authUserById: {
        [userId]: {
          id: userId,
          email: 'user@example.com',
          email_confirmed_at: '2026-06-01T00:00:00.000Z',
        },
      },
    });

    const result = await createOrLinkOAuthUserAndSession(adminClient, {
      profile: {
        provider: 'github',
        subject: '123',
        username: 'site-user',
        displayName: 'Site User',
      },
      subjectHash: 'subject-hash',
      subjectHashVersion: 'v2',
      profileHash: 'profile-hash',
      req: createRequest(),
      res: createResponseRecorder(),
    });

    expect(result.ok).toBe(true);
    expect(result.created).toBe(false);
    expect(adminClient.rpc).toHaveBeenCalledWith(
      'refresh_oauth_account_security_state',
      expect.objectContaining({ p_user_id: userId })
    );
    expect(adminClient.__mocks.securityStates).toEqual([]);
  });

  it('keeps the first OAuth identity owner and deletes a losing concurrent Auth user', async () => {
    process.env.APP_SESSION_SECRET = 'site-session-test-secret';
    const adminClient = createSiteIdentityMutationAdminClient({
      profileRow: null,
      identityRows: [],
      identityInsertConflictRow: {
        id: 'winner-identity',
        user_id: '00000000-0000-4000-8000-000000000088',
        provider: 'github',
        provider_subject_hash: 'subject-hash',
        disabled_at: null,
      },
    });

    await expect(createOrLinkOAuthUserAndSession(adminClient, {
      profile: {
        provider: 'github',
        subject: '123',
        username: 'octo-user',
      },
      subjectHash: 'subject-hash',
      profileHash: 'profile-hash',
      req: createRequest(),
      res: createResponseRecorder(),
    })).rejects.toMatchObject({
      code: 'oauth_identity_already_linked',
    });

    expect(adminClient.__mocks.identities[0].user_id).toBe(
      '00000000-0000-4000-8000-000000000088'
    );
    expect(adminClient.auth.admin.deleteUser).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000099'
    );
  });

  it('rejects direct sign-in with a previously unlinked OAuth identity', async () => {
    process.env.APP_SESSION_SECRET = 'site-session-test-secret';
    const userId = '00000000-0000-4000-8000-000000000001';
    const adminClient = createSiteIdentityMutationAdminClient({
      profileRow: {
        id: userId,
        username: 'site_user',
        email: 'user@example.com',
        role: 'user',
      },
      identityRows: [
        {
          id: 'identity-1',
          user_id: userId,
          provider: 'github',
          provider_subject_hash: 'subject-hash',
          display_name: 'Octo User',
          email_verified: false,
          disabled_at: '2026-06-01T00:00:00.000Z',
        },
      ],
      authUserById: {
        [userId]: {
          id: userId,
          email: 'user@example.com',
          email_confirmed_at: '2026-06-01T00:00:00.000Z',
          user_metadata: {
            username: 'site_user',
          },
        },
      },
    });

    const result = await createOrLinkOAuthUserAndSession(adminClient, {
      profile: {
        provider: 'github',
        subject: '123',
        username: 'octo-user',
        displayName: 'Octo User',
        email: 'github-user@example.com',
        emailVerified: true,
      },
      subjectHash: 'subject-hash',
      profileHash: 'profile-hash-next',
      req: createRequest(),
      res: createResponseRecorder(),
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('oauth_identity_unlinked');
    expect(adminClient.__mocks.identities[0].disabled_at).toBe('2026-06-01T00:00:00.000Z');
    expect(adminClient.__mocks.upserts).toHaveLength(0);
    expect(adminClient.__mocks.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event_type: 'oauth_callback',
        outcome: 'identity_unlinked',
      }),
    ]));
  });

  it('rejects linking an OAuth identity that belongs to another user', async () => {
    process.env.APP_SESSION_SECRET = 'site-session-test-secret';
    const adminClient = createSiteIdentityMutationAdminClient({
      sessionRow: {
        id: 'session-id',
        user_id: '00000000-0000-4000-8000-000000000001',
        absolute_expires_at: new Date(Date.now() + 3600000).toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
      profileRow: {
        id: '00000000-0000-4000-8000-000000000001',
        username: 'site_user',
        email: 'user@example.com',
      },
      identityRows: [
        {
          id: 'identity-other',
          user_id: '00000000-0000-4000-8000-000000000002',
          provider: 'github',
          provider_subject_hash: 'subject-hash',
          display_name: 'Other',
          disabled_at: null,
        },
      ],
    });

    const result = await linkOAuthIdentityToSiteSession(adminClient, {
      profile: {
        provider: 'github',
        subject: '123',
        username: 'octo-user',
      },
      subjectHash: 'subject-hash',
      profileHash: 'profile-hash',
      req: {
        ...createRequest(),
        headers: {
          ...createRequest().headers,
          cookie: '__Host-eg_session=session-token',
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('oauth_identity_already_linked');
    expect(adminClient.__mocks.upserts).toHaveLength(0);
  });

  it('prevents unlinking the final usable sign-in method', async () => {
    process.env.APP_SESSION_SECRET = 'site-session-test-secret';
    const userId = '00000000-0000-4000-8000-000000000001';
    const adminClient = createSiteIdentityMutationAdminClient({
      sessionRow: {
        id: 'session-id',
        user_id: userId,
        absolute_expires_at: new Date(Date.now() + 3600000).toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
      profileRow: {
        id: userId,
        username: 'site_user',
        email: null,
      },
      identityRows: [
        {
          id: 'identity-1',
          user_id: userId,
          provider: 'github',
          provider_subject_hash: 'subject-hash',
          display_name: 'Octo User',
          disabled_at: null,
        },
      ],
    });

    const result = await unlinkSiteAuthIdentity(adminClient, {
      identityId: 'identity-1',
      req: {
        ...createRequest(),
        headers: {
          ...createRequest().headers,
          cookie: '__Host-eg_session=session-token',
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('oauth_last_login_method');
    expect(adminClient.__mocks.identities[0].disabled_at).toBeNull();
  });

  it('unlinks a site OAuth identity when a usable email remains', async () => {
    process.env.APP_SESSION_SECRET = 'site-session-test-secret';
    const userId = '00000000-0000-4000-8000-000000000001';
    const adminClient = createSiteIdentityMutationAdminClient({
      sessionRow: {
        id: 'session-id',
        user_id: userId,
        absolute_expires_at: new Date(Date.now() + 3600000).toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
      profileRow: {
        id: userId,
        username: 'site_user',
        email: 'user@example.com',
      },
      identityRows: [
        {
          id: 'identity-1',
          user_id: userId,
          provider: 'github',
          provider_subject_hash: 'subject-hash',
          display_name: 'Octo User',
          disabled_at: null,
        },
      ],
      authUserById: {
        [userId]: {
          id: userId,
          email: 'user@example.com',
          email_confirmed_at: '2026-06-01T00:00:00.000Z',
          user_metadata: {
            site_password_set: true,
          },
        },
      },
    });

    const result = await unlinkSiteAuthIdentity(adminClient, {
      identityId: 'identity-1',
      req: {
        ...createRequest(),
        headers: {
          ...createRequest().headers,
          cookie: '__Host-eg_session=session-token',
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.identity.disabled_at).toBeTruthy();
    expect(adminClient.__mocks.identities[0].disabled_at).toBeTruthy();
  });
});
