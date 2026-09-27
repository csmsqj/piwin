import { describe, expect, it } from 'vitest';
import { parseMacMountedVolumes, parseWindowsDriveRoots } from './host-locations.js';

describe('Host filesystem locations', () => {
  it('shows mounted macOS volumes and omits hidden system mounts', () => {
    const output = [
      '/dev/disk1 on / (apfs, local)',
      '/dev/disk2 on /Volumes/Big Disk (apfs, local, noowners)',
      '/dev/disk3 on /Volumes/Preboot (apfs, local, nobrowse)',
      '//server/share on /Volumes/Team (smbfs, nodev)',
    ].join('\n');
    expect(parseMacMountedVolumes(output)).toEqual([
      { name: 'Big Disk', path: '/Volumes/Big Disk' },
      { name: 'Team', path: '/Volumes/Team' },
    ]);
  });

  it('shows ready Windows drive roots once each', () => {
    expect(parseWindowsDriveRoots(['C:\\', 'D:\\', 'C:\\'].join('\r\n'))).toEqual([
      { name: 'C:', path: 'C:\\' },
      { name: 'D:', path: 'D:\\' },
    ]);
  });
});
