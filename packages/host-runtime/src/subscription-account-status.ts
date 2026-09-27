import type { PiwinConfig, SubscriptionAccount, SubscriptionAccountState } from '@piwin/contracts';
import {
  CLAUDE_CODE_OAUTH_PROVIDER_ID,
  IGNORED_SUBSCRIPTION_PROVIDER_IDS,
  V1_SUBSCRIPTION_PROVIDER_IDS,
  isChannelProvider,
  isSubscriptionOauthProviderId,
} from '@piwin/contracts';
import type { SubscriptionCredentialInfo } from '@piwin/agent-host';
import { isSubscriptionAccountUsable } from './resolve-chat-model.js';

export type AccountRuntimeHint = {
  loggingInProviderId?: string;
  syncErrorProviderIds?: ReadonlySet<string>;
  needsReauthProviderIds?: ReadonlySet<string>;
};

export function oauthProviderIds(accounts: readonly SubscriptionAccount[]): Set<string> {
  return new Set(accounts.filter(isSubscriptionAccountUsable).map((account) => account.providerId));
}

export function findCollidingChannelId(
  config: Pick<PiwinConfig, 'providers'>,
  providerId: string,
): string | undefined {
  return config.providers.find(
    (provider) => provider.id === providerId && isChannelProvider(provider),
  )?.id;
}

export function buildSubscriptionAccounts(
  credentials: readonly SubscriptionCredentialInfo[],
  config: Pick<PiwinConfig, 'providers'>,
  hints: AccountRuntimeHint = {},
  extensionProviderIds: ReadonlySet<string> = new Set(),
): SubscriptionAccount[] {
  const loggedInIds = new Set(
    credentials.filter(isLiveSubscriptionCredential).map((entry) => entry.providerId),
  );
  const accounts: SubscriptionAccount[] = [];

  for (const providerId of V1_SUBSCRIPTION_PROVIDER_IDS) {
    if (providerId === 'commandcode' && !extensionProviderIds.has(providerId)) continue;
    accounts.push(
      buildAccount(providerId, 'v1', loggedInIds.has(providerId), config, hints),
    );
  }
  // Extension-path Claude — independent of v1 anthropic extra-usage card.
  accounts.push(
    buildAccount(
      CLAUDE_CODE_OAUTH_PROVIDER_ID,
      'v1',
      loggedInIds.has(CLAUDE_CODE_OAUTH_PROVIDER_ID),
      config,
      hints,
    ),
  );
  for (const providerId of IGNORED_SUBSCRIPTION_PROVIDER_IDS) {
    if (!loggedInIds.has(providerId)) {
      continue;
    }
    accounts.push(buildAccount(providerId, 'ignored', true, config, hints));
  }
  return accounts;
}

/**
 * Claude Code stores an isolated `api_key` so Pi checkAuth passes. That is still
 * the plan-quota OAuth login — do not treat it like a BYOK key.
 */
export function isLiveSubscriptionCredential(entry: {
  providerId: string;
  type: string;
}): boolean {
  if (entry.type === 'oauth') {
    return true;
  }
  return entry.providerId === CLAUDE_CODE_OAUTH_PROVIDER_ID && entry.type === 'api_key';
}

export function collidingV1ChannelIds(
  config: Pick<PiwinConfig, 'providers'>,
  liveAccountStates: ReadonlySet<SubscriptionAccountState>,
  accounts: readonly SubscriptionAccount[],
): ReadonlySet<string> {
  const blocked = new Set<string>();
  for (const account of accounts) {
    if (!isSubscriptionOauthProviderId(account.providerId)) {
      continue;
    }
    if (!liveAccountStates.has(account.state)) {
      continue;
    }
    blocked.add(account.providerId);
  }
  return blocked;
}

function buildAccount(
  providerId: string,
  surface: SubscriptionAccount['surface'],
  hasOauth: boolean,
  config: Pick<PiwinConfig, 'providers'>,
  hints: AccountRuntimeHint,
): SubscriptionAccount {
  const collidingChannelId = findCollidingChannelId(config, providerId);
  const state = resolveState(providerId, hasOauth, hints);
  const account: SubscriptionAccount = { providerId, surface, state };
  if (collidingChannelId !== undefined && surface === 'v1') {
    account.collidingChannelId = collidingChannelId;
  }
  return account;
}

function resolveState(
  providerId: string,
  hasOauth: boolean,
  hints: AccountRuntimeHint,
): SubscriptionAccountState {
  if (hints.loggingInProviderId === providerId) {
    return 'logging-in';
  }
  if (hints.needsReauthProviderIds?.has(providerId)) {
    return 'needs-reauth';
  }
  if (hints.syncErrorProviderIds?.has(providerId)) {
    return 'sync-error';
  }
  return hasOauth ? 'logged-in' : 'logged-out';
}
