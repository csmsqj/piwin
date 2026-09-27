import { describe, expect, it } from 'vitest';
import type { ModelConfigEntry, WebConfig } from '@piwin/contracts';
import { createDefaultWebConfig } from '@piwin/contracts';
import { resolveNativeSearchAdapterSupport } from './search-route-resolver.js';
import { webConfigWithDuckDuckGoFloor } from './duckduckgo-search-floor.js';

const adapterReady = resolveNativeSearchAdapterSupport('google-gemini');

function nativeModel(): ModelConfigEntry {
  return { id: 'gemini', capabilities: ['chat', 'native-web-search'] };
}

function plainModel(): ModelConfigEntry {
  return { id: 'gemini', capabilities: ['chat'] };
}

function emptyWeb(overrides: Partial<WebConfig> = {}): WebConfig {
  return {
    ...createDefaultWebConfig(),
    searchSources: [],
    searchRoutePolicy: 'native-first',
    ...overrides,
  };
}

describe('webConfigWithDuckDuckGoFloor', () => {
  it('enables DuckDuckGo when the model has no native search and no source is on', () => {
    const web = emptyWeb({
      searchSources: [{ id: 'duckduckgo', kind: 'duckduckgo', enabled: false }],
    });
    const floored = webConfigWithDuckDuckGoFloor(web, {
      model: plainModel(),
      adapter: adapterReady,
    });
    expect(floored.searchSources).toEqual([
      { id: 'duckduckgo', kind: 'duckduckgo', enabled: true },
    ]);
    expect(web.searchSources[0]?.enabled).toBe(false);
  });

  it('inserts DuckDuckGo when the source list is empty', () => {
    const floored = webConfigWithDuckDuckGoFloor(emptyWeb(), {
      model: plainModel(),
      adapter: adapterReady,
    });
    expect(floored.searchSources).toEqual([
      { id: 'duckduckgo', kind: 'duckduckgo', enabled: true },
    ]);
  });

  it('leaves the config alone when the model can use native search', () => {
    const web = emptyWeb();
    const floored = webConfigWithDuckDuckGoFloor(web, {
      model: nativeModel(),
      adapter: adapterReady,
    });
    expect(floored).toBe(web);
  });

  it('leaves a user-enabled source alone', () => {
    const web = emptyWeb({
      searchSources: [{ id: 'brave', kind: 'brave', enabled: true, apiKeyEnv: 'BRAVE_API_KEY' }],
    });
    const floored = webConfigWithDuckDuckGoFloor(web, {
      model: plainModel(),
      adapter: adapterReady,
    });
    expect(floored).toBe(web);
  });

  it('does not replace a configured search delegate', () => {
    const web = emptyWeb({
      searchDelegateModel: {
        protocol: 'google-gemini',
        providerId: 'gemini',
        modelId: 'gemini-search',
      },
    });
    const floored = webConfigWithDuckDuckGoFloor(web, {
      model: plainModel(),
      adapter: adapterReady,
    });
    expect(floored).toBe(web);
  });

  it('does not open DuckDuckGo under native-only', () => {
    const web = emptyWeb({ searchRoutePolicy: 'native-only' });
    const floored = webConfigWithDuckDuckGoFloor(web, {
      model: plainModel(),
      adapter: adapterReady,
    });
    expect(floored).toBe(web);
  });

  it('uses the generation policy override', () => {
    const web = emptyWeb({ searchRoutePolicy: 'native-only' });
    const floored = webConfigWithDuckDuckGoFloor(web, {
      model: plainModel(),
      adapter: adapterReady,
      policy: 'external-only',
    });
    expect(floored.searchSources[0]).toMatchObject({ kind: 'duckduckgo', enabled: true });
  });
});
