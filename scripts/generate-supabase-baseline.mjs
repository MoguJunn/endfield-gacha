import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const activeMigrationsDir = path.join(projectRoot, 'supabase', 'migrations');
const archivedMigrationsDir = path.join(projectRoot, 'supabase', 'archive', 'migrations');
const outputPath = path.join(projectRoot, 'supabase', 'baseline', '000_complete_schema.sql');

function compareMigrationNames(a, b) {
  const aName = path.basename(a);
  const bName = path.basename(b);
  const [, aNum = '0', aRest = ''] = aName.match(/^(\d+)_?(.*)$/) || [];
  const [, bNum = '0', bRest = ''] = bName.match(/^(\d+)_?(.*)$/) || [];
  const numDiff = Number(aNum) - Number(bNum);
  if (numDiff !== 0) {
    return numDiff;
  }
  const restDiff = aRest.localeCompare(bRest);
  if (restDiff !== 0) {
    return restDiff;
  }
  return a.localeCompare(b);
}

function stripBom(content) {
  return content.replace(/^\uFEFF/, '');
}

function normalizeMigrationContent(content) {
  return stripBom(content)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join(path.posix.sep);
}

async function collectMigrationFiles(dirPath, rootDir = dirPath) {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectMigrationFiles(absolutePath, rootDir));
      continue;
    }

    if (entry.isFile() && /^\d+_.+\.sql$/i.test(entry.name)) {
      files.push(toPosixPath(path.relative(rootDir, absolutePath)));
    }
  }

  return files;
}

function buildHeader(migrationFiles) {
  const generatedAt = new Date().toISOString();
  const firstMigration = migrationFiles[0] || 'N/A';
  const lastMigration = migrationFiles[migrationFiles.length - 1] || 'N/A';

  return [
    '-- ============================================',
    '-- 终末地抽卡分析器 - 自动生成基线 Schema',
    '--',
    '-- 说明:',
    '--   1. 此文件由 scripts/generate-supabase-baseline.mjs 自动生成',
    '--   2. 合并 supabase/archive/migrations/ 与 supabase/migrations/ 中的标准前向迁移',
    '--   3. 不包含 supabase/manual/ 下的 destructive / rollback / data-backfill 脚本',
    `--   4. 生成时间: ${generatedAt}`,
    `--   5. 覆盖范围: ${firstMigration} -> ${lastMigration}`,
    '-- ============================================',
    '',
  ].join('\n');
}

async function main() {
  const archivedFiles = await collectMigrationFiles(archivedMigrationsDir);
  const activeFiles = await collectMigrationFiles(activeMigrationsDir);
  const migrationFiles = [
    ...archivedFiles.map((file) => path.posix.join('archive', file)),
    ...activeFiles.map((file) => path.posix.join('active', file)),
  ].sort(compareMigrationNames);

  if (migrationFiles.length === 0) {
    throw new Error('No migration SQL files found in active or archived migration directories');
  }

  const chunks = [buildHeader(migrationFiles)];

  for (const fileName of migrationFiles) {
    const isArchived = fileName.startsWith('archive\\') || fileName.startsWith('archive/');
    const relativePath = fileName.replace(/^archive[\\/]/, '').replace(/^active[\\/]/, '');
    const baseDir = isArchived ? archivedMigrationsDir : activeMigrationsDir;
    const absolutePath = path.join(baseDir, relativePath);
    const rawContent = await readFile(absolutePath, 'utf8');
    const content = normalizeMigrationContent(rawContent);

    chunks.push([
      `-- >>> BEGIN MIGRATION: ${fileName}`,
      content,
      `-- <<< END MIGRATION: ${fileName}`,
      '',
    ].join('\n'));
  }

  const output = `${chunks.join('\n')}\n`;
  await writeFile(outputPath, output, 'utf8');

  console.log(`Generated baseline from ${migrationFiles.length} migrations.`);
  console.log(`Output: ${outputPath}`);
}

main().catch((error) => {
  console.error('[generate-supabase-baseline] Failed:', error);
  process.exitCode = 1;
});
