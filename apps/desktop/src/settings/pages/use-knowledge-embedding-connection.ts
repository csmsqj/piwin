import { useState } from 'react';
import { formatError, type DiscoveredModel, type ModelDiscoveryResult } from '@piwin/contracts';
import { showErrorNotification } from '@piwin/ui-kit';
import type { SettingsContextValue } from '../settings-context.js';
import {
  NOTES_EMBEDDING_SECRET_ID,
  type KnowledgeEmbeddingDraft,
} from '../knowledge-embedding-draft.js';

type ConnectionInput = Pick<SettingsContextValue, 'request' | 'loadProviderSecret'> & {
  draft: KnowledgeEmbeddingDraft;
  isZh: boolean;
  saving: boolean;
};

export function useKnowledgeEmbeddingConnection(input: ConnectionInput): {
  discoveredModels: DiscoveredModel[];
  discovering: boolean;
  discoverModels: () => Promise<void>;
  revealKey: () => Promise<string | null>;
} {
  const [discovering, setDiscovering] = useState(false);
  const [fetched, setFetched] = useState<{ endpoint: string; models: DiscoveredModel[] } | null>(
    null,
  );
  const endpoint = `${input.draft.provider}:${input.draft.baseUrl.trim()}`;

  const discoverModels = async (): Promise<void> => {
    if (discovering || input.saving) return;
    const baseUrl = input.draft.baseUrl.trim();
    if (!baseUrl) {
      showErrorNotification(input.isZh ? '请先填写 Base URL。' : 'Enter a Base URL first.');
      return;
    }
    setFetched(null);
    setDiscovering(true);
    try {
      const response = await input.request({
        type: 'knowledge/embedding-models/discover',
        knowledgeDiscover: {
          baseUrl,
          ...(input.draft.apiKeyRef.trim() ? { apiKeyRef: input.draft.apiKeyRef.trim() } : {}),
          ...(input.draft.apiKeyEnv.trim() ? { apiKeyEnv: input.draft.apiKeyEnv.trim() } : {}),
          ...(input.draft.apiKeyInput?.trim() ? { apiKey: input.draft.apiKeyInput.trim() } : {}),
        },
      });
      if (!response.success) throw new Error(response.error || 'Model discovery failed');
      const result = response.data as ModelDiscoveryResult;
      if (!Array.isArray(result.models)) throw new Error('Invalid model list');
      setFetched({ endpoint, models: result.models });
      if (result.models.length === 0) {
        showErrorNotification(
          input.isZh
            ? '接口没有返回模型，请手动填写模型 ID。'
            : 'No models returned. Enter a model ID manually.',
        );
      }
    } catch (error) {
      showErrorNotification(
        `${input.isZh ? '拉取模型失败：' : 'Failed to fetch models: '}${formatError(error)}`,
      );
    } finally {
      setDiscovering(false);
    }
  };

  const revealKey = async (): Promise<string | null> => {
    try {
      const key = await input.loadProviderSecret(NOTES_EMBEDDING_SECRET_ID);
      if (!key) {
        showErrorNotification(
          input.isZh ? 'Host 中没有可显示的已保存密钥。' : 'No saved key is available on the Host.',
        );
      }
      return key;
    } catch (error) {
      showErrorNotification(
        `${input.isZh ? '读取密钥失败：' : 'Failed to read key: '}${formatError(error)}`,
      );
      return null;
    }
  };

  return {
    discoveredModels: fetched?.endpoint === endpoint ? fetched.models : [],
    discovering,
    discoverModels,
    revealKey,
  };
}
