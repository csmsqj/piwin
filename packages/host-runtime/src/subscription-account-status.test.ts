import { describe, expect, it } from 'vitest';
import { CLAUDE_CODE_OAUTH_PROVIDER_ID } from '@piwin/contracts';
import { buildSubscriptionAccounts } from './subscription-account-status.js';

describe('buildSubscriptionAccounts', () => {
  it('keeps extension-path Claude independent from plain Claude', () => {
    const config = { providers: [] };
    const onlyExt = buildSubscriptionAccounts(
      [{ providerId: CLAUDE_CODE_OAUTH_PROVIDER_ID, type: 'oauth' }],
      config,
    );
    expect(onlyExt.find((a) => a.providerId === 'anthropic')?.state).toBe('logged-out');
    expect(onlyExt.find((a) => a.providerId === CLAUDE_CODE_OAUTH_PROVIDER_ID)?.state).toBe(
      'logged-in',
    );

    const onlyExtra = buildSubscriptionAccounts([{ providerId: 'anthropic', type: 'oauth' }], config);
    expect(onlyExtra.find((a) => a.providerId === 'anthropic')?.state).toBe('logged-in');
    expect(onlyExtra.find((a) => a.providerId === CLAUDE_CODE_OAUTH_PROVIDER_ID)?.state).toBe(
      'logged-out',
    );
  });

  it('treats Claude Code api_key as the plan-quota login', () => {
    const accounts = buildSubscriptionAccounts(
      [{ providerId: CLAUDE_CODE_OAUTH_PROVIDER_ID, type: 'api_key' }],
      { providers: [] },
    );
    expect(accounts.find((account) => account.providerId === CLAUDE_CODE_OAUTH_PROVIDER_ID)?.state).toBe(
      'logged-in',
    );
    expect(accounts.find((account) => account.providerId === 'anthropic')?.state).toBe('logged-out');
    expect(
      buildSubscriptionAccounts([{ providerId: 'xai', type: 'api_key' }], { providers: [] }).find(
        (account) => account.providerId === 'xai',
      )?.state,
    ).toBe('logged-out');
  });

  it('marks a live devin oauth credential as logged-in', () => {
    const accounts = buildSubscriptionAccounts(
      [{ providerId: 'devin', type: 'oauth' }],
      { providers: [] },
    );
    expect(accounts.find((account) => account.providerId === 'devin')?.state).toBe('logged-in');
  });

  it('shows an extension provider only while its extension is enabled', () => {
    const credentials = [{ providerId: 'acme-cloud', type: 'oauth' as const }];
    const config = { providers: [] };
    expect(buildSubscriptionAccounts(credentials, config).some(
      (account) => account.providerId === 'acme-cloud',
    )).toBe(false);
    expect(buildSubscriptionAccounts(credentials, config, {}, [
      { providerId: 'acme-cloud', displayName: 'Acme Cloud' },
    ]).find((account) => account.providerId === 'acme-cloud')).toEqual({
      providerId: 'acme-cloud',
      surface: 'v1',
      state: 'logged-in',
      extension: { displayName: 'Acme Cloud' },
    });
  });

  it('counts an extension-stored api_key as its subscription login', () => {
    const accounts = buildSubscriptionAccounts(
      [{ providerId: 'acme-cloud', type: 'api_key' }],
      { providers: [] },
      {},
      [{ providerId: 'acme-cloud', displayName: 'Acme Cloud' }],
    );
    expect(accounts.find((account) => account.providerId === 'acme-cloud')?.state).toBe('logged-in');
  });
});
