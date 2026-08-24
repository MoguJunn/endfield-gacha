// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { __internal } from '../_lib/gameAnnouncementDigest.js';

function createResponse(content, finishReason = 'stop') {
  return {
    ok: true,
    json: async () => ({
      choices: [{
        finish_reason: finishReason,
        message: { content },
      }],
    }),
  };
}

describe('game announcement digest LLM', () => {
  it('retries a truncated response with a larger output budget', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(createResponse('', 'length'))
      .mockResolvedValueOnce(createResponse(JSON.stringify({
        title: '密境行者挑战开启，梨诺闪耀活动登场',
        subtitle: '近期开放密境行者六方挑战与梨诺闪耀一日活动，展开可查看完整规则。',
      })));

    const digest = await __internal.summarizeDigestWithLlm([
      {
        title: '密境行者 - 六方挑战',
        summary: '密境行者六方挑战现已开放。',
        published_at: '2026-08-24T00:00:00.000Z',
        source_id: 'game-bulletin:1',
      },
    ], {
      fetchImpl,
      env: {
        ANNOUNCEMENT_LLM_API_KEY: 'test-key',
        ANNOUNCEMENT_LLM_MODEL: 'test-model',
        ANNOUNCEMENT_LLM_BASE_URL: 'https://llm.example.test/v1',
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const tokenBudgets = fetchImpl.mock.calls.map(([, options]) => (
      JSON.parse(options.body).max_tokens
    ));
    expect(tokenBudgets).toEqual([720, 8192]);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).response_format).toEqual({
      type: 'json_object',
    });
    expect(digest).toMatchObject({
      title: '密境行者挑战开启，梨诺闪耀活动登场',
      mode: 'llm',
    });
  });
});
