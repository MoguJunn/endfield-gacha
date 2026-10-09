import { performance } from 'node:perf_hooks';
import { buildSimulatorInheritanceProjection } from '../src/features/simulator/inheritanceProjection.js';
import { packInheritanceProjection } from '../shared/simulator/historyCodec.js';
import { applyCommand, getResourceLedger } from '../shared/simulator/engine.js';
import { buildSimulatorDescriptors } from '../src/features/simulator/simulatorSessionView.js';

const pools = Array.from({ length: 40 }, (_, index) => ({
  id: `limited-${index}`,
  type: 'limited',
  up_character: `UP-${index}`,
  start_time: new Date(1700000000000 + index * 86400000).toISOString(),
}));
for (const size of [1000, 10000, 50000]) {
  const history = Array.from({ length: size }, (_, index) => ({
    id: `record-${index}`,
    user_id: 'synthetic-user',
    game_uid: 'synthetic-account',
    pool_id: pools[Math.min(39, Math.floor(index / (size / 40)))].id,
    rarity: index % 70 === 69 ? 6 : 4,
    character_name: index % 70 === 69 ? 'UP-0' : '四星',
    timestamp: 1700000000000 + index,
  }));
  const start = performance.now();
  const projection = buildSimulatorInheritanceProjection({ history, pools, currentUserId: 'synthetic-user' });
  const buildMs = performance.now() - start;
  const payloadBytes = Buffer.byteLength(JSON.stringify(packInheritanceProjection(projection)));
  const ledgerStart = performance.now();
  for (let index = 0; index < 100; index++) getResourceLedger(projection.session);
  const ledgerMs = (performance.now() - ledgerStart) / 100;
  const descriptors = buildSimulatorDescriptors(pools);
  descriptors['limited-39'].roster = { up: ['UP'], offBanner: ['OFF'], fiveStar: ['FIVE'], fourStar: ['FOUR'] };
  const session = {
    ...projection.session,
    resourceSettings: { ...projection.session.resourceSettings, infiniteResources: true },
  };
  const drawStart = performance.now();
  for (let index = 0; index < 100; index++)
    applyCommand(
      session,
      { poolId: 'limited-39', type: 'single' },
      {
        descriptors,
        random: () => 0.999,
        now: 1700000000000,
      }
    );
  console.log(
    JSON.stringify({
      records: size,
      pools: pools.length,
      buildMs,
      ledgerMs,
      drawMs: (performance.now() - drawStart) / 100,
      payloadBytes,
    })
  );
}
