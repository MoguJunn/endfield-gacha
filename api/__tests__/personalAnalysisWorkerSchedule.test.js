// @vitest-environment node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();

describe('personal analysis worker production schedule', () => {
  it('keeps the high-frequency worker out of Vercel Hobby cron', async () => {
    const config = JSON.parse(await readFile(
      path.join(projectRoot, 'vercel.json'),
      'utf8'
    ));

    expect(config.crons).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/api/ops-automation' }),
      expect.objectContaining({ path: '/api/mail-outbox-worker' }),
    ]));
    expect(config.crons).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/api/personal-analysis-worker' }),
    ]));
  });

  it('schedules an authenticated and validated GitHub Actions worker call', async () => {
    const [workflow, runner] = await Promise.all([
      readFile(
        path.join(projectRoot, '.github', 'workflows', 'personal-analysis-worker.yml'),
        'utf8'
      ),
      readFile(
        path.join(projectRoot, '.github', 'scripts', 'run-personal-analysis-worker.mjs'),
        'utf8'
      ),
    ]);

    expect(workflow).toContain("cron: '*/5 * * * *'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('secrets.PERSONAL_ANALYSIS_WORKER_SECRET');
    expect(workflow).toContain('/api/personal-analysis-worker');
    expect(workflow).not.toContain('ef-gacha.mogujun.icu');
    expect(workflow).toContain('immutable Vercel deployment URL');
    expect(workflow).toContain('run-personal-analysis-worker.mjs');
    expect(runner).toContain('Authorization: `Bearer ${workerSecret}`');
    expect(runner).toContain('result?.skipped === true');
    expect(runner).toContain('payload?.partial === true');
    expect(runner).toContain('attempt <= 3');
    expect(runner).toContain('batchNumber <= maxBatches');
    expect(runner).toContain("headers['x-vercel-protection-bypass']");
  });
});
