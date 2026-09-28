/**
 * Discover-tab card: name, one-line purpose, kind, evidence, real Host state
 * and one primary action. Details and install consent live in the dialog.
 */
import type { ReactElement } from 'react';
import type { MarketplaceCatalogEntry, MarketplaceInstalledItem } from '@piwin/contracts';
import { Button, ProgressBar, ProgressRing } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale.js';
import { IconCheck } from '../../shell-icons.js';
import {
  availabilityLabel,
  kindLabel,
  localizedText,
  operationLabel,
  verificationLabel,
} from './marketplace-copy.js';
import { MarketplaceKindSeal } from './marketplace-kind-seal.js';
import type { MarketOperation } from './marketplace-types.js';

export type MarketplaceCatalogCardProps = {
  entry: MarketplaceCatalogEntry;
  installed: MarketplaceInstalledItem | undefined;
  operation: MarketOperation | undefined;
  locale?: DesktopLocale | undefined;
  onOpen: (entry: MarketplaceCatalogEntry) => void;
  onUpdate?: ((entry: MarketplaceCatalogEntry, installed: MarketplaceInstalledItem) => void) | undefined;
};


export function MarketplaceCatalogCard(props: MarketplaceCatalogCardProps): ReactElement {
  const { entry, installed, operation, locale } = props;
  const zh = locale === 'zh-CN';
  return (
    <div className="market-card" data-testid={`market-entry-${entry.entryId}`}>
      <div className="market-card-content">
        <div className="market-card-top">
          <MarketplaceKindSeal kind={entry.kind} />
          <div className="market-card-header-texts">
            <strong className="market-card-title" title={entry.name.en}>
              {entry.name.en}
            </strong>
            <span className="market-card-kind">{kindLabel(entry.kind, locale)}</span>
          </div>
        </div>
        <p className="market-card-desc">{localizedText(entry.summary, locale)}</p>
        {entry.examples[0] ? (
          <p className="market-card-example">
            <span>{zh ? '试试' : 'Try'}</span> {localizedText(entry.examples[0].prompt, locale)}
          </p>
        ) : null}
        {operation ? (
          // Installs report no byte progress, so the bar sweeps instead of guessing a percentage.
          <ProgressBar
            label={operationLabel(operation, locale)}
            className="market-card-progress"
            testId={`market-entry-progress-${entry.entryId}`}
          />
        ) : null}
      </div>
      <div className="market-card-footer">
        <span className="market-card-source">
          {entry.author} · {entry.sourceLabel} · {verificationLabel(entry.verification, locale)}
          {entry.requirements.some((requirement) => requirement.required)
            ? zh
              ? ' · 需前提条件'
              : ' · Prerequisites'
            : ''}
        </span>
        <div className="market-card-actions">
          {operation ? (
            <Button variant="primary" size="compact" disabled aria-busy={true}>
              <span className="market-btn-inner market-btn-installing">
                <ProgressRing size={13} strokeWidth={2.2} tone="pine" />
                <span className="market-btn-progress-label">
                  {operationLabel(operation, locale)}
                </span>
              </span>
            </Button>
          ) : installed && entry.version && installed.version && entry.version !== installed.version ? (
            <Button
              variant="primary"
              size="compact"
              onClick={(e) => {
                e.stopPropagation();
                if (props.onUpdate && installed) {
                  props.onUpdate(entry, installed);
                } else {
                  props.onOpen(entry);
                }
              }}
              title={zh ? `可更新至 v${entry.version}` : `Update available: v${entry.version}`}
            >
              {zh ? `更新至 v${entry.version}` : `Update to v${entry.version}`}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="compact"
              title={installed ? availabilityLabel(installed.availability, locale) : undefined}
              onClick={() => props.onOpen(entry)}
            >
              {installed ? (
                <span className="market-btn-inner">
                  <IconCheck width={12} height={12} aria-hidden="true" />
                  {installed.availability === 'available'
                    ? zh
                      ? '已安装'
                      : 'Installed'
                    : availabilityLabel(installed.availability, locale)}
                </span>
              ) : zh ? (
                '查看安装'
              ) : (
                'View install'
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
