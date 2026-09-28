/**
 * Provider "Test connection" verdict (`models/test-connection`).
 *
 * Catalog and connectivity are separate questions (same split CLIProxyAPI
 * makes): many gateways — e.g. Volcengine Ark Agent Plan `/api/plan/v3` —
 * chat fine but expose no usable `/models`. So:
 *
 * 1. With a chat model to try → one minimal generation request through the
 *    same URL + transport Pi uses (`testProviderModel`). This is the truth.
 * 2. No model yet → catalog discovery, where 404/405/non-list is reported as
 *    `catalog-unavailable` (add IDs manually), not as a connection failure.
 */
import type {
  ModelProviderConfig,
  ProviderConnectionTestOutcome,
  ProviderConnectionTestResult,
} from '@piwin/contracts';
import { formatError, isModelEnabled, modelSupportsCapability } from '@piwin/contracts';
import {
  ProviderModelDiscoveryError,
  buildDiscoveryEndpoint,
  discoverProviderModels,
} from './provider-model-discovery.js';
import { testProviderModel } from './provider-model-test.js';
import { resolveEffectiveChatApi, resolveProviderChatEndpoint } from './provider-endpoint.js';

export type ProviderConnectionTestDependencies = {
  fetch?: typeof globalThis.fetch;
  resolveSecret: (provider: ModelProviderConfig) => Promise<string | null>;
  now?: () => number;
};

export async function testProviderConnection(
  provider: ModelProviderConfig,
  requestedModelId: string | undefined,
  dependencies: ProviderConnectionTestDependencies,
): Promise<ProviderConnectionTestResult> {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const modelId = pickConnectionTestModel(provider, requestedModelId);
  const probeDependencies = {
    resolveSecret: dependencies.resolveSecret,
    ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
  };

  if (modelId) {
    const chatApi = resolveEffectiveChatApi(provider);
    const base = {
      providerId: provider.id,
      protocol: provider.protocol,
      method: 'model-test' as const,
      modelId,
      chatApi,
      ...safeEndpoint(() => resolveProviderChatEndpoint(provider, modelId, chatApi)),
    };
    try {
      const result = await testProviderModel(provider, modelId, probeDependencies);
      return {
        ...base,
        outcome: 'chat-ok',
        durationMs: result.durationMs,
        endpoint: result.endpoint,
      };
    } catch (error) {
      return {
        ...base,
        ...classifyProbeFailure(error, 'model-test'),
        durationMs: now() - startedAt,
      };
    }
  }

  const base = {
    providerId: provider.id,
    protocol: provider.protocol,
    method: 'discovery' as const,
    ...safeEndpoint(() => buildDiscoveryEndpoint(provider)),
  };
  try {
    const result = await discoverProviderModels(provider, probeDependencies);
    return {
      ...base,
      outcome: 'catalog-ok',
      modelCount: result.models.length,
      durationMs: now() - startedAt,
    };
  } catch (error) {
    return { ...base, ...classifyProbeFailure(error, 'discovery'), durationMs: now() - startedAt };
  }
}

/**
 * The caller's model when it is a usable chat model on this row, else the
 * first enabled chat model. Image/video-only entries cannot answer a chat ping.
 */
export function pickConnectionTestModel(
  provider: ModelProviderConfig,
  requestedModelId: string | undefined,
): string | undefined {
  const requested = requestedModelId?.trim();
  if (requested) {
    // An explicit ID wins even if the row does not list it yet (draft probe).
    return requested;
  }
  const firstChatModel = provider.models.find(
    (model) => isModelEnabled(model) && modelSupportsCapability(model, 'chat') && model.id.trim(),
  );
  return firstChatModel?.id.trim();
}

function classifyProbeFailure(
  error: unknown,
  method: 'model-test' | 'discovery',
): { outcome: ProviderConnectionTestOutcome; httpStatus?: number; detail: string } {
  const detail = formatError(error);
  if (!(error instanceof ProviderModelDiscoveryError)) {
    return { outcome: 'unreachable', detail };
  }
  const status = error.httpStatus;
  switch (error.failureKind) {
    case 'config':
      return { outcome: 'invalid-config', detail };
    case 'network':
    case 'timeout':
      return { outcome: 'unreachable', detail };
    case 'invalid-response':
      return method === 'discovery'
        ? { outcome: 'catalog-unavailable', ...(status ? { httpStatus: status } : {}), detail }
        : { outcome: 'model-rejected', ...(status ? { httpStatus: status } : {}), detail };
    case 'http':
      break;
  }
  const withStatus = status !== undefined ? { httpStatus: status } : {};
  if (status === 401 || status === 403) {
    return { outcome: 'auth-failed', ...withStatus, detail };
  }
  // Any other HTTP answer proves the endpoint is reachable. For discovery it
  // only means "no usable catalog here"; for a chat ping it is a real refusal.
  return {
    outcome: method === 'discovery' ? 'catalog-unavailable' : 'model-rejected',
    ...withStatus,
    detail,
  };
}

function safeEndpoint(build: () => string): { endpoint?: string } {
  try {
    return { endpoint: build() };
  } catch {
    // Invalid Base URL: the probe itself reports `invalid-config`.
    return {};
  }
}
