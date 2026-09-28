import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installModelCatalogSnapshot, lookupCatalogByModelId, resetModelCatalogSnapshot } from '@piwin/agent-host';
import { enrichConfiguredChatModelsWithCatalog } from './catalog-commands.js';
import { handleModelCatalogCommand } from './model-catalog-commands.js';
import { syncModelCatalogFromModelsDev } from '../model-catalog-store.js';
import type { HostCommandContext } from './host-command-context.js';

afterEach(() => {
  resetModelCatalogSnapshot();
  vi.unstubAllGlobals();
});

function context(piwinRoot: string): HostCommandContext {
  return { piwinRoot } as HostCommandContext;
}

describe('handleModelCatalogCommand', () => {
  it('returns status for the Pi bootstrap before any sync', async () => {
    const response = await handleModelCatalogCommand(
      { type: 'models/catalog/status' },
      'req-status',
      context('/tmp/unused-catalog-status'),
    );
    expect(response).toMatchObject({
      command: 'models/catalog/status',
      success: true,
      data: { source: 'pi-bootstrap' },
    });
  });

  it('syncs via injected fetch when models/catalog/sync runs', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-catalog-cmd-'));
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            xai: {
              models: {
                'grok-4.6': {
                  id: 'grok-4.6',
                  name: 'Grok 4.6',
                  reasoning: true,
                  modalities: { input: ['text'], output: ['text'] },
                  limit: { context: 500_000, output: 8_192 },
                },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const response = await handleModelCatalogCommand(
      { type: 'models/catalog/sync' },
      'req-sync',
      context(rootDir),
    );
    expect(response).toMatchObject({
      command: 'models/catalog/sync',
      success: true,
    });
    if (!response || response.type !== 'response' || !response.success) {
      throw new Error(`expected success, got ${JSON.stringify(response)}`);
    }
    const data = response.data as { ok: boolean; source: string; entryCount: number };
    expect(data.ok).toBe(true);
    expect(data.source).toBe('models.dev');
    expect(data.entryCount).toBeGreaterThan(0);
    expect(lookupCatalogByModelId('grok-4.6')?.contextWindow).toBe(500_000);
  });

  it('keeps the previous snapshot when sync fetch fails', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-catalog-cmd-fail-'));
    await syncModelCatalogFromModelsDev({
      rootDir,
      fetch: async () =>
        new Response(
          JSON.stringify({
            xai: {
              models: {
                'grok-4.6': {
                  id: 'grok-4.6',
                  name: 'Grok 4.6',
                  modalities: { input: ['text'], output: ['text'] },
                  limit: { context: 500_000, output: 8_192 },
                },
              },
            },
          }),
          { status: 200 },
        ),
    });
    vi.stubGlobal('fetch', async () => new Response('down', { status: 500, statusText: 'ERR' }));
    const response = await handleModelCatalogCommand(
      { type: 'models/catalog/sync' },
      'req-sync-fail',
      context(rootDir),
    );
    expect(response).toMatchObject({
      command: 'models/catalog/sync',
      success: false,
    });
    expect(lookupCatalogByModelId('grok-4.6')?.contextWindow).toBe(500_000);
  });
});
describe('enrichConfiguredChatModelsWithCatalog', () => {
  it('populates missing model label from catalog and strips variant suffixes', () => {
    installModelCatalogSnapshot({
      source: 'models.dev',
      catalogVersion: 'test',
      entries: [
        {
          catalogProviderId: 'google',
          modelId: 'google/gemini-3.8-flash',
          name: 'Gemini 3.8 Flash',
          input: ['text', 'image'],
          reasoning: true,
          contextWindow: 1_000_000,
          maxTokens: 128_000,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
      imageEntries: [],
    });

    const models = [
      { providerId: 'custom-openai', modelId: 'gemini-3.8-flash-high' },
      { providerId: 'custom-openai', modelId: 'gemini-3.8-flash', label: 'Custom Label' },
    ];
    enrichConfiguredChatModelsWithCatalog(models);
    expect(models[0]?.label).toBe('Gemini 3.8 Flash');
    expect(models[1]?.label).toBe('Custom Label');
  });
});
