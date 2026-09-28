import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import { pickConnectionTestModel, testProviderConnection } from './provider-connection-test.js';

const ARK_PLAN_BASE = 'https://ark.cn-beijing.volces.com/api/plan/v3';

function createProvider(overrides: Partial<ModelProviderConfig> = {}): ModelProviderConfig {
  return {
    id: 'ark-plan',
    name: 'Ark Agent Plan',
    protocol: 'openai-compatible',
    baseUrl: ARK_PLAN_BASE,
    models: [],
    ...overrides,
  };
}

function respond(status: number, body: unknown = {}, statusText = ''): typeof fetch {
  return async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, statusText });
}

const secret = async (): Promise<string> => 'secret';

describe('testProviderConnection', () => {
  it('reports a catalog-less endpoint (404 /models) as catalog-unavailable, not a failure', async () => {
    const urls: string[] = [];
    const result = await testProviderConnection(createProvider(), undefined, {
      resolveSecret: secret,
      fetch: async (input) => {
        urls.push(String(input));
        return new Response('', { status: 404, statusText: 'Not Found' });
      },
    });

    expect(urls).toEqual([`${ARK_PLAN_BASE}/models`]);
    expect(result).toMatchObject({
      providerId: 'ark-plan',
      method: 'discovery',
      outcome: 'catalog-unavailable',
      httpStatus: 404,
      endpoint: `${ARK_PLAN_BASE}/models`,
    });
  });

  it('chats with the first enabled chat model instead of hitting /models', async () => {
    const urls: string[] = [];
    const result = await testProviderConnection(
      createProvider({
        models: [
          { id: 'seedream', capabilities: ['image-generation'] },
          { id: 'disabled', enabled: false },
          { id: 'glm-5.2' },
        ],
      }),
      undefined,
      {
        resolveSecret: secret,
        fetch: async (input) => {
          urls.push(String(input));
          return new Response('{}', { status: 200 });
        },
      },
    );

    expect(urls).toEqual([`${ARK_PLAN_BASE}/chat/completions`]);
    expect(result).toMatchObject({
      outcome: 'chat-ok',
      method: 'model-test',
      modelId: 'glm-5.2',
      chatApi: 'openai-completions',
    });
  });

  it('uses the Responses transport when the row selects it', async () => {
    const urls: string[] = [];
    const result = await testProviderConnection(
      createProvider({ chatApi: 'openai-responses', models: [{ id: 'doubao-seed-2.0-pro' }] }),
      undefined,
      {
        resolveSecret: secret,
        fetch: async (input) => {
          urls.push(String(input));
          return new Response('{}', { status: 200 });
        },
      },
    );
    expect(urls).toEqual([`${ARK_PLAN_BASE}/responses`]);
    expect(result.chatApi).toBe('openai-responses');
  });

  it.each([
    [401, 'auth-failed'],
    [403, 'auth-failed'],
    [404, 'model-rejected'],
    [400, 'model-rejected'],
    [500, 'model-rejected'],
  ] as const)('maps chat probe HTTP %i to %s', async (status, outcome) => {
    const result = await testProviderConnection(
      createProvider({ models: [{ id: 'glm-5.2' }] }),
      undefined,
      { resolveSecret: secret, fetch: respond(status, { error: { message: 'nope' } }) },
    );
    expect(result).toMatchObject({
      outcome,
      httpStatus: status,
      detail: expect.stringContaining('nope'),
    });
  });

  it.each([
    [401, 'auth-failed'],
    [405, 'catalog-unavailable'],
    [500, 'catalog-unavailable'],
  ] as const)('maps discovery HTTP %i to %s', async (status, outcome) => {
    const result = await testProviderConnection(createProvider(), undefined, {
      resolveSecret: secret,
      fetch: respond(status),
    });
    expect(result).toMatchObject({ outcome, httpStatus: status, method: 'discovery' });
  });

  it('treats a 200 non-list catalog as catalog-unavailable', async () => {
    const result = await testProviderConnection(createProvider(), undefined, {
      resolveSecret: secret,
      fetch: respond(200, '<html>portal</html>'),
    });
    expect(result.outcome).toBe('catalog-unavailable');
  });

  it('reports catalog-ok with the model count', async () => {
    const result = await testProviderConnection(createProvider(), undefined, {
      resolveSecret: secret,
      fetch: respond(200, { data: [{ id: 'a' }, { id: 'b' }] }),
    });
    expect(result).toMatchObject({ outcome: 'catalog-ok', modelCount: 2 });
  });

  it('reports network errors as unreachable', async () => {
    const result = await testProviderConnection(
      createProvider({ models: [{ id: 'glm-5.2' }] }),
      undefined,
      {
        resolveSecret: secret,
        fetch: async () => {
          throw new TypeError('fetch failed: getaddrinfo ENOTFOUND');
        },
      },
    );
    expect(result).toMatchObject({
      outcome: 'unreachable',
      detail: expect.stringContaining('ENOTFOUND'),
    });
  });

  it('reports a non-http Base URL as invalid-config without a request', async () => {
    let called = false;
    const result = await testProviderConnection(
      createProvider({ baseUrl: 'oauth://xai', models: [{ id: 'grok' }] }),
      undefined,
      {
        resolveSecret: secret,
        fetch: async () => {
          called = true;
          return new Response('{}');
        },
      },
    );
    expect(called).toBe(false);
    expect(result.outcome).toBe('invalid-config');
    expect(result).not.toHaveProperty('endpoint');
  });
});

describe('pickConnectionTestModel', () => {
  it('prefers an explicit model id, even one the draft has not saved yet', () => {
    expect(pickConnectionTestModel(createProvider({ models: [{ id: 'a' }] }), ' typed ')).toBe(
      'typed',
    );
  });

  it('returns undefined when no chat model is usable', () => {
    expect(
      pickConnectionTestModel(
        createProvider({ models: [{ id: 'img', capabilities: ['image-generation'] }] }),
        undefined,
      ),
    ).toBeUndefined();
  });
});
