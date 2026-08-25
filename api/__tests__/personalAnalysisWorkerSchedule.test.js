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
    const workflow = await readFile(
      path.join(projectRoot, '.github', 'workflows', 'personal-analysis-worker.yml'),
      'utf8'
    );

    expect(workflow).toContain("cron: '*/5 * * * *'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('secrets.PERSONAL_ANALYSIS_WORKER_SECRET');
    expect(workflow).toContain('/api/personal-analysis-worker');
    expect(workflow).toContain('Authorization: Bearer ${WORKER_SECRET}');
    expect(workflow).toContain('result?.skipped === true');
    expect(workflow).toContain('payload?.partial === true');
    expect(workflow).toContain('for attempt in 1 2 3');
  });
});
