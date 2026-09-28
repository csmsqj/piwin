import { afterEach, describe, expect, it } from 'vitest';
import {
        enrichFromCatalog,
  getModelCatalogStatus,
  installModelCatalogSnapshot,
  lookupCatalogByModelId,
  resetModelCatalogSnapshot,
  searchPiCatalog,
  searchPiImagesCatalog,
  stripModelEffortOrVariantSuffix,
} from './model-catalog-reader.js';

afterEach(() => {
        resetModelCatalogSnapshot();
});

describe('model-catalog-reader', () => {
        it('searches by model id substring and clamps limit', () => {
        const result = searchPiCatalog({ query: 'gpt', limit: 5 });
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.length).toBeLessThanOrEqual(5);
    expect(result.catalogVersion).toBeTruthy();
    for (const entry of result.entries) {
        const haystack = `${entry.modelId} ${entry.name}`.toLowerCase();
      expect(haystack.includes('gpt')).toBe(true);
    }
  });

  it('filters by inputIncludes image', () => {
        const result = searchPiCatalog({ inputIncludes: 'image', limit: 20 });
    expect(result.entries.length).toBeGreaterThan(0);
    for (const entry of result.entries) {
        expect(entry.input).toContain('image');
    }
  });

  it('looks up catalog entry by model id', () => {
        const sample = searchPiCatalog({ limit: 1 }).entries[0];
    expect(sample).toBeDefined();
    if (!sample) return;
    const found = lookupCatalogByModelId(sample.modelId);
    expect(found?.modelId).toBe(sample.modelId);
  });

  it('looks up grok-4.6 by a gateway-prefixed id', () => {
        const found = lookupCatalogByModelId('custom-openai/grok-4.6');
    expect(found?.modelId).toBe('grok-4.6');
    expect(found?.contextWindow).toBe(500_000);
  });

  it('strips thinking and tier suffixes correctly', () => {
        expect(stripModelEffortOrVariantSuffix('gemini-3.8-flash-high')).toBe('gemini-3.8-flash');
    expect(stripModelEffortOrVariantSuffix('gemini-3.1-pro-low')).toBe('gemini-3.1-pro');
    expect(stripModelEffortOrVariantSuffix('deepseek-v4.1-flash:thinking')).toBe('deepseek-v4.1-flash');
    expect(stripModelEffortOrVariantSuffix('qwen/qwen3.8-27b:free')).toBe('qwen/qwen3.8-27b');
    expect(stripModelEffortOrVariantSuffix('claude-opus-4-6_max')).toBe('claude-opus-4-6');
    expect(stripModelEffortOrVariantSuffix('standard-model')).toBe('standard-model');
  });

  it('enrichFromCatalog fills missing fields without overwriting', () => {
        const catalog = {
        catalogProviderId: 'openai',
      modelId: 'gpt-test',
      name: 'GPT Test',
      input: ['text', 'image'] as const,
      reasoning: true,
      contextWindow: 200_000,
      maxTokens: 16_384,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    const enriched = enrichFromCatalog(
      { id: 'gpt-test', contextWindow: 99_000 },
      catalog,
    );
    expect(enriched.contextWindow).toBe(99_000);
    expect(enriched.input).toEqual(['text', 'image']);
    expect(enriched.reasoning).toBe(true);
    expect(enriched.maxOutputTokens).toBe(16_384);
  });

  it('installs a snapshot that replaces Pi bootstrap search and lookup', () => {
        const bootstrap = getModelCatalogStatus();
    expect(bootstrap.source).toBe('pi-bootstrap');

    installModelCatalogSnapshot({
        source: 'models.dev',
      catalogVersion: 'models.dev@test',
      fetchedAt: '2026-09-21T00:00:00.000Z',
      entries: [
        {
          catalogProviderId: 'xai',
          modelId: 'piwin-catalog-unique-id',
          name: 'Unique Test Model',
          input: ['text'],
          reasoning: true,
          contextWindow: 42_000,
          maxTokens: 1_024,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
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
      imageEntries: [
        {
          catalogProviderId: 'xai',
          modelId: 'piwin-image-unique-id',
          name: 'Unique Image Model',
          input: ['text'],
          output: ['image'],
        },
      ],
    });

    const status = getModelCatalogStatus();
    expect(status).toEqual({
        source: 'models.dev',
      catalogVersion: 'models.dev@test',
      fetchedAt: '2026-09-21T00:00:00.000Z',
      entryCount: 2,
      imageEntryCount: 1,
    });

    const search = searchPiCatalog({ query: 'piwin-catalog-unique', limit: 5 });
    expect(search.catalogVersion).toBe('models.dev@test');
    expect(search.entries.map((entry) => entry.modelId)).toEqual(['piwin-catalog-unique-id']);
    expect(lookupCatalogByModelId('gateway/piwin-catalog-unique-id')?.contextWindow).toBe(42_000);
    expect(searchPiImagesCatalog().entries.map((entry) => entry.modelId)).toEqual([
      'piwin-image-unique-id',
    ]);

    // Suffix and bare-name lookups against catalog
    const geminiHigh = lookupCatalogByModelId('gemini-3.8-flash-high');
    expect(geminiHigh?.name).toBe('Gemini 3.8 Flash');
    expect(geminiHigh?.modelId).toBe('google/gemini-3.8-flash');

    const geminiPrefixed = lookupCatalogByModelId('custom-openai/gemini-3.8-flash-high');
    expect(geminiPrefixed?.name).toBe('Gemini 3.8 Flash');

    const searchHigh = searchPiCatalog({ query: 'gemini-3.8-flash-high', limit: 5 });
    expect(searchHigh.entries.map((entry) => entry.name)).toContain('Gemini 3.8 Flash');

    resetModelCatalogSnapshot();
    expect(getModelCatalogStatus().source).toBe('pi-bootstrap');
    expect(lookupCatalogByModelId('piwin-catalog-unique-id')).toBeUndefined();
    expect(lookupCatalogByModelId('custom-openai/grok-4.6')?.modelId).toBe('grok-4.6');
  });
});
