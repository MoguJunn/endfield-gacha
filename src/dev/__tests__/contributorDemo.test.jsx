// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ContributorDemoAdminPanel from '../../components/admin/ContributorDemoAdminPanel.jsx';
import AdminPanel from '../../components/AdminPanel.jsx';
import { useAuthStore, usePersonalDataStore, usePoolStore } from '../../stores/index.js';
import { executeSupabaseRead, fetchWithTimeout } from '../../services/supabaseRequest.js';
import {
  CONTRIBUTOR_DEMO_CREDENTIALS,
  createContributorDemoReadonlyError,
  isContributorDemoCredentials,
  isContributorDemoModeEnabled,
  isContributorDemoSessionActive,
  markContributorDemoSessionActive,
} from '../contributorDemoMode.js';
import {
  CONTRIBUTOR_DEMO_SANDBOX_STORAGE_KEY,
  getContributorDemoSandboxSnapshot,
  initializeContributorDemoSandbox,
  useContributorDemoSandboxStore,
} from '../contributorDemoSandboxStore.js';
import {
  getContributorDemoRuntimeAnalysis,
  getContributorDemoRuntimeHistory,
  getContributorDemoRuntimeHistoryPage,
} from '../contributorDemoRuntimeData.js';
import { activateContributorDemoSession, reapplyContributorDemoSandboxSession } from '../contributorDemoSession.js';
import { queuedFetch } from '../../utils/requestQueue.js';
import { getEnabledOAuthProviders, startOAuthLogin } from '../../services/authOAuthService.js';
import { linkLoginIdentity, loadAuthIdentities, unlinkLoginIdentity } from '../../services/authIdentityService.js';
import { triggerManualSync } from '../../services/admin/opsAutomationService.js';
import { getAuthFetchHeaders, getSupabaseAccessToken, getValidatedSupabaseSession } from '../../services/authFetchService.js';

const LIVE_POOLS = [
  { id: 'standard', name: '基础寻访', type: 'standard', locked: true, user_id: 'private-user-uuid', creator_role: 'super_admin' },
  {
    id: 'joint_manual_extra_reconstruction_yvonne_p1',
    name: '绚丽异彩',
    type: 'extra',
    extra_subtype: 'reconstruction',
    extra_rule_profile: 'reconstruction_character_v1',
    extra_series_key: 'reconstruction-xuesong-youmeng',
    extra_series_phase: 1,
    up_character: '伊冯',
    featured_characters: ['伊冯'],
    locked: true,
  },
];

const LIVE_CHARACTERS = [
  { id: 'chr_0017_yvonne', name: '伊冯', rarity: 6, type: 'character', is_limited: true, aliases: [], pool_config: { pools: ['limited'] } },
  { id: 'chr_0004_pelica', name: '佩丽卡', rarity: 5, type: 'character', is_limited: false, aliases: [], pool_config: { pools: ['standard', 'limited'] } },
  { id: 'chr_0020_meurs', name: '卡契尔', rarity: 4, type: 'character', is_limited: false, aliases: [], pool_config: { pools: ['standard', 'limited'] } },
  { id: 'wpn_pistol_0010', name: '艺术暴君', rarity: 6, type: 'weapon', is_limited: true, aliases: [], pool_config: { pools: ['weapon'] } },
];

function jsonResponse(data) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data }),
  });
}

function createPublicCatalogFetchMock() {
  return vi.fn((input) => {
    const url = String(input);
    if (url.includes('type=pool_catalog')) return jsonResponse({ pools: LIVE_POOLS });
    if (url.includes('type=characters')) return jsonResponse({ characters: LIVE_CHARACTERS });
    if (url.includes('/api/bootstrap')) return jsonResponse({ siteConfig: { site_version: 'v-live', home_version_timeline: '{"versions":[]}', mail_runtime_config: '{"secret":"must-not-cache"}' }, pools: LIVE_POOLS });
    if (url.includes('/api/auth/session/logout')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
    if (url.includes('/api/pool-rosters')) {
      return jsonResponse({
        poolRosters: {
          standard: LIVE_CHARACTERS.filter((item) => item.type === 'character' && !item.is_limited).map((item) => ({ pool_id: 'standard', character_id: item.id, is_up: false, characters: item })),
          joint_manual_extra_reconstruction_yvonne_p1: LIVE_CHARACTERS.filter((item) => item.type === 'character').map((item) => ({ pool_id: 'joint_manual_extra_reconstruction_yvonne_p1', character_id: item.id, is_up: item.id === 'chr_0017_yvonne', characters: item })),
        },
      });
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
}

describe('contributor content sandbox', () => {
  beforeEach(async () => {
    globalThis.__CONTRIBUTOR_DEMO_TEST_MODE__ = true;
    vi.stubGlobal('fetch', createPublicCatalogFetchMock());
    window.localStorage.removeItem(CONTRIBUTOR_DEMO_SANDBOX_STORAGE_KEY);
    window.sessionStorage.clear();
    useContributorDemoSandboxStore.setState({ initialized: false, initializing: false, revision: 0 });
    await initializeContributorDemoSandbox({ resetContent: true });
  });

  afterEach(() => {
    useAuthStore.getState().logout();
    usePersonalDataStore.getState().setPublicPools([]);
    usePoolStore.getState().setPools([]);
    vi.unstubAllGlobals();
    delete globalThis.__CONTRIBUTOR_DEMO_TEST_MODE__;
    window.localStorage.removeItem(CONTRIBUTOR_DEMO_SANDBOX_STORAGE_KEY);
    window.sessionStorage.clear();
  });

  it('is development-only and uses a synthetic local account', () => {
    expect(isContributorDemoModeEnabled()).toBe(true);
    expect(isContributorDemoCredentials(CONTRIBUTOR_DEMO_CREDENTIALS.email, CONTRIBUTOR_DEMO_CREDENTIALS.password)).toBe(true);
    expect(isContributorDemoCredentials('other@example.com', 'wrong')).toBe(false);
    expect(markContributorDemoSessionActive(true)).toBe(true);
    expect(isContributorDemoSessionActive()).toBe(true);
    globalThis.__CONTRIBUTOR_DEMO_TEST_MODE__ = false;
    expect(isContributorDemoModeEnabled()).toBe(false);
    expect(isContributorDemoSessionActive()).toBe(false);
  });

  it('loads real catalog-shaped data from the public production adapter', () => {
    const snapshot = getContributorDemoSandboxSnapshot();
    expect(snapshot.catalogSource).toBe('production-public-api');
    expect(snapshot.pools.map((pool) => pool.name)).toEqual(['基础寻访', '绚丽异彩']);
    expect(snapshot.characters.map((item) => item.name)).toEqual(expect.arrayContaining(['伊冯', '佩丽卡', '卡契尔', '艺术暴君']));
    expect(snapshot.poolCharacters.joint_manual_extra_reconstruction_yvonne_p1.map((item) => item.characters.rarity)).toEqual(expect.arrayContaining([4, 5, 6]));
    expect(snapshot.pools[0]).not.toHaveProperty('user_id');
    expect(snapshot.pools[0]).not.toHaveProperty('creator_role');
    expect(snapshot.siteConfig).not.toHaveProperty('mail_runtime_config');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('https://ef-gacha.mogujun.icu/api/stats?type=pool_catalog'), expect.objectContaining({ method: 'GET', credentials: 'omit' }));
  });

  it('persists editable announcements, pools, entities, rosters, and site config locally', () => {
    const store = useContributorDemoSandboxStore.getState();
    store.saveAnnouncement({ title: '可编辑公告', content: '本地内容', announcement_type: 'update', severity: 'info', is_active: true, priority: 30 });
    const entity = store.saveCharacter({ id: 'sandbox-char', name: '本地角色', rarity: 5, type: 'character', aliases: [], is_limited: false, pool_config: { pools: ['standard'] } });
    store.savePool({ name: '本地测试池', type: 'limited', up_character: null, locked: false }, null, [{ character_id: entity.id, is_up: false }]);
    store.upsertSiteConfig('sandbox_banner_text', '本地标题', { label: '沙盒标题', category: 'content' });

    const snapshot = getContributorDemoSandboxSnapshot();
    expect(snapshot.announcements.some((item) => item.title === '可编辑公告')).toBe(true);
    expect(snapshot.pools.some((item) => item.name === '本地测试池')).toBe(true);
    expect(snapshot.characters.some((item) => item.name === '本地角色')).toBe(true);
    expect(snapshot.siteConfig.sandbox_banner_text).toBe('本地标题');
    expect(JSON.parse(window.localStorage.getItem(CONTRIBUTOR_DEMO_SANDBOX_STORAGE_KEY)).announcements.some((item) => item.title === '可编辑公告')).toBe(true);
  });

  it('builds ready personal analysis and stable history pages from the active real catalog', () => {
    const history = getContributorDemoRuntimeHistory();
    expect(history).toHaveLength(168);
    expect(history.some((item) => item.character_name === '伊冯')).toBe(true);
    const analysis = getContributorDemoRuntimeAnalysis({ viewKey: '__group_all', locale: 'zh-CN' });
    expect(analysis).toMatchObject({
      availability: 'ready',
      source: 'contributor-local-sandbox',
      meta: { ownerId: 'demo:contributor-admin', readOnly: true, catalogSource: 'production-public-api' },
    });
    const first = getContributorDemoRuntimeHistoryPage({ limit: 20 });
    const second = getContributorDemoRuntimeHistoryPage({ limit: 20, cursor: first.page.nextCursor });
    expect(first.page).toMatchObject({ total: 168, hasMore: true, nextCursor: 'sandbox:20' });
    expect(second.records[0].id).not.toBe(first.records[0].id);
  });

  it('activates a ready sandbox admin while denying real edit authority', async () => {
    const user = await activateContributorDemoSession();
    expect(user).toMatchObject({ id: 'demo:contributor-admin', email: 'demo-admin@local.invalid' });
    expect(useAuthStore.getState()).toMatchObject({ userRole: 'super_admin', authResolved: true });
    expect(useAuthStore.getState().canEdit()).toBe(false);
    expect(usePersonalDataStore.getState()).toMatchObject({ ownerId: 'demo:contributor-admin', phase: 'ready', hasSnapshot: true });
    expect(usePoolStore.getState().pools).toHaveLength(LIVE_POOLS.length);
    expect(usePoolStore.getState().currentGameUid).toBe('demo-cn-001::server:1');
  });

  it('fails closed when the existing site session cannot be cleared', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    const user = await activateContributorDemoSession();
    expect(user).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(isContributorDemoSessionActive()).toBe(false);
  });

  it('blocks generic private fetch and Supabase builders before execution', async () => {
    let readBuilderCalled = false;
    await expect(fetchWithTimeout('/api/admin', { method: 'POST' })).rejects.toMatchObject({ code: 'contributor_demo_readonly' });
    await expect(executeSupabaseRead(() => {
      readBuilderCalled = true;
      return Promise.resolve({ data: [] });
    })).rejects.toMatchObject({ code: 'contributor_demo_readonly' });
    expect(readBuilderCalled).toBe(false);
    expect(createContributorDemoReadonlyError('save')).toMatchObject({ code: 'contributor_demo_readonly', operation: 'save' });
  });

  it('blocks native auth, import queue, identity, and automation side effects', async () => {
    const assign = vi.fn();
    fetch.mockClear();
    expect(getEnabledOAuthProviders({ VITE_AUTH_OAUTH_GITHUB_ENABLED: 'true' })).toEqual([]);
    await expect(startOAuthLogin('github', { assign })).rejects.toMatchObject({ code: 'contributor_demo_readonly' });
    await expect(queuedFetch('/api/hg-proxy?action=grant', { method: 'POST' })).rejects.toMatchObject({ code: 'contributor_demo_readonly' });
    await expect(loadAuthIdentities()).rejects.toMatchObject({ code: 'contributor_demo_readonly' });
    await expect(linkLoginIdentity('github', { assign })).rejects.toMatchObject({ code: 'contributor_demo_readonly' });
    await expect(unlinkLoginIdentity({ id: 'identity-1', provider: 'github' })).rejects.toMatchObject({ code: 'contributor_demo_readonly' });
    await expect(triggerManualSync()).rejects.toMatchObject({ code: 'contributor_demo_readonly' });
    expect(await getValidatedSupabaseSession()).toBeNull();
    expect(await getSupabaseAccessToken()).toBeNull();
    await expect(getAuthFetchHeaders({}, { requireToken: true })).rejects.toThrow('不提供真实认证凭据');
    expect(assign).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects private resource URLs and prototype keys from local content', () => {
    const store = useContributorDemoSandboxStore.getState();
    const entity = store.saveCharacter({
      id: 'sandbox-private-url',
      name: '私网头像测试',
      rarity: 5,
      type: 'character',
      avatar_url: 'https://127.0.0.1/private.png',
      pool_config: { pools: ['standard'] },
    });
    expect(entity.avatar_url).toBeNull();
    expect(store.upsertSiteConfig('__proto__', 'polluted', { category: 'general' })).toBe(false);
    expect(Object.hasOwn(getContributorDemoSandboxSnapshot().siteConfig, '__proto__')).toBe(false);
  });

  it('cannot overwrite store methods through persisted sandbox JSON', async () => {
    window.localStorage.setItem(CONTRIBUTOR_DEMO_SANDBOX_STORAGE_KEY, JSON.stringify({
      schemaVersion: 3,
      revision: 7,
      pools: [],
      characters: [],
      announcements: [{ id: 'safe-announcement', title: 'Safe' }],
      poolCharacters: {},
      siteConfigItems: [],
      saveAnnouncement: 'overwritten',
      replaceSandbox: null,
    }));
    useContributorDemoSandboxStore.setState({ initialized: false, initializing: false });

    await initializeContributorDemoSandbox();

    expect(typeof useContributorDemoSandboxStore.getState().saveAnnouncement).toBe('function');
    expect(typeof useContributorDemoSandboxStore.getState().replaceSandbox).toBe('function');
    expect(getContributorDemoSandboxSnapshot().announcements[0].title).toBe('Safe');
  });

  it('keeps synthetic admins in the sandbox even if the session marker is removed', async () => {
    const user = await activateContributorDemoSession();
    window.sessionStorage.clear();
    render(<AdminPanel user={user} userRole="super_admin" showToast={vi.fn()} />);
    expect(screen.getByTestId('contributor-demo-admin-panel')).toBeTruthy();
    expect(screen.queryByText('超级管理员控制台')).toBeNull();
  });

  it('tears down auth residue and cannot reapply after sign-out', async () => {
    await activateContributorDemoSession();
    window.localStorage.setItem('sb-project-auth-token', '{"access_token":"real-token"}');
    await useAuthStore.getState().signOut();
    expect(useAuthStore.getState().user).toBeNull();
    expect(isContributorDemoSessionActive()).toBe(false);
    expect(window.localStorage.getItem('sb-project-auth-token')).toBeNull();
    expect(await reapplyContributorDemoSandboxSession()).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('renders all admin modules and exposes real local CRUD panels', async () => {
    render(<ContributorDemoAdminPanel showToast={vi.fn()} />);
    expect(screen.getByTestId('contributor-demo-admin-panel')).toBeTruthy();
    expect(screen.getByText('已缓存 2 池 / 4 实体')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /公告管理/ }));
    expect(await screen.findByRole('button', { name: '新建公告' }, { timeout: 5000 })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /站点配置/ }));
    expect(await screen.findByRole('button', { name: '新增配置项' }, { timeout: 5000 })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /卡池与版本/ }));
    expect(await screen.findByRole('button', { name: /新增卡池/ }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText('绚丽异彩')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /运营自动化/ }));
    expect(await screen.findByText('官方公告同步')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '本地演练' })[0]);
    await waitFor(() => expect(screen.getByText('演练中…')).toBeTruthy());
  }, 15000);
});
