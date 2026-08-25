import { beforeEach, describe, expect, it } from 'vitest';

import usePersonalDataStore, {
  createPersonalDataInitialState,
} from '../usePersonalDataStore.js';

function beginOwnerRequest(ownerId = 'user-1') {
  const owner = usePersonalDataStore.getState().switchOwner(ownerId);
  return usePersonalDataStore.getState().beginRequest({
    ownerId,
    ownerGeneration: owner.ownerGeneration,
  });
}

function createAnalysisSnapshot(availability, ownerId = 'user-1') {
  return {
    kind: 'analysis',
    ownerId,
    pools: [],
    analysis: {
      availability,
      schemaVersion: 1,
      meta: { ownerId },
    },
  };
}

describe('usePersonalDataStore.completeRequest', () => {
  beforeEach(() => {
    usePersonalDataStore.setState(createPersonalDataInitialState());
  });

  it('继续接受旧 pools/history 快照', () => {
    const token = beginOwnerRequest();

    expect(usePersonalDataStore.getState().completeRequest(token, {
      pools: [],
      history: [],
    })).toBe(true);
    expect(usePersonalDataStore.getState()).toMatchObject({
      phase: 'empty',
      hasSnapshot: true,
    });
  });

  it.each([
    ['building', 'building', false],
    ['empty', 'empty', true],
    ['ready', 'ready', true],
    ['stale', 'ready', true],
  ])('将 analysis %s 映射为 %s', (availability, phase, hasSnapshot) => {
    const token = beginOwnerRequest();

    expect(usePersonalDataStore.getState().completeRequest(
      token,
      createAnalysisSnapshot(availability)
    )).toBe(true);
    expect(usePersonalDataStore.getState()).toMatchObject({ phase, hasSnapshot });
  });

  it.each([
    ['非法 availability', createAnalysisSnapshot('unknown')],
    ['顶层 owner 不匹配', createAnalysisSnapshot('ready', 'user-2')],
    ['analysis owner 不匹配', {
      ...createAnalysisSnapshot('ready'),
      analysis: {
        ...createAnalysisSnapshot('ready').analysis,
        meta: { ownerId: 'user-2' },
      },
    }],
  ])('拒绝%s', (_name, snapshot) => {
    const token = beginOwnerRequest();

    expect(usePersonalDataStore.getState().completeRequest(token, snapshot)).toBe(false);
    expect(usePersonalDataStore.getState().hasSnapshot).toBe(false);
  });

  it('building 自动轮询开始时保持 building 而不是退回 loading', () => {
    const firstToken = beginOwnerRequest();
    expect(usePersonalDataStore.getState().completeRequest(
      firstToken,
      createAnalysisSnapshot('building')
    )).toBe(true);

    const current = usePersonalDataStore.getState();
    const pollToken = current.beginRequest({
      ownerId: current.ownerId,
      ownerGeneration: current.ownerGeneration,
      kind: 'building-poll',
    });

    expect(pollToken).toBeTruthy();
    expect(usePersonalDataStore.getState()).toMatchObject({
      phase: 'building',
      hasSnapshot: false,
    });
  });
});
