import { describe, expect, it, vi } from 'vitest';
import { testKnowledgeConnection } from './knowledge-connection-test.js';

describe('testKnowledgeConnection embedding', () => {
  it('successfully tests OpenAI-compatible embedding endpoint', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: new Array(1536).fill(0.01) }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await testKnowledgeConnection({
      kind: 'embedding',
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.dimension).toBe(1536);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer sk-test',
        },
      }),
    );
  });

  it('successfully tests Ollama /api/embed endpoint', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          embeddings: [new Array(768).fill(0.02)],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await testKnowledgeConnection({
      kind: 'embedding',
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'nomic-embed-text',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.dimension).toBe(768);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/embed',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('handles error responses with error message', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(
      testKnowledgeConnection({
        kind: 'embedding',
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        model: 'text-embedding-3-small',
        apiKey: 'sk-invalid',
        fetchImpl: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow('Incorrect API key provided');
  });

  it('refuses to dial an endpoint with no model id', async () => {
    const mockFetch = vi.fn();
    await expect(
      testKnowledgeConnection({
        kind: 'embedding',
        baseUrl: 'https://api.openai.com/v1',
        model: '  ',
        fetchImpl: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow('Model ID is required');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('testKnowledgeConnection reranker', () => {
  it('successfully tests /rerank endpoint', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ results: [{ index: 0, relevance_score: 0.95 }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await testKnowledgeConnection({
      kind: 'reranker',
      baseUrl: 'https://api.jina.ai/v1',
      model: 'jina-reranker-v2-base-en',
      apiKey: 'jina-key',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.durationMs).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.jina.ai/v1/rerank',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer jina-key',
        },
      }),
    );
  });

  it('falls back to chat/completions when /rerank is absent', async () => {
    const mockFetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/rerank')) {
        return new Response('not found', { status: 404 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await testKnowledgeConnection({
      kind: 'reranker',
      baseUrl: 'https://router.example.com/v1',
      model: 'bge-reranker',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.durationMs).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://router.example.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('testKnowledgeConnection parser', () => {
  it('treats MinerU /health 200 as connected', async () => {
    const mockFetch = vi.fn(async () => new Response('ok', { status: 200 }));
    const result = await testKnowledgeConnection({
      kind: 'mineru',
      baseUrl: 'http://127.0.0.1:8000',
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    expect(result.durationMs).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('accepts 401 as reachable when an API key is required', async () => {
    const mockFetch = vi.fn(async () => new Response('nope', { status: 401 }));
    await expect(
      testKnowledgeConnection({
        kind: 'unstructured',
        baseUrl: 'http://127.0.0.1:8000',
        apiKey: 'sk-test',
        fetchImpl: mockFetch as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ durationMs: expect.any(Number) });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/healthcheck',
      expect.objectContaining({ headers: { authorization: 'Bearer sk-test' } }),
    );
  });
});
