// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  consumeOAuthTransaction,
  createOAuthState,
  createOAuthTransactionMaterial,
  getOAuthTransactionCookieName,
  persistOAuthTransaction,
  readOAuthTransactionCookie,
  serializeOAuthTransactionCookie,
  verifyOAuthState,
} from '../_lib/oauthState.js';

class OAuthTransactionQuery {
  constructor(rows) {
    this.rows = rows;
    this.operation = 'select';
    this.payload = null;
    this.filters = [];
  }

  insert(payload) {
    this.operation = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload) {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  select() {
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

  lte(column, value) {
    this.filters.push({ op: 'lte', column, value });
    return this;
  }

  then(resolve) {
    resolve(this.execute());
  }

  single() {
    return Promise.resolve(this.execute());
  }

  maybeSingle() {
    return Promise.resolve(this.execute());
  }

  execute() {
    if (this.operation === 'insert') {
      const row = { ...this.payload };
      this.rows.set(row.id, row);
      return { data: { ...row }, error: null };
    }

    if (this.operation === 'update' || this.operation === 'delete') {
      const row = [...this.rows.values()].find((candidate) => this.filters.every((filter) => {
        if (filter.op === 'eq') return candidate[filter.column] === filter.value;
        if (filter.op === 'is') return candidate[filter.column] === filter.value;
        if (filter.op === 'gt') return candidate[filter.column] > filter.value;
        if (filter.op === 'lte') return candidate[filter.column] <= filter.value;
        return false;
      }));
      if (!row) {
        return { data: null, error: null };
      }
      if (this.operation === 'delete') {
        this.rows.delete(row.id);
        return { data: { ...row }, error: null };
      }
      Object.assign(row, this.payload);
      return { data: { ...row }, error: null };
    }

    return { data: null, error: null };
  }
}

function createAdminClient() {
  const rows = new Map();
  return {
    rows,
    from(table) {
      if (table !== 'app_oauth_transactions') {
        throw new Error(`Unexpected table: ${table}`);
      }
      return new OAuthTransactionQuery(rows);
    },
  };
}

describe('OAuth transaction state', () => {
  it('creates signed state, PKCE material, and a transaction-scoped HttpOnly cookie', () => {
    const secret = 'test-oauth-state-secret';
    const material = createOAuthTransactionMaterial({ secret });
    const state = createOAuthState({
      provider: 'github',
      intent: 'login',
      returnTo: '/settings',
      transactionId: material.transactionId,
    }, { secret });
    const stateResult = verifyOAuthState(state, {
      expectedProvider: 'github',
      secret,
    });

    expect(stateResult.ok).toBe(true);
    expect(stateResult.payload.transactionId).toBe(material.transactionId);
    expect(material.pkceCodeVerifier).toMatch(/^[A-Za-z0-9_-]{64}$/u);
    expect(material.pkceCodeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(material.pkceCodeChallenge).not.toBe(material.pkceCodeVerifier);

    const cookie = serializeOAuthTransactionCookie(
      material.transactionId,
      material.browserBindingToken,
      { secure: true }
    );
    const cookieName = getOAuthTransactionCookieName(material.transactionId, { secure: true });
    expect(cookie).toContain(`${cookieName}=`);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(readOAuthTransactionCookie({
      headers: { cookie },
    }, material.transactionId, { secure: true })).toBe(material.browserBindingToken);
  });

  it('persists and atomically consumes a browser-bound transaction once', async () => {
    const secret = 'test-oauth-state-secret';
    const adminClient = createAdminClient();
    const material = createOAuthTransactionMaterial({ secret });
    const created = await persistOAuthTransaction(adminClient, {
      transactionId: material.transactionId,
      provider: 'github',
      intent: 'login',
      returnTo: '/settings',
      browserBindingHash: material.browserBindingHash,
      pkceCodeVerifier: material.pkceCodeVerifier,
      now: Date.parse('2026-07-25T00:00:00.000Z'),
    });

    expect(created.ok).toBe(true);
    const firstConsume = await consumeOAuthTransaction(adminClient, {
      transactionId: material.transactionId,
      provider: 'github',
      browserBindingHash: material.browserBindingHash,
      now: Date.parse('2026-07-25T00:01:00.000Z'),
    });
    const replay = await consumeOAuthTransaction(adminClient, {
      transactionId: material.transactionId,
      provider: 'github',
      browserBindingHash: material.browserBindingHash,
      now: Date.parse('2026-07-25T00:02:00.000Z'),
    });

    expect(firstConsume.ok).toBe(true);
    expect(firstConsume.transaction.pkce_code_verifier).toBe(material.pkceCodeVerifier);
    expect(adminClient.rows.has(material.transactionId)).toBe(false);
    expect(replay).toEqual({
      ok: false,
      code: 'oauth_transaction_invalid_or_consumed',
    });
  });

  it('removes expired abandoned transactions before creating a new one', async () => {
    const secret = 'test-oauth-state-secret';
    const adminClient = createAdminClient();
    adminClient.rows.set('expired-transaction', {
      id: 'expired-transaction',
      expires_at: '2026-07-25T00:00:00.000Z',
    });
    const material = createOAuthTransactionMaterial({ secret });

    const created = await persistOAuthTransaction(adminClient, {
      transactionId: material.transactionId,
      provider: 'github',
      intent: 'login',
      returnTo: '/',
      browserBindingHash: material.browserBindingHash,
      pkceCodeVerifier: material.pkceCodeVerifier,
      now: Date.parse('2026-07-25T00:01:00.000Z'),
    });

    expect(created.ok).toBe(true);
    expect(adminClient.rows.has('expired-transaction')).toBe(false);
    expect(adminClient.rows.has(material.transactionId)).toBe(true);
  });

  it('does not consume a transaction with a different browser binding', async () => {
    const secret = 'test-oauth-state-secret';
    const adminClient = createAdminClient();
    const material = createOAuthTransactionMaterial({ secret });
    await persistOAuthTransaction(adminClient, {
      transactionId: material.transactionId,
      provider: 'github',
      intent: 'login',
      returnTo: '/',
      browserBindingHash: material.browserBindingHash,
      pkceCodeVerifier: material.pkceCodeVerifier,
      now: Date.parse('2026-07-25T00:00:00.000Z'),
    });

    const wrongBrowser = await consumeOAuthTransaction(adminClient, {
      transactionId: material.transactionId,
      provider: 'github',
      browserBindingHash: 'different-browser-binding-hash',
      now: Date.parse('2026-07-25T00:01:00.000Z'),
    });
    const originalBrowser = await consumeOAuthTransaction(adminClient, {
      transactionId: material.transactionId,
      provider: 'github',
      browserBindingHash: material.browserBindingHash,
      now: Date.parse('2026-07-25T00:02:00.000Z'),
    });

    expect(wrongBrowser.ok).toBe(false);
    expect(originalBrowser.ok).toBe(true);
  });

  it('requires both the initiating session and user for link intent', async () => {
    const secret = 'test-oauth-state-secret';
    const material = createOAuthTransactionMaterial({ secret });
    const result = await persistOAuthTransaction(createAdminClient(), {
      transactionId: material.transactionId,
      provider: 'github',
      intent: 'link',
      returnTo: '/settings',
      browserBindingHash: material.browserBindingHash,
      pkceCodeVerifier: material.pkceCodeVerifier,
    });

    expect(result).toEqual({
      ok: false,
      code: 'oauth_transaction_invalid',
    });
  });
});
