#!/usr/bin/env node
/**
 * One-off repair: move sessions that unit tests leaked into a real piwin root
 * (projectPath "/tmp/project", e.g. "hello runtime - 479") out of the way.
 *
 * Root cause was host-runtime tests constructing a mock HostRuntime without
 * `piwinRoot`; fixed by explicit roots + vitest.piwin-root-isolation.ts. This
 * script only cleans up what already leaked.
 *
 * Safe by default:
 * - Dry run unless `--apply`.
 * - Refuses to run while a Host owns the root (the Host keeps the index in
 *   memory and would write the rows back). Quit piwin first.
 * - Nothing is deleted: session dirs, their runtime-lease dirs, and a copy of
 *   the index are moved to `<root>/trash/test-pollution-<timestamp>/`.
 *
 * Usage:
 *   node scripts/prune-test-polluted-sessions.mjs            # report only
 *   node scripts/prune-test-polluted-sessions.mjs --apply    # move to trash
 *   PIWIN_ROOT=/path node scripts/prune-test-polluted-sessions.mjs
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TEST_PROJECT_PATH = '/tmp/project';

const root = process.env.PIWIN_ROOT?.trim() || join(homedir(), '.piwin');
const apply = process.argv.includes('--apply');
const indexPath = join(root, 'sessions-index', 'index.json');

function directorySize(path) {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    total += entry.isDirectory() ? directorySize(child) : statSync(child).size;
  }
  return total;
}

function liveHostOwner() {
  const ownerPath = join(root, '.host', 'owner.lock', 'owner.json');
  if (!existsSync(ownerPath)) return null;
  const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
  try {
    process.kill(owner.processId, 0);
    return owner;
  } catch (error) {
    // ESRCH: owner died without releasing; EPERM: alive but not ours.
    return error.code === 'EPERM' ? owner : null;
  }
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
if (!Array.isArray(index.sessions)) {
  throw new Error(`Unexpected index shape at ${indexPath}: no sessions array`);
}
const polluted = index.sessions.filter((session) => session.projectPath === TEST_PROJECT_PATH);
const kept = index.sessions.filter((session) => session.projectPath !== TEST_PROJECT_PATH);

let bytes = 0;
for (const session of polluted) {
  const dir = join(root, 'sessions', session.id);
  if (existsSync(dir)) bytes += directorySize(dir);
}
const created = polluted.map((session) => session.createdAt).sort();
console.log(`piwin root: ${root}`);
console.log(
  `index rows: ${index.sessions.length}, test-polluted (${TEST_PROJECT_PATH}): ${polluted.length}`,
);
if (polluted.length === 0) process.exit(0);
console.log(
  `created between ${created[0]} and ${created.at(-1)}; ${(bytes / 1e6).toFixed(1)} MB on disk`,
);
console.log(
  `sample names: ${[...new Set(polluted.map((s) => (s.name ?? '').replace(/ - \d+$/, '')))].join(', ')}`,
);

if (!apply) {
  console.log('\nDry run. Re-run with --apply (piwin closed) to move them to trash.');
  process.exit(0);
}

const owner = liveHostOwner();
if (owner) {
  console.error(
    `\nA piwin Host (pid ${owner.processId}, ${owner.ownerKind}) owns this root. Quit piwin, then re-run.`,
  );
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const trashDir = join(root, 'trash', `test-pollution-${stamp}`);
mkdirSync(join(trashDir, 'sessions'), { recursive: true });
mkdirSync(join(trashDir, 'runtime-leases'), { recursive: true });
copyFileSync(indexPath, join(trashDir, 'index.backup.json'));

let movedDirs = 0;
for (const session of polluted) {
  const sessionDir = join(root, 'sessions', session.id);
  if (existsSync(sessionDir)) {
    renameSync(sessionDir, join(trashDir, 'sessions', session.id));
    movedDirs += 1;
  }
  const leaseDir = join(root, 'runtime-leases', session.id);
  if (existsSync(leaseDir)) renameSync(leaseDir, join(trashDir, 'runtime-leases', session.id));
}

// Atomic replace: write next to the index, then rename over it.
const tmpPath = `${indexPath}.prune-${process.pid}.tmp`;
writeFileSync(tmpPath, `${JSON.stringify({ ...index, sessions: kept }, null, 2)}\n`);
renameSync(tmpPath, indexPath);

console.log(`\nMoved ${movedDirs} session dirs and ${polluted.length} index rows to ${trashDir}`);
console.log('Restore: copy index.backup.json back and move the dirs back into sessions/.');
