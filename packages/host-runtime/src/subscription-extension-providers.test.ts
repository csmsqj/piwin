import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createExtensionRevisionStore } from '@piwin/extensions';
import { readSubscriptionExtensionProviders } from './subscription-extension-providers.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('subscription extension providers', () => {
  it('exposes the provider only for an enabled selected revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-extension-auth-'));
    const source = join(root, 'source');
    roots.push(root);
    await mkdir(source);
    await writeFile(join(source, 'index.ts'), 'export default function () {}\n');
    await writeFile(join(source, 'piwin.json'), '{"authProvider":"commandcode"}\n');
    const store = createExtensionRevisionStore(root);
    const staged = await store.stage({ sourcePath: source });
    expect(await readSubscriptionExtensionProviders(root)).toEqual([]);
    await store.setEnabled(staged.extensionId, true);
    expect(await readSubscriptionExtensionProviders(root)).toEqual([
      { providerId: 'commandcode', entryPath: staged.targetPath },
    ]);
    await store.setEnabled(staged.extensionId, false);
    expect(await readSubscriptionExtensionProviders(root)).toEqual([]);
  });
});
