/** Exact enabled managed extension revisions allowed to contribute OAuth providers. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createExtensionRevisionStore } from '@piwin/extensions';

export type SubscriptionExtensionProvider = { providerId: 'commandcode'; entryPath: string };

export async function readSubscriptionExtensionProviders(
  piwinRoot: string,
): Promise<SubscriptionExtensionProvider[]> {
  const records = await createExtensionRevisionStore(piwinRoot).listRecords();
  const providers: SubscriptionExtensionProvider[] = [];
  for (const record of records) {
    if (!record.configuredEnabled || record.installationState === 'pending-removal') continue;
    const selected = record.revisions.find((revision) =>
      revision.contentRevision === record.selectedRevision && revision.state === 'installed');
    if (!selected) continue;
    let manifest: unknown;
    try {
      manifest = JSON.parse(await readFile(join(selected.packageRoot, 'piwin.json'), 'utf8')) as unknown;
    } catch {
      continue;
    }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) continue;
    if ((manifest as Record<string, unknown>)['authProvider'] !== 'commandcode') continue;
    // A single provider ID may only have one owner in the auth runtime.
    if (providers.some((provider) => provider.providerId === 'commandcode')) {
      throw new Error('Multiple enabled extensions claim the Command Code auth provider');
    }
    providers.push({ providerId: 'commandcode', entryPath: selected.entryPath });
  }
  return providers;
}
