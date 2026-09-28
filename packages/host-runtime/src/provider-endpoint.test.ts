import { describe, expect, it } from 'vitest';
import {
  ProviderEndpointError,
  normalizeProviderBaseUrl,
  resolveEffectiveChatApi,
  resolveProviderChatEndpoint,
} from './provider-endpoint.js';

describe('provider-endpoint', () => {
  it.each([
    ['https://api.openai.com/v1', 'https://api.openai.com/v1/chat/completions'],
    [
      'https://ark.cn-beijing.volces.com/api/v3',
      'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    ],
    [
      'https://ark.cn-beijing.volces.com/api/plan/v3/',
      'https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions',
    ],
    [
      'https://open.bigmodel.cn/api/paas/v4',
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    ],
    ['http://127.0.0.1:8799', 'http://127.0.0.1:8799/chat/completions'],
  ])('OpenAI chat URL for %s matches the OpenAI SDK baseURL join', (baseUrl, expected) => {
    expect(resolveProviderChatEndpoint({ protocol: 'openai-compatible', baseUrl }, 'model')).toBe(
      expected,
    );
  });

  it('routes Responses providers to {baseUrl}/responses', () => {
    expect(
      resolveProviderChatEndpoint(
        {
          protocol: 'openai-compatible',
          baseUrl: 'https://x.test/api/plan/v3',
          chatApi: 'openai-responses',
        },
        'model',
      ),
    ).toBe('https://x.test/api/plan/v3/responses');
  });

  it('lets callers force Chat Completions for Chat-shaped bodies', () => {
    expect(
      resolveProviderChatEndpoint(
        {
          protocol: 'openai-compatible',
          baseUrl: 'https://x.test/v1',
          chatApi: 'openai-responses',
        },
        'model',
        'openai-completions',
      ),
    ).toBe('https://x.test/v1/chat/completions');
  });

  it('uses the Anthropic SDK path and Gemini model resource', () => {
    expect(
      resolveProviderChatEndpoint(
        { protocol: 'anthropic-compatible', baseUrl: 'https://open.bigmodel.cn/api/anthropic' },
        'glm',
      ),
    ).toBe('https://open.bigmodel.cn/api/anthropic/v1/messages');
    expect(
      resolveProviderChatEndpoint(
        { protocol: 'google-gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
        'gemini 2',
      ),
    ).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini%202:generateContent');
  });

  it('ignores a chatApi that is impossible for the protocol', () => {
    expect(
      resolveEffectiveChatApi({ protocol: 'anthropic-compatible', chatApi: 'openai-responses' }),
    ).toBe('anthropic-messages');
    expect(resolveEffectiveChatApi({ protocol: 'openai-compatible' })).toBe('openai-completions');
    expect(
      resolveEffectiveChatApi({ protocol: 'openai-compatible', chatApi: 'anthropic-messages' }),
    ).toBe('openai-completions');
  });

  it('rejects empty and non-http Base URLs', () => {
    expect(() => normalizeProviderBaseUrl('  ')).toThrow(ProviderEndpointError);
    expect(() => normalizeProviderBaseUrl('oauth://xai')).toThrow(ProviderEndpointError);
    expect(() => normalizeProviderBaseUrl('not a url')).toThrow(ProviderEndpointError);
  });
});
