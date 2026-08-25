import { describe, expect, it } from 'vitest';
import {
  isReservedObjectKey,
  resolveTrustedCatalogApiBase,
  sanitizeExternalNavigationUrl,
  sanitizePublicResourceUrl,
} from '../publicResourceUrl.js';
import {
  isPublicSiteConfigKey,
  pickPublicSiteConfig,
} from '../../../shared/publicSiteConfig.js';
import {
  sanitizePublicCharacterRecord,
  sanitizePublicPoolRecord,
} from '../../../shared/publicCatalogDto.js';

describe('public resource URL policy', () => {
  it('allows approved local assets and safe HTTPS resources', () => {
    expect(sanitizePublicResourceUrl('/avatars/characters/example.webp')).toBe('/avatars/characters/example.webp');
    expect(sanitizePublicResourceUrl('https://cdn.example.com/image.png', {
      allowedAbsoluteHosts: ['cdn.example.com'],
    })).toBe('https://cdn.example.com/image.png');
    expect(sanitizeExternalNavigationUrl('https://github.com/example')).toBe('https://github.com/example');
  });

  it('rejects credentials, private hosts, unsafe protocols, and arbitrary local paths', () => {
    expect(sanitizePublicResourceUrl('https://127.0.0.1/image.png')).toBeNull();
    expect(sanitizePublicResourceUrl('https://localhost/image.png')).toBeNull();
    expect(sanitizePublicResourceUrl('http://cdn.example.com/image.png')).toBeNull();
    expect(sanitizePublicResourceUrl('https://user:pass@cdn.example.com/image.png')).toBeNull();
    expect(sanitizePublicResourceUrl('https://ef-gacha.mogujun.icu:8443/image.png')).toBeNull();
    expect(sanitizePublicResourceUrl('https://cdn.example.com/image.png')).toBeNull();
    expect(sanitizePublicResourceUrl('/api/private-action')).toBeNull();
    expect(sanitizePublicResourceUrl('/avatars/%2e%2e/api/private-action')).toBeNull();
    expect(sanitizePublicResourceUrl('/avatars/..\\api/private-action')).toBeNull();
    expect(sanitizeExternalNavigationUrl('javascript:alert(1)')).toBeNull();
  });

  it('keeps the catalog endpoint on an explicit HTTPS allowlist', () => {
    expect(resolveTrustedCatalogApiBase('https://ef-gacha.mogujun.icu/')).toBe('https://ef-gacha.mogujun.icu');
    expect(resolveTrustedCatalogApiBase('https://127.0.0.1')).toBe('https://ef-gacha.mogujun.icu');
    expect(resolveTrustedCatalogApiBase('https://evil.example')).toBe('https://ef-gacha.mogujun.icu');
    expect(resolveTrustedCatalogApiBase('https://user:pass@ef-gacha.mogujun.icu')).toBe('https://ef-gacha.mogujun.icu');
  });

  it('rejects object prototype keys', () => {
    expect(isReservedObjectKey('__proto__')).toBe(true);
    expect(isReservedObjectKey('constructor')).toBe(true);
    expect(isReservedObjectKey('safe_key')).toBe(false);
  });
});

describe('public catalog DTO contract', () => {
  it('drops ownership fields and unsafe media URLs from public records', () => {
    expect(sanitizePublicPoolRecord({
      id: 'pool-1',
      name: 'Pool',
      user_id: 'private-user',
      creator_role: 'super_admin',
      banner_url: 'https://127.0.0.1/private.png',
    })).toEqual({ id: 'pool-1', name: 'Pool', banner_url: null });

    expect(sanitizePublicCharacterRecord({
      id: 'char-1',
      name: 'Character',
      email: 'private@example.com',
      avatar_url: '/avatars/characters/char-1.webp',
    })).toEqual({
      id: 'char-1',
      name: 'Character',
      avatar_url: '/avatars/characters/char-1.webp',
    });
  });
});

describe('public site configuration contract', () => {
  it('keeps only explicitly public presentation keys', () => {
    const picked = pickPublicSiteConfig({
      site_version: 'v1',
      home_roadmap_items: '[]',
      pool_localizations: '{}',
      mail_runtime_config: '{"secret":"hidden"}',
      ops_automation_schedule_config: '{}',
    });

    expect(picked).toEqual({
      site_version: 'v1',
      home_roadmap_items: '[]',
      pool_localizations: '{}',
    });
    expect(isPublicSiteConfigKey('mail_runtime_config')).toBe(false);
    expect(isPublicSiteConfigKey('legal_registration_by_domain')).toBe(true);
  });
});
