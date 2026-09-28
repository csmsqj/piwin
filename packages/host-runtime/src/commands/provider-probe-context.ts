/**
 * Shared Host-side setup for provider probes (`models/discover`,
 * `models/test`, `models/test-connection`): merge the Host-owned secret source
 * over the shell's (possibly redacted) provider row and build the resolver
 * that honours a one-shot key. Keeping it in one place stops the three
 * commands drifting apart on the secret rule.
 */
import type { ModelProviderConfig } from '@piwin/contracts';
import { loadPiwinConfig } from '../config-store.js';
import { getPiwinRoot } from '../paths.js';
import { createSecretResolver } from '../secret-resolver.js';
import {
  mergeProviderSecretSource,
  resolveProviderCallSecret,
} from '../provider-discovery-auth.js';

export type ProviderProbeContext = {
  provider: ModelProviderConfig;
  resolveSecret: (provider: ModelProviderConfig) => Promise<string | null>;
};

export async function prepareProviderProbe(input: {
  piwinRoot: string | undefined;
  provider: ModelProviderConfig;
  apiKey: string | undefined;
}): Promise<ProviderProbeContext> {
  const rootDir = getPiwinRoot(input.piwinRoot);
  const secretResolver = createSecretResolver({ piwinRoot: rootDir });
  const oneShotApiKey = input.apiKey?.trim();
  const config = await loadPiwinConfig(rootDir);
  const persisted = config.providers.find((entry) => entry.id === input.provider.id);
  return {
    provider: mergeProviderSecretSource(input.provider, persisted),
    resolveSecret: async (candidate) =>
      resolveProviderCallSecret({
        provider: candidate,
        ...(oneShotApiKey ? { oneShotApiKey } : {}),
        resolveSecret: (source) => secretResolver.resolveProviderSecret(source),
      }),
  };
}
