// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  materializeAvatarCandidateChain,
  resolveExistingLocalAvatarCandidate,
} from '../../scripts/lib/localAvatarSync.mjs';

const temporaryRoots = [];

async function createTemporaryAvatarRoot() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'endfield-avatar-sync-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })));
});

describe('localAvatarSync', () => {
  it.each([
    {
      type: 'character',
      folder: 'characters',
      officialId: 'chr_0032_lizhiyan',
      manualId: 'char_manual_lizhiyan_demo',
      useAvatarUrl: true,
    },
    {
      type: 'weapon',
      folder: 'weapons',
      officialId: 'wpn_demo_official',
      manualId: 'weapon_manual_demo',
      useAvatarUrl: false,
    },
  ])(
    'copies a $type avatar from its previous manual ID',
    async ({ type, folder, officialId, manualId, useAvatarUrl }) => {
      const avatarRoot = await createTemporaryAvatarRoot();
      const sourcePath = path.join(avatarRoot, folder, `${manualId}.png`);
      await fs.promises.mkdir(path.dirname(sourcePath), { recursive: true });
      await fs.promises.writeFile(sourcePath, Buffer.from('manual-avatar'));

      const candidate = resolveExistingLocalAvatarCandidate(
        {
          id: officialId,
          name: '测试实体',
          type,
          aliases: [manualId],
          avatar_url: useAvatarUrl ? `/avatars/${folder}/${manualId}.png` : null,
        },
        { avatarRoot }
      );

      expect(candidate).toMatchObject({
        id: officialId,
        source: 'existing_local',
        sourcePath,
        localUrl: `/avatars/${folder}/${officialId}.png`,
      });

      const result = await materializeAvatarCandidateChain([candidate]);
      expect(result.item).toBe(candidate);
      await expect(fs.promises.readFile(candidate.outputPath, 'utf8')).resolves.toBe('manual-avatar');
    }
  );

  it('continues with the next source after a higher-priority URL fails', async () => {
    const candidates = [
      { id: 'chr_0032_lizhiyan', source: 'warfarin' },
      { id: 'chr_0032_lizhiyan', source: 'team_stardust' },
      { id: 'chr_0032_lizhiyan', source: 'existing_local' },
    ];
    const materialize = vi.fn(async (item) => {
      if (item.source === 'warfarin') {
        throw new Error('HTTP 404');
      }
    });

    const result = await materializeAvatarCandidateChain(candidates, { materialize });

    expect(materialize).toHaveBeenCalledTimes(2);
    expect(result.item).toBe(candidates[1]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].item).toBe(candidates[0]);
  });

  it('returns no selected item when every candidate fails', async () => {
    const candidates = [
      { id: 'wpn_demo', source: 'skland' },
      { id: 'wpn_demo', source: 'legacy_bucket' },
    ];

    const result = await materializeAvatarCandidateChain(candidates, {
      materialize: async (item) => {
        throw new Error(`${item.source} unavailable`);
      },
    });

    expect(result.item).toBeNull();
    expect(result.failures).toHaveLength(2);
  });
});
