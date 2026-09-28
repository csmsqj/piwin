/**
 * Subscription providers owned by an extension exist in Pi only after that
 * extension calls `registerProvider`. Sessions therefore load the owning
 * extension of every usable extension account, independent of resource
 * discovery (pure-chat sessions discover nothing) and of any provider id.
 */
import type { ResourceInstance, ResourceManifest } from '@piwin/contracts';
import { isSubscriptionOauthProviderId } from '@piwin/contracts';
import type { ResolveChatModelAccounts } from './resolve-chat-model.js';
import { isSubscriptionAccountUsable } from './resolve-chat-model.js';

export function subscriptionExtensionResources(
  subscription: ResolveChatModelAccounts | undefined,
): ResourceInstance[] {
  if (!subscription?.extensionProviders) {
    return [];
  }
  const usable = new Set(
    subscription.accounts
      .filter((account) => account.extension !== undefined && isSubscriptionAccountUsable(account))
      .map((account) => account.providerId),
  );
  return subscription.extensionProviders
    .filter((provider) => usable.has(provider.providerId))
    .map((provider) => ({
      resourceId: `extension:subscription:${provider.providerId}`,
      kind: 'extension',
      name: provider.displayName ?? provider.providerId,
      path: provider.entryPath,
      source: 'user',
    }));
}

/** Append without duplicating an extension discovery already activated. */
export function withSubscriptionExtensions(
  manifest: ResourceManifest,
  subscription: ResolveChatModelAccounts | undefined,
): ResourceManifest {
  const additions = subscriptionExtensionResources(subscription).filter(
    (resource) => !manifest.extensions.some((extension) => extension.path === resource.path),
  );
  return additions.length === 0
    ? manifest
    : { ...manifest, extensions: [...manifest.extensions, ...additions] };
}

/**
 * True when the id names a subscription provider this Host knows: built-in
 * ids, or any account the Host listed (which includes extension claims).
 */
export function isKnownSubscriptionProviderId(
  providerId: string,
  subscription: ResolveChatModelAccounts | undefined,
): boolean {
  return (
    isSubscriptionOauthProviderId(providerId) ||
    (subscription?.accounts.some((account) => account.providerId === providerId) ?? false)
  );
}
