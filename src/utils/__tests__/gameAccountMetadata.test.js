import { describe, expect, it } from 'vitest';

import {
  buildGameAccountKey,
  buildGameAccountServerTag,
  localizeGameAccountServerTag,
  normalizeGameAccountMetadata,
  normalizeGameAccountRegion,
  normalizeGameAccountServerId,
} from '../gameAccountMetadata.js';

describe('gameAccountMetadata', () => {
  it('does not collapse generic international imports to Asia server', () => {
    expect(normalizeGameAccountServerId({ source: 'intl' })).toBeNull();
    expect(normalizeGameAccountServerId({ region: 'international' })).toBeNull();
    expect(normalizeGameAccountRegion({ source: 'intl' })).toBe('intl');
    expect(buildGameAccountKey({ gameUid: '20000001', source: 'intl' })).toBe('20000001::region:intl');
    expect(localizeGameAccountServerTag('国际服', 'en-US')).toBe('Intl');
  });

  it('maps global server signals to international EU/NA', () => {
    expect(normalizeGameAccountServerId({ source: 'intl', region: 'global' })).toBe('3');
    expect(buildGameAccountServerTag({ gameUid: '20000001', source: 'intl', region: 'global' })).toBe('国际服·欧/美服');
    expect(localizeGameAccountServerTag('国际服·欧/美服', 'zh-CN')).toBe('国际服·欧/美服');
  });

  it('keeps explicit international server labels distinct', () => {
    expect(normalizeGameAccountServerId({ source: 'intl', serverTag: '国际服·亚服' })).toBe('2');
    expect(normalizeGameAccountServerId({ source: 'intl', serverTag: '国际服·欧/美服' })).toBe('3');
    expect(buildGameAccountKey({ gameUid: '20000001', serverTag: '国际服·欧/美服' })).toBe('20000001::server:3');
  });

  it('keeps Bilibili self-service labels separate from official CN', () => {
    expect(normalizeGameAccountServerId({ serverId: 'bilibili' })).toBe('bilibili');
    expect(normalizeGameAccountServerId({ serverTag: 'B服' })).toBe('bilibili');
    expect(normalizeGameAccountServerId({ serverId: '1', channelMasterId: '2' })).toBe('bilibili');
    expect(normalizeGameAccountRegion({ serverId: 'bilibili' })).toBe('cn');
    expect(buildGameAccountKey({ gameUid: '10000001', serverId: 'bilibili' })).toBe('10000001::channel:2');
    expect(buildGameAccountKey({ gameUid: '10000001', serverId: '1', channelMasterId: '2' })).toBe('10000001::channel:2');
    expect(buildGameAccountKey({ gameUid: '10000001', serverId: '3', channelMasterId: '2' })).toBe('10000001::server:3');
    expect(buildGameAccountServerTag({ gameUid: '10000001', serverId: 'bilibili' })).toBe('B服');
    expect(buildGameAccountServerTag({ gameUid: '10000001', serverId: '1', channelMasterId: '2' })).toBe('B服');
    expect(buildGameAccountServerTag({ gameUid: '10000001', serverId: '3', channelMasterId: '2' })).toBe('国际服·欧/美服');
    expect(buildGameAccountServerTag({ gameUid: '10000001', serverId: '1', channelMasterId: '1' })).toBe('官服');
  });

  it('shows explicit official servers while leaving legacy inferred servers unconfirmed', () => {
    expect(buildGameAccountServerTag({ gameUid: '10000001', serverId: '1', serverScope: '1' })).toBe('官服');
    expect(buildGameAccountServerTag({ gameUid: '10000001', serverId: '1', serverScope: 'legacy' })).toBeNull();
    expect(localizeGameAccountServerTag('区服待确认', 'en-US')).toBe('Server to confirm');
    expect(normalizeGameAccountServerId({ gameUid: '10000001', serverScope: 'legacy', region: 'cn' })).toBeNull();
    expect(normalizeGameAccountMetadata({ gameUid: '10000001', serverScope: 'legacy', region: 'cn' })).toMatchObject({
      accountKey: '10000001::region:cn',
      serverId: null,
      serverScope: 'legacy',
    });
  });

  it('keeps chinese server tags unchanged under zh locales', () => {
    expect(localizeGameAccountServerTag('国际服·亚服', 'zh-CN')).toBe('国际服·亚服');
  });

  it('localizes common server tags into compact english labels', () => {
    expect(localizeGameAccountServerTag('官服', 'en-US')).toBe('Official');
    expect(localizeGameAccountServerTag('B服', 'en-US')).toBe('Bilibili');
    expect(localizeGameAccountServerTag('国际服·亚服', 'en-US')).toBe('Intl Asia');
    expect(localizeGameAccountServerTag('国际服·欧/美服', 'en-US')).toBe('Intl EU/NA');
  });

  it('passes through unknown tags', () => {
    expect(localizeGameAccountServerTag('Test Region', 'en-US')).toBe('Test Region');
  });
});
