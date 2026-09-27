import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createSubscriptionAuthPort } from './subscription-auth.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('createSubscriptionAuthPort with the real Pi ModelRuntime', () => {
  it("registers the Devin provider without detaching Pi's registerProvider from its runtime", async () => {
    // Regression: passing `runtime.registerProvider` on its own dropped `this`,
    // and Pi threw "Cannot read properties of undefined (reading 'get')".
    const root = await mkdtemp(join(tmpdir(), 'piwin-subscription-runtime-'));
    roots.push(root);
    const port = await createSubscriptionAuthPort({ authPath: join(root, 'auth.json') });
    await expect(port.listCredentials()).resolves.toEqual([]);
  });

  it('loads an enabled extension provider into the Host OAuth model runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-extension-auth-runtime-'));
    roots.push(root);
    const extensionPath = join(root, 'provider.ts');
    await writeFile(extensionPath, `export default function (pi) {
      pi.registerProvider('commandcode', {
        name: 'Command Code',
        baseUrl: 'https://api.commandcode.ai/provider/v1',
        api: 'openai-completions',
        oauth: {
          name: 'Command Code',
          login: async () => ({ access: 'test', refresh: 'test', expires: Date.now() + 100000 }),
          refreshToken: async (credential) => credential,
          getApiKey: (credential) => credential.access,
        },
        models: [{ id: 'test-model', name: 'Test model', input: ['text'],
          contextWindow: 10000, maxTokens: 1000,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      });
    }\n`);
    const port = await createSubscriptionAuthPort({
      authPath: join(root, 'auth.json'), extensionPaths: [extensionPath],
    });
    expect(port.getChatCatalog('commandcode').map((model) => model.id)).toContain('test-model');
    port.dispose();
  });
});
