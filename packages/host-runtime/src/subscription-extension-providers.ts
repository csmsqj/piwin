/**
 * Exact enabled managed extension revisions allowed to contribute OAuth providers.
 *
 * Any extension may claim one subscription provider through `piwin.json`
 * (`authProvider`, optional `authProviderName`). The Host treats the claim
 * generically: no provider id is special-cased here or downstream.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isValidExtensionAuthProviderId } from '@piwin/contracts';
import { createExtensionRevisionStore } from '@piwin/extensions';

export type SubscriptionExtensionProvider = {
  providerId: string;
  entryPath: string;
  /** Manifest `authProviderName`; the auth port falls back to Pi's registration name. */
  displayName?: string;
};

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
    const manifest = await readPiwinManifest(selected.packageRoot);
    if (!manifest) continue;
    const claim = parseAuthProviderClaim(manifest);
    if (claim === undefined) continue;
    if (claim === 'invalid') {
      console.warn(
        `[piwin-host] extension ${record.id} declares an invalid or reserved authProvider; ignored`,
      );
      continue;
    }
    // A single provider ID may only have one owner in the auth runtime.
    if (providers.some((provider) => provider.providerId === claim.providerId)) {
      throw new Error(`Multiple enabled extensions claim the ${claim.providerId} auth provider`);
    }
    providers.push({
      providerId: claim.providerId,
      entryPath: selected.entryPath,
      ...(claim.displayName !== undefined ? { displayName: claim.displayName } : {}),
    });
  }
  return providers;
}

/** Missing manifest is normal (most extensions are not auth providers). */
async function readPiwinManifest(packageRoot: string): Promise<Record<string, unknown> | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(packageRoot, 'piwin.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[piwin-host] cannot read ${join(packageRoot, 'piwin.json')}; ignored`, error);
    }
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    console.warn(`[piwin-host] ${join(packageRoot, 'piwin.json')} is not valid JSON; ignored`);
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  return parsed as Record<string, unknown>;
}

export function parseAuthProviderClaim(
  manifest: Record<string, unknown>,
): { providerId: string; displayName?: string } | 'invalid' | undefined {
  const providerId = manifest['authProvider'];
  if (providerId === undefined) return undefined;
  if (typeof providerId !== 'string' || !isValidExtensionAuthProviderId(providerId)) {
    return 'invalid';
  }
  const name = manifest['authProviderName'];
  const displayName = typeof name === 'string' && name.trim() ? name.trim() : undefined;
  return displayName !== undefined ? { providerId, displayName } : { providerId };
}
