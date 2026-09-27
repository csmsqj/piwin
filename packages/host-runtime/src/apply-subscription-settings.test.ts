import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostPush } from '@piwin/contracts';
import { createDefaultPiwinConfig, savePiwinConfig } from './config-store.js';
import { applySubscriptionSettings } from './apply-subscription-settings.js';
import { SettingsService } from './settings/settings-service.js';

describe('applySubscriptionSettings', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('writes through SettingsService and emits settings/updated', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-oauth-settings-'));
    roots.push(piwinRoot);
    await savePiwinConfig(createDefaultPiwinConfig(), piwinRoot);
    const pushes: HostPush[] = [];
    const base = createDefaultPiwinConfig();
    const result = await applySubscriptionSettings({
      piwinRoot,
      next: {
        ...base,
        providers: [
          ...base.providers,
          {
            id: 'extra-channel',
            protocol: 'openai-compatible',
            name: 'Extra',
            baseUrl: 'http://127.0.0.1:9/v1',
            models: [{ id: 'm1' }],
          },
        ],
      },
      push: (message) => {
        pushes.push(message);
      },
    });
    expect(result?.changedDomains.some((change) => change.domain === 'providers')).toBe(true);
    expect(pushes.some((message) => message.type === 'settings/updated')).toBe(true);
  });

  it('derives from the latest queued config instead of reverting a concurrent save', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-oauth-settings-race-'));
    roots.push(piwinRoot);
    await savePiwinConfig(createDefaultPiwinConfig(), piwinRoot);
    const service = new SettingsService({ piwinRoot });
    const snapshot = await service.getSnapshot();
    const codeSearchWrite = service.apply({
      expectedRevision: snapshot.revision,
      mutations: [
        {
          kind: 'replace-domain',
          domain: 'codeSearch',
          value: { enabled: true, backend: 'windsurf', apiKeyRef: 'oauth:devin' },
        },
      ],
    });
    const oauthWrite = applySubscriptionSettings({
      piwinRoot,
      derive: (config) => ({
        ...config,
        providers: [
          ...config.providers,
          {
            id: 'devin',
            protocol: 'openai-compatible',
            name: 'Devin',
            baseUrl: 'https://api.devin.ai',
            models: [],
          },
        ],
      }),
    });
    await Promise.all([codeSearchWrite, oauthWrite]);
    const after = await service.getSnapshot();
    expect(after.config.codeSearch).toMatchObject({ enabled: true, apiKeyRef: 'oauth:devin' });
    expect(after.config.providers.some((provider) => provider.id === 'devin')).toBe(true);
  });
});
