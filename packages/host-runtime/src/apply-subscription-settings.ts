import type { HostPush, PiwinConfig, SettingsApplyResult } from '@piwin/contracts';
import { SettingsService } from './settings/settings-service.js';

export type ApplySubscriptionSettingsInput = {
  piwinRoot?: string;
  /** Full document. Prefer {@link derive} so the write sees the latest config. */
  next?: PiwinConfig;
  /** Applied to the config read inside the settings write queue. */
  derive?: (config: PiwinConfig) => PiwinConfig;
  push?: (message: HostPush) => void;
  onApplied?: (result: SettingsApplyResult) => void;
};

/**
 * Persist OAuth-driven config (relocate / default seed / logout projection)
 * through SettingsService so revision, settings/updated, and the serialized
 * write queue stay shared.
 */
export async function applySubscriptionSettings(
  input: ApplySubscriptionSettingsInput,
): Promise<SettingsApplyResult | undefined> {
  const service = new SettingsService(
    input.piwinRoot !== undefined ? { piwinRoot: input.piwinRoot } : {},
  );
  const derive =
    input.derive ??
    (input.next !== undefined ? () => input.next as PiwinConfig : (config: PiwinConfig) => config);
  const result = await service.update(derive);
  if (result.changedDomains.length > 0) {
    input.push?.({
      type: 'settings/updated',
      revision: result.snapshot.revision,
      runtimeRevision: result.snapshot.runtimeRevision,
      changedDomains: result.changedDomains.map((impact) => impact.domain),
    });
    input.onApplied?.(result);
  }
  return result;
}
