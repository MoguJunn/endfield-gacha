import { beforeEach, describe, expect, it } from 'vitest';
import { readLegacySimulatorSession } from '../simulatorLegacyMigration.js';
import { buildSimulatorDescriptors } from '../simulatorSessionView.js';
import { getPoolState, getResourceLedger } from '../../../../shared/simulator/engine.js';
import { convertSimulatorHistoryToImportFormat, exportSimulatorDataAsCSV } from '../../../utils/simulatorStorage.js';
import { classifyRecord } from '../../../../shared/simulator/records.js';

const scope = 'u:user|g:game%3A%3Aserver%3A1';
const descriptors = buildSimulatorDescriptors([
  { id: 'a', type: 'limited', start_time: '2026-01-01' },
  { id: 'b', type: 'limited', start_time: '2026-02-01' },
]);
describe('known simulator save migration', () => {
  beforeEach(() => localStorage.clear());
  it('preserves independent shared progress, info-book usage, history flags and original bytes', () => {
    const key = `gacha_simulator_state_sim_a__${scope}`;
    const data = JSON.stringify({
      version: '1.0',
      state: {
        totalPulls: 60,
        sixStarPity: 60,
        pullHistory: [
          { rarity: 4, characterName: '四星', timestamp: 1, isFreePull: true },
          { rarity: 5, characterName: '五星', timestamp: 2, isInfoBookPull: true },
        ],
      },
    });
    localStorage.setItem(key, data);
    localStorage.setItem(
      `gacha_simulator_shared_pity__${scope}`,
      JSON.stringify({ version: '1.0', pityState: { sixStarPity: 40, fiveStarPity: 3 } })
    );
    localStorage.setItem(
      `gacha_simulator_info_book__${scope}`,
      JSON.stringify({ version: '2.0', infoBooks: { sim_a: { targetPoolId: 'sim_b', used: true } } })
    );
    const result = readLegacySimulatorSession(scope, descriptors);
    expect(getPoolState(result.session, descriptors.b)).toMatchObject({
      sixStarPity: 40,
      fiveStarPity: 3,
      infoBookTenPullAvailable: false,
    });
    expect(result.histories.a.map((x) => x.kind)).toEqual(['free', 'info_book']);
    expect(getResourceLedger(result.session).jadeSpent).toBe(0);
    expect(localStorage.getItem(key)).toBe(data);
  });
  it('does not delete or relabel an unsupported save version', () => {
    const key = `gacha_simulator_state_sim_a__${scope}`;
    localStorage.setItem(key, '{"version":"99","state":{"sixStarPity":72}}');
    expect(() => readLegacySimulatorSession(scope, descriptors)).toThrow('simulator_legacy_version');
    expect(localStorage.getItem(key)).toContain('72');
  });
  it('assigns unscoped legacy data only to the guest scope', () => {
    localStorage.setItem(
      'gacha_simulator_state_sim_a',
      JSON.stringify({ version: '1.0', state: { totalPulls: 40, sixStarPity: 40 } })
    );
    expect(readLegacySimulatorSession(scope, descriptors).session.pools).toEqual({});
    expect(
      getPoolState(readLegacySimulatorSession('u:guest|g:all', descriptors).session, descriptors.a).totalPulls
    ).toBe(40);
  });
  it('retains free, info-book and gift semantics in JSON and escaped CSV exports', () => {
    const rows = [
      { rarity: 4, characterName: '逗号,引号"', timestamp: 1, kind: 'free', sequenceIndex: 1 },
      { rarity: 5, characterName: '五星', timestamp: 2, kind: 'info_book', sequenceIndex: 2 },
      { rarity: 6, characterName: '六星', timestamp: 3, kind: 'gift', sequenceIndex: 3 },
    ];
    const exported = convertSimulatorHistoryToImportFormat(rows, 'sim_a', 'limited');
    expect(exported.map(classifyRecord)).toEqual(['free', 'info_book', 'gift']);
    expect(exported.every((x) => x.poolId === 'a')).toBe(true);
    expect(exportSimulatorDataAsCSV(rows, 'sim_a', 'limited')).toContain('"逗号,引号"""');
  });
});
