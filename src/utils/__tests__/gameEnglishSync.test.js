// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { extractOfficialEnglishCandidates } from '../../../scripts/lib/officialEnglishCatalog.mjs';
import {
  buildBilingualEntityCatalog,
  buildEntityTranslationPlan,
  buildPoolTranslationPlan,
  buildVersionTranslationPlan,
  parseGameEnglishSyncArgs,
} from '../../../scripts/lib/gameEnglishSync.mjs';

describe('game English sync argument parsing', () => {
  it('defaults to an incremental write and supports a safe preview', () => {
    expect(parseGameEnglishSyncArgs([])).toMatchObject({
      type: 'all',
      mode: 'incremental',
      dryRun: false,
    });
    expect(parseGameEnglishSyncArgs(['--type', 'pool', '--full', '--dry-run'])).toMatchObject({
      type: 'pool',
      mode: 'full',
      dryRun: true,
    });
  });
});

describe('official English catalog extraction', () => {
  it('extracts future RE-Factor pools and their targets from a DEV Comm', () => {
    const candidates = extractOfficialEnglishCandidates({
      cid: '4481',
      title: 'Arknights: Endfield [Dreamscape of Wind and Snow] Version DEV Comm',
      displayTime: Date.parse('2026-08-22T00:00:00Z') / 1000,
      data: `
        <h3>[Resplendent Spectrum] RE-Factor Headhunting #1 Open</h3>
        <p>You will have a much higher chance of getting the 6★ operator [Yvonne].</p>
        <h3>[Tag Artist Issue] RE-Factor Issue #1 Open</h3>
        <p>You will have a much higher chance of getting the 6★ weapon [Artzy Tyrannical].</p>
      `,
    });

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'character', name: 'Resplendent Spectrum', targetNames: ['Yvonne'] }),
      expect.objectContaining({ kind: 'weapon', name: 'Tag Artist Issue', targetNames: ['Artzy Tyrannical'] }),
      expect.objectContaining({ kind: 'version', name: 'Dreamscape of Wind and Snow' }),
    ]));
  });
});

describe('entity localization planning', () => {
  const chinese = {
    character: new Map([['chr_0032_lizhiyan', { id: 'chr_0032_lizhiyan', name: '诀' }]]),
    weapon: new Map([['wpn_funnel_0016', { id: 'wpn_funnel_0016', name: '四二式·肃阵' }]]),
  };
  const english = {
    character: new Map([['chr_0032_lizhiyan', { id: 'chr_0032_lizhiyan', name: 'Arcane' }]]),
    weapon: new Map([['wpn_funnel_0016', { id: 'wpn_funnel_0016', name: 'Type 42: Solemn Phalanx' }]]),
  };

  it('pairs Chinese and English records by stable source ID', () => {
    const catalog = buildBilingualEntityCatalog(chinese, english);
    const plan = buildEntityTranslationPlan({
      records: [{
        id: 'chr_0032_lizhiyan',
        name: '诀',
        type: 'character',
        aliases: ['char_manual_char_ixd68v_oxpabe'],
      }],
      bilingualCatalog: catalog,
      existingConfig: {},
      mode: 'incremental',
      requestedTypes: ['character'],
    });

    expect(plan.changes).toHaveLength(1);
    expect(plan.nextConfig['chr_0032_lizhiyan']['en-US']).toBe('Arcane');
    expect(plan.nextConfig['诀']['en-US']).toBe('Arcane');
    expect(plan.nextConfig.char_manual_char_ixd68v_oxpabe['en-US']).toBe('Arcane');
  });

  it('preserves an existing manual English value incrementally and refreshes it in full mode', () => {
    const catalog = buildBilingualEntityCatalog(chinese, english);
    const record = { id: 'chr_0032_lizhiyan', name: '诀', type: 'character', aliases: [] };
    const existingConfig = {
      chr_0032_lizhiyan: { type: 'character', name: '诀', 'zh-CN': '诀', 'en-US': 'Manual Name' },
      诀: { type: 'character', name: '诀', 'zh-CN': '诀', 'en-US': 'Manual Name' },
    };

    expect(buildEntityTranslationPlan({
      records: [record],
      bilingualCatalog: catalog,
      existingConfig,
      mode: 'incremental',
      requestedTypes: ['character'],
    }).changes).toHaveLength(0);

    expect(buildEntityTranslationPlan({
      records: [record],
      bilingualCatalog: catalog,
      existingConfig,
      mode: 'full',
      requestedTypes: ['character'],
    }).nextConfig[record.id]['en-US']).toBe('Arcane');
  });
});

describe('pool and version matching', () => {
  it('uses target identity to disambiguate same-day weapon issues', () => {
    const candidates = [
      {
        kind: 'weapon',
        name: 'Smelting Fire Issue',
        targetNames: ['Forgeborn Scathe'],
        context: '6★ weapon [Forgeborn Scathe]',
        publishedAt: '2026-05-13T04:00:00Z',
        sourceUrl: 'https://example.test/1',
      },
      {
        kind: 'weapon',
        name: 'Swift Walker Issue',
        targetNames: ['Delivery Guaranteed'],
        context: '6★ weapon [Delivery Guaranteed]',
        publishedAt: '2026-05-13T04:00:00Z',
        sourceUrl: 'https://example.test/2',
      },
    ];
    const plan = buildPoolTranslationPlan({
      pools: [{
        pool_id: 'weponbox_1_2_3',
        name: '疾行申领',
        name_en: null,
        type: 'weapon',
        up_character: '使命必达',
        start_time: '2026-05-14T04:00:00Z',
      }],
      candidates,
      englishByChineseName: new Map([['使命必达', 'Delivery Guaranteed']]),
      mode: 'incremental',
    });

    expect(plan.changes).toEqual([
      expect.objectContaining({ id: 'weponbox_1_2_3', after: 'Swift Walker Issue', source: 'gryphline' }),
    ]);
  });

  it('matches a version by its release window and keeps the original timeline fields', () => {
    const plan = buildVersionTranslationPlan({
      timelineConfig: {
        versions: [{ id: 'version-5', name: '向渊行', starts_at: '2026-07-16T04:00:00Z', enabled: true }],
      },
      candidates: [{
        kind: 'version',
        name: 'Homecoming',
        publishedAt: '2026-07-16T01:00:00Z',
        sourceUrl: 'https://example.test/version',
      }],
      mode: 'incremental',
    });

    expect(plan.nextConfig.versions[0]).toMatchObject({
      id: 'version-5',
      enabled: true,
      name_en: 'Homecoming',
    });
  });
});
