#!/usr/bin/env node

/**
 * 一键同步数据库中的角色、武器、卡池与版本英文名。
 *
 * 默认增量补充并写入数据库；使用 --dry-run 可只查看差异，使用 --full
 * 可按当前可信来源刷新已有英文。完整参数见 --help。
 */

import {
  parseGameEnglishSyncArgs,
  printGameEnglishSyncHelp,
  runGameEnglishSync,
} from './lib/gameEnglishSync.mjs';

async function main() {
  const options = parseGameEnglishSyncArgs(process.argv.slice(2), {
    commandName: 'sync:game-english',
  });

  if (options.help) {
    printGameEnglishSyncHelp('sync:game-english');
    return;
  }

  await runGameEnglishSync(options);
}

main().catch((error) => {
  console.error('[sync-game-english] 同步失败:', error);
  process.exitCode = 1;
});
