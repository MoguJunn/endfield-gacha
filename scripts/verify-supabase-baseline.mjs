import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const activeMigrationsDir = path.join(projectRoot, 'supabase', 'migrations');
const archivedMigrationsDir = path.join(projectRoot, 'supabase', 'archive', 'migrations');
const baselinePath = path.join(projectRoot, 'supabase', 'baseline', '000_complete_schema.sql');

function toPosixPath(filePath) {
  return filePath.split(path.sep).join(path.posix.sep);
}

function normalizeMigrationContent(content) {
  return content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

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

async function main() {
  const archivedFiles = await collectMigrationFiles(archivedMigrationsDir);
  const activeFiles = await collectMigrationFiles(activeMigrationsDir);
  const migrationFiles = [
    ...archivedFiles.map((file) => path.posix.join('archive', file)),
    ...activeFiles.map((file) => path.posix.join('active', file)),
  ].sort(compareMigrationNames);

  if (migrationFiles.length === 0) {
    throw new Error('No migration files found.');
  }

  const baseline = await readFile(baselinePath, 'utf8');
  const firstMigration = migrationFiles[0];
  const lastMigration = migrationFiles[migrationFiles.length - 1];
  const expectedCoverageLine = `--   5. 覆盖范围: ${firstMigration} -> ${lastMigration}`;

  if (!baseline.includes(expectedCoverageLine)) {
    throw new Error(`Baseline coverage header mismatch. Expected: ${expectedCoverageLine}`);
  }

  for (const migrationFile of migrationFiles) {
    const beginMarker = `-- >>> BEGIN MIGRATION: ${migrationFile}`;
    const endMarker = `-- <<< END MIGRATION: ${migrationFile}`;

    if (!baseline.includes(beginMarker) || !baseline.includes(endMarker)) {
      throw new Error(`Baseline is missing markers for ${migrationFile}`);
    }

    const isArchived = migrationFile.startsWith('archive/');
    const relativePath = migrationFile.replace(/^(archive|active)\//, '');
    const sourcePath = path.join(
      isArchived ? archivedMigrationsDir : activeMigrationsDir,
      ...relativePath.split('/')
    );
    const sourceContent = normalizeMigrationContent(await readFile(sourcePath, 'utf8'));
    const expectedBlock = `${beginMarker}\n${sourceContent}\n${endMarker}`;

    if (!baseline.includes(expectedBlock)) {
      throw new Error(`Baseline content differs from ${migrationFile}`);
    }
  }

  console.log('[verify-supabase-baseline] OK');
  console.log(`- total migrations: ${migrationFiles.length}`);
  console.log(`- coverage: ${firstMigration} -> ${lastMigration}`);
  console.log(`- baseline: ${baselinePath}`);
}

main().catch((error) => {
  console.error('[verify-supabase-baseline] Failed:', error);
  process.exitCode = 1;
});
