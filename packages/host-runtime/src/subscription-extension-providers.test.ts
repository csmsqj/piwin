import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createExtensionRevisionStore } from '@piwin/extensions';
import {
  parseAuthProviderClaim,
  readSubscriptionExtensionProviders,
} from './subscription-extension-providers.js';

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

  it('accepts any valid extension provider id with an optional display name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-extension-auth-'));
    const source = join(root, 'source');
    roots.push(root);
    await mkdir(source);
    await writeFile(join(source, 'index.ts'), 'export default function () {}\n');
    await writeFile(
      join(source, 'piwin.json'),
      '{"authProvider":"acme-cloud","authProviderName":" Acme Cloud "}\n',
    );
    const store = createExtensionRevisionStore(root);
    const staged = await store.stage({ sourcePath: source });
    await store.setEnabled(staged.extensionId, true);
    expect(await readSubscriptionExtensionProviders(root)).toEqual([
      { providerId: 'acme-cloud', entryPath: staged.targetPath, displayName: 'Acme Cloud' },
    ]);
  });
});

describe('parseAuthProviderClaim', () => {
  it('ignores manifests without a claim', () => {
    expect(parseAuthProviderClaim({})).toBeUndefined();
  });

  it('rejects built-in subscription ids and unsafe ids', () => {
    expect(parseAuthProviderClaim({ authProvider: 'openai-codex' })).toBe('invalid');
    expect(parseAuthProviderClaim({ authProvider: 'anthropic-claude-code' })).toBe('invalid');
    expect(parseAuthProviderClaim({ authProvider: '../escape' })).toBe('invalid');
    expect(parseAuthProviderClaim({ authProvider: 'Upper' })).toBe('invalid');
    expect(parseAuthProviderClaim({ authProvider: 42 })).toBe('invalid');
  });

  it('accepts extension slugs', () => {
    expect(parseAuthProviderClaim({ authProvider: 'kiro' })).toEqual({ providerId: 'kiro' });
  });
});
