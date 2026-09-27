import { describe, expect, it } from 'vitest';
import {
  createDefaultCodeSearchConfig,
  createDefaultWebConfig,
  type PiwinConfig,
} from '@piwin/contracts';

import { applyDevinLogoutWebSearch, applySubscriptionLoginDefaults } from './subscription-login-defaults.js';

function config(overrides: Partial<PiwinConfig> = {}): PiwinConfig {
  return {
    providers: [],
    codeSearch: createDefaultCodeSearchConfig(),
    web: createDefaultWebConfig(),
    ...overrides,
  } as PiwinConfig;
}

describe('applySubscriptionLoginDefaults', () => {
  it('turns on code_search and the Devin search source for a fresh setup, and asks about priority', () => {
    const { config: next, followUp } = applySubscriptionLoginDefaults(config(), 'devin');
    expect(next.codeSearch).toMatchObject({ enabled: true, backend: 'windsurf', apiKeyRef: 'oauth:devin' });
    expect(next.codeSearch?.apiKeyEnv).toBeUndefined();
    expect(next.web?.searchSources).toContainEqual({
      id: 'devin',
      kind: 'devin',
      enabled: true,
      apiKeyRef: 'oauth:devin',
    });
    // The packaged default is model-native first: the priority itself is untouched.
    expect(next.web?.searchRoutePolicy).toBe(createDefaultWebConfig().searchRoutePolicy);
    expect(followUp).toEqual({
      enabled: ['code-search', 'web-search-source'],
      suggestExternalSearchPriority: true,
    });
  });

  it('keeps a code_search model or pasted token the user chose', () => {
    const withModel = config({
      codeSearch: {
        ...createDefaultCodeSearchConfig(),
        enabled: false,
        backend: 'model',
        model: { providerId: 'custom', modelId: 'fast' },
      },
    });
    expect(applySubscriptionLoginDefaults(withModel, 'devin').config.codeSearch).toEqual(withModel.codeSearch);

    const withToken = config({
      codeSearch: {
        ...createDefaultCodeSearchConfig(),
        enabled: true,
        backend: 'windsurf',
        apiKeyRef: 'keychain:piwin-code-search-windsurf',
      },
    });
    const result = applySubscriptionLoginDefaults(withToken, 'devin');
    expect(result.config.codeSearch).toEqual(withToken.codeSearch);
    expect(result.followUp?.enabled).toEqual(['web-search-source']);
  });

  it('replaces a lone DuckDuckGo source when priority is external-first', () => {
    const current = config({
      web: {
        ...createDefaultWebConfig(),
        searchRoutePolicy: 'external-first',
        searchSources: [
          { id: 'duckduckgo', kind: 'duckduckgo', enabled: true },
          { id: 'devin', kind: 'devin', enabled: false, apiKeyRef: 'oauth:devin' },
        ],
      },
    });
    const { config: next, followUp } = applySubscriptionLoginDefaults(current, 'devin');
    expect(next.web?.searchSources.find((source) => source.kind === 'duckduckgo')?.enabled).toBe(false);
    expect(next.web?.searchSources.find((source) => source.kind === 'devin')).toMatchObject({
      enabled: true,
      apiKeyRef: 'oauth:devin',
    });
    expect(next.web?.searchRoutePolicy).toBe('external-first');
    expect(followUp?.enabled).toContain('web-search-source');
  });

  it('leaves DuckDuckGo on when another source is enabled or priority is not external-first', () => {
    const withBrave = config({
      web: {
        ...createDefaultWebConfig(),
        searchRoutePolicy: 'external-first',
        searchSources: [
          { id: 'duckduckgo', kind: 'duckduckgo', enabled: true },
          { id: 'brave', kind: 'brave', enabled: true, apiKeyEnv: 'BRAVE_API_KEY' },
        ],
      },
    });
    const braveNext = applySubscriptionLoginDefaults(withBrave, 'devin').config;
    expect(braveNext.web?.searchSources.find((source) => source.kind === 'duckduckgo')?.enabled).toBe(true);
    expect(braveNext.web?.searchSources.find((source) => source.kind === 'brave')?.enabled).toBe(true);

    const nativeFirst = config({
      web: {
        ...createDefaultWebConfig(),
        searchRoutePolicy: 'native-first',
        searchSources: [{ id: 'duckduckgo', kind: 'duckduckgo', enabled: true }],
      },
    });
    const nativeNext = applySubscriptionLoginDefaults(nativeFirst, 'devin').config;
    expect(nativeNext.web?.searchSources.find((source) => source.kind === 'duckduckgo')?.enabled).toBe(true);
  });

  it('leaves a Devin source the user switched off, and stays quiet on external-first', () => {
    const web = {
      ...createDefaultWebConfig(),
      searchRoutePolicy: 'external-first' as const,
      searchSources: [{ id: 'devin', kind: 'devin' as const, enabled: false, apiKeyRef: 'oauth:devin' }],
    };
    const settled = config({
      web,
      codeSearch: { ...createDefaultCodeSearchConfig(), enabled: true, backend: 'windsurf', apiKeyRef: 'oauth:devin' },
    });
    const result = applySubscriptionLoginDefaults(settled, 'devin');
    expect(result.config).toBe(settled);
    expect(result.followUp).toBeUndefined();
  });

  it('turns Devin web search off on logout and enables DuckDuckGo when nothing else is on', () => {
    const current = config({
      web: {
        ...createDefaultWebConfig(),
        searchSources: [{ id: 'devin', kind: 'devin', enabled: true, apiKeyRef: 'oauth:devin' }],
      },
    });
    const next = applyDevinLogoutWebSearch(current);
    expect(next.web?.searchSources).toEqual([
      { id: 'duckduckgo', kind: 'duckduckgo', enabled: true },
      { id: 'devin', kind: 'devin', enabled: false, apiKeyRef: 'oauth:devin' },
    ]);
  });

  it('does not turn DuckDuckGo on when another search source stays enabled', () => {
    const current = config({
      web: {
        ...createDefaultWebConfig(),
        searchSources: [
          { id: 'brave', kind: 'brave', enabled: true, apiKeyEnv: 'BRAVE_API_KEY' },
          { id: 'devin', kind: 'devin', enabled: true, apiKeyRef: 'oauth:devin' },
        ],
      },
    });
    const next = applyDevinLogoutWebSearch(current);
    expect(next.web?.searchSources.find((source) => source.kind === 'devin')?.enabled).toBe(false);
    expect(next.web?.searchSources.some((source) => source.kind === 'duckduckgo' && source.enabled)).toBe(
      false,
    );
    expect(next.web?.searchSources.find((source) => source.kind === 'brave')?.enabled).toBe(true);
  });

  it('does nothing for other providers', () => {
    const base = config();
    expect(applySubscriptionLoginDefaults(base, 'openai-codex')).toEqual({ config: base });
  });
});
