import { describe, expect, it } from 'vitest';
import {
  sanitizeCharacterCatalogMedia,
  sanitizeGlobalSummaryMedia,
} from '../statsService.js';

describe('stats character catalog media contract', () => {
  it('cleans direct and persisted catalog avatar URLs', () => {
    const result = sanitizeCharacterCatalogMedia({
      summary: { totalCharacters: 2 },
      rows: [
        { id: 'safe', avatarUrl: '/avatars/characters/safe.webp' },
        { id: 'private', avatar_url: 'https://127.0.0.1/private.png' },
      ],
    });

    expect(result.rows).toEqual([
      { id: 'safe', avatarUrl: '/avatars/characters/safe.webp' },
      { id: 'private', avatarUrl: null },
    ]);
    expect(result.rows[1]).not.toHaveProperty('avatar_url');
  });

  it('cleans nested catalogs from old global summary snapshots', () => {
    const result = sanitizeGlobalSummaryMedia({
      totalPulls: 1,
      characterCatalog: {
        rows: [{ id: 'private', avatar_url: 'https://127.0.0.1/private.png' }],
      },
    });

    expect(result).toEqual({
      totalPulls: 1,
      characterCatalog: {
        rows: [{ id: 'private', avatarUrl: null }],
      },
    });
  });
});
