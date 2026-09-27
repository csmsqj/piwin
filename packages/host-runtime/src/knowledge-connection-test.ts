/**
 * Host-side connectivity probes for knowledge endpoints (embedding, reranker,
 * parser). Moved out of the desktop renderer: the WebView CSP pins
 * `connect-src` to `'self'`/`ipc:`, so those fetches were blocked before they
 * left the app and every "Test connection" click failed.
 *
 * These probes are deliberately shallow — one round trip that proves the
 * endpoint, the credentials and the model id agree. They never write config and
 * never log a key.
 */
import type { KnowledgeConnectionTestKind, KnowledgeConnectionTestResult } from '@piwin/contracts';

const TEST_TIMEOUT_MS = 15_000;
const TIMEOUT_MESSAGE = 'Connection timed out after 15s';

export type KnowledgeEmbeddingTestOptions = {
  provider: 'openai-compatible' | 'ollama';
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  fetchImpl?: typeof globalThis.fetch | undefined;
};

export type KnowledgeRerankerTestOptions = {
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  fetchImpl?: typeof globalThis.fetch | undefined;
};

export type KnowledgeParserTestOptions = {
  kind: 'mineru' | 'unstructured';
  baseUrl: string;
  apiKey?: string | undefined;
  fetchImpl?: typeof globalThis.fetch | undefined;
};

export type KnowledgeConnectionTestInput = {
  kind: KnowledgeConnectionTestKind;
  baseUrl: string;
  provider?: 'openai-compatible' | 'ollama' | undefined;
  model?: string | undefined;
  apiKey?: string | undefined;
  fetchImpl?: typeof globalThis.fetch | undefined;
};

/**
 * Runs the probe for `kind`. Parser kinds ignore `model`; the embedding and
 * reranker kinds require one and say so before spending a round trip.
 */
export async function testKnowledgeConnection(
  input: KnowledgeConnectionTestInput,
): Promise<KnowledgeConnectionTestResult> {
  if (input.kind === 'embedding') {
    return testKnowledgeEmbedding({
      provider: input.provider ?? 'openai-compatible',
      baseUrl: input.baseUrl,
      model: input.model ?? '',
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
  }
  if (input.kind === 'reranker') {
    return testKnowledgeReranker({
      baseUrl: input.baseUrl,
      model: input.model ?? '',
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
  }
  return testKnowledgeParser({
    kind: input.kind,
    baseUrl: input.baseUrl,
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });
}

async function testKnowledgeEmbedding(
  options: KnowledgeEmbeddingTestOptions,
): Promise<KnowledgeConnectionTestResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
  const model = options.model.trim();

  if (!baseUrl) {
    throw new Error('Base URL is required');
  }
  if (!model) {
    throw new Error('Model ID is required');
  }

  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const { response, payload } = await requestEmbedding(fetchImpl, controller, {
      provider: options.provider,
      baseUrl,
      model,
      apiKey: options.apiKey,
    });

    if (!response.ok) {
      throw new Error(await extractErrorMessage(response));
    }

    const dim = payload.embeddings?.[0]?.length ?? payload.data?.[0]?.embedding?.length;

    return {
      durationMs: Math.max(1, Math.round(performance.now() - start)),
      ...(dim !== undefined ? { dimension: dim } : {}),
    };
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(TIMEOUT_MESSAGE);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

type EmbeddingPayload = {
  embeddings?: number[][];
  data?: Array<{ embedding?: number[] }>;
};

/**
 * Ollama's native shape first (`/api/embed`), then OpenAI-compatible
 * `/embeddings`. Some OpenAI-shaped gateways are reached through the Ollama
 * provider entry, and the fallback is what tells them apart.
 */
async function requestEmbedding(
  fetchImpl: typeof globalThis.fetch,
  controller: AbortController,
  target: {
    provider: 'openai-compatible' | 'ollama';
    baseUrl: string;
    model: string;
    apiKey: string | undefined;
  },
): Promise<{ response: Response; payload: EmbeddingPayload }> {
  if (target.provider === 'ollama') {
    let response = await fetchImpl(`${target.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: target.model, input: ['ping'] }),
      signal: controller.signal,
    }).catch((err) => {
      if (controller.signal.aborted) {
        throw new Error('Request timed out after 15s');
      }
      throw err;
    });

    if (!response.ok) {
      const fallback = await fetchImpl(`${target.baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: target.model, input: 'ping' }),
        signal: controller.signal,
      }).catch(() => null);
      if (fallback?.ok) {
        response = fallback;
      }
    }

    if (!response.ok) {
      return { response, payload: {} };
    }
    return { response, payload: (await response.json()) as EmbeddingPayload };
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const apiKey = target.apiKey?.trim();
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const response = await fetchImpl(`${target.baseUrl}/embeddings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: target.model, input: 'ping' }),
    signal: controller.signal,
  }).catch((err) => {
    if (controller.signal.aborted) {
      throw new Error('Request timed out after 15s');
    }
    throw err;
  });

  if (!response.ok) {
    return { response, payload: {} };
  }
  return { response, payload: (await response.json()) as EmbeddingPayload };
}

async function testKnowledgeReranker(
  options: KnowledgeRerankerTestOptions,
): Promise<KnowledgeConnectionTestResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
  const model = options.model.trim();

  if (!baseUrl) {
    throw new Error('Base URL is required');
  }
  if (!model) {
    throw new Error('Model ID is required');
  }

  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.apiKey?.trim()) {
      headers.authorization = `Bearer ${options.apiKey.trim()}`;
    }

    const response = await fetchImpl(`${baseUrl}/rerank`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, query: 'ping', documents: ['ping'], top_n: 1 }),
      signal: controller.signal,
    }).catch((err) => {
      if (controller.signal.aborted) {
        throw new Error('Request timed out after 15s');
      }
      throw err;
    });

    if (response.ok) {
      return { durationMs: elapsed(start) };
    }

    // A gateway without /rerank still ranks through chat/completions; that is
    // also the path `createHttpReranker` falls back to at query time.
    if (response.status === 404 || response.status === 405) {
      if (await probeChatFallback(fetchImpl, controller, baseUrl, model, headers)) {
        return { durationMs: elapsed(start) };
      }
      throw new Error(await extractErrorMessage(response));
    }

    throw new Error(await extractErrorMessage(response));
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(TIMEOUT_MESSAGE);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function probeChatFallback(
  fetchImpl: typeof globalThis.fetch,
  controller: AbortController,
  baseUrl: string,
  model: string,
  headers: Record<string, string>,
): Promise<boolean> {
  const endpoint = baseUrl.endsWith('/v1')
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    }),
    signal: controller.signal,
  }).catch((err) => {
    if (controller.signal.aborted) {
      throw new Error('Request timed out after 15s');
    }
    throw err;
  });

  return response.ok;
}

/**
 * Reachability only. A parser service that answers 401 is running and
 * configured — the key is validated by the real ingest, not by the probe.
 */
async function testKnowledgeParser(
  options: KnowledgeParserTestOptions,
): Promise<KnowledgeConnectionTestResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('Base URL is required');
  }

  const start = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  const headers: Record<string, string> = {};
  if (options.apiKey?.trim()) {
    headers.authorization = `Bearer ${options.apiKey.trim()}`;
  }

  const paths =
    options.kind === 'mineru' ? ['/health', '/docs', ''] : ['/healthcheck', '/health', '/docs', ''];

  try {
    let lastError = 'No HTTP response';
    for (const path of paths) {
      try {
        const response = await fetchImpl(`${baseUrl}${path}`, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        if (response.status < 500) {
          return { durationMs: elapsed(start) };
        }
        lastError = await extractErrorMessage(response);
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error(TIMEOUT_MESSAGE);
        }
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    throw new Error(lastError);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(TIMEOUT_MESSAGE);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function elapsed(start: number): number {
  return Math.max(1, Math.round(performance.now() - start));
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (text) {
      try {
        const json = JSON.parse(text) as {
          error?: { message?: string } | string;
          message?: string;
        };
        if (typeof json.error === 'string') return json.error;
        if (json.error?.message) return json.error.message;
        if (json.message) return json.message;
      } catch {
        return text.slice(0, 160);
      }
    }
  } catch {
    // Body already consumed or unreadable — the status line still tells the story.
  }
  return `HTTP ${response.status} ${response.statusText || 'request rejected'}`;
}
