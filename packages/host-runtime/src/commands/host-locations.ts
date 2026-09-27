import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { HostLocation } from '@piwin/contracts';

const execFileAsync = promisify(execFile);
const DISCOVERY_TIMEOUT_MS = 2_000;

export function parseMacMountedVolumes(output: string): HostLocation[] {
  const locations = new Map<string, HostLocation>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/ on (\/Volumes\/.+) \(([^)]+)\)$/);
    if (!match) continue;
    const mountPath = match[1];
    const options = match[2];
    if (!mountPath || !options || options.split(',').some((option) => option.trim() === 'nobrowse')) {
      continue;
    }
    const name = mountPath.slice('/Volumes/'.length);
    if (!name || name.includes('/')) continue;
    locations.set(mountPath, { name, path: mountPath });
  }
  return [...locations.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function parseWindowsDriveRoots(output: string): HostLocation[] {
  const locations = new Map<string, HostLocation>();
  for (const line of output.split(/\r?\n/)) {
    const drivePath = line.trim().toUpperCase();
    if (!/^[A-Z]:\\$/.test(drivePath)) continue;
    locations.set(drivePath, { name: drivePath.slice(0, 2), path: drivePath });
  }
  return [...locations.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export async function listHostLocations(homePath: string): Promise<HostLocation[]> {
  const rootPath = path.parse(homePath).root;
  const root: HostLocation = {
    name: rootPath === '/' ? '/' : rootPath.replace(/[\\/]$/, ''),
    path: rootPath,
  };
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('/sbin/mount', [], {
        timeout: DISCOVERY_TIMEOUT_MS,
        maxBuffer: 256_000,
      });
      return [root, ...parseMacMountedVolumes(stdout)];
    }
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.IsReady } | ForEach-Object { $_.Name }',
        ],
        { timeout: DISCOVERY_TIMEOUT_MS, maxBuffer: 16_000 },
      );
      const drives = parseWindowsDriveRoots(stdout);
      return drives.length > 0 ? drives : [root];
    }
  } catch (error) {
    // Location discovery is optional; keep the home drive browsable.
    console.warn('Host filesystem location discovery failed:', error);
  }
  return [root];
}
