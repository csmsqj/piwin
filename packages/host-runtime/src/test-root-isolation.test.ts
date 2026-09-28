/**
 * Guard for the repo-level vitest setup (vitest.piwin-root-isolation.ts):
 * a test that forgets `piwinRoot` must land in a temp dir, never in the
 * developer's real ~/.piwin.
 */
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { getDefaultPiwinRoot, getPiwinRoot } from './paths.js';

describe('test piwin root isolation', () => {
  it('resolves the fallback root to a per-file temp dir', () => {
    const root = getPiwinRoot();
    expect(root).not.toBe(getDefaultPiwinRoot());
    expect(root.startsWith(tmpdir())).toBe(true);
    expect(process.env.PIWIN_PI_AGENT_DIR?.startsWith(root)).toBe(true);
  });
});
