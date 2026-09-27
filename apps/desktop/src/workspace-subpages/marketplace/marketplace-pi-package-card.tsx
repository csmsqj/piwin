import { useState, type ReactElement } from 'react';
import type { MarketplaceSearchHit } from '@piwin/contracts';
import { Button, ProgressRing } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale.js';
import { openExternalUrl } from '../../open-external-url.js';
import { IconCheck, IconCopy } from '../../shell-icons.js';

export type MarketplacePiPackageCardProps = {
  hit: MarketplaceSearchHit;
  locale?: DesktopLocale | undefined;
  onCopyInstall: (hit: MarketplaceSearchHit) => void;
  onInstall: (hit: MarketplaceSearchHit) => void;
  installState?: 'idle' | 'installing' | 'installed' | 'failed' | undefined;
};

export function MarketplacePiPackageCard(props: MarketplacePiPackageCardProps): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);
  const { hit } = props;
  const [copied, setCopied] = useState(false);
  const slug = (hit.source === 'github' ? hit.entryId.replace(/^github:/, '') : hit.name).replace(
    /[@/]/g,
    '-',
  );
  const sourcePrefix =
    hit.source === 'github'
      ? 'github'
      : hit.source === 'mcp-registry'
        ? 'mcp'
        : hit.source === 'skill'
          ? 'skill'
          : 'npm';
  const testId = `market-${sourcePrefix}-${slug}`;
  const installState = props.installState ?? 'idle';
  const sourceUrl =
    hit.source === 'github'
      ? hit.repositoryUrl
      : hit.source === 'mcp-registry'
        ? (hit.homepage ?? '')
        : hit.source === 'skill'
          ? (hit.repositoryUrl ?? '')
          : hit.npmUrl;
  const sourceLabel =
    hit.source === 'github'
      ? 'GitHub'
      : hit.source === 'mcp-registry'
        ? 'MCP'
        : hit.source === 'skill'
          ? 'Skill'
          : 'npm';
  const installable = hit.source !== 'github' || Boolean(hit.repositoryUrl);

  const handleCopy = () => {
    props.onCopyInstall(hit);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="market-card market-community-card" data-testid={testId}>
      <div className="market-card-content">
        <div className="market-community-card-top">
          <strong className="market-community-name">{hit.name}</strong>
          <span className="market-community-origin">{sourceLabel}</span>
        </div>
        <div className="market-community-meta">
          {hit.publisher ? <span>{hit.publisher}</span> : null}
          {hit.version ? <span>v{hit.version}</span> : null}
        </div>
        <p className="market-community-description">
          {hit.description || t('No description.', '暂无简介。')}
        </p>
        <div className="market-community-stats">
          {hit.monthlyDownloads !== undefined ? (
            <span>
              {t('Monthly downloads', '月下载')}{' '}
              {Intl.NumberFormat(props.locale).format(hit.monthlyDownloads)}
            </span>
          ) : null}
          {hit.stars !== undefined ? (
            <span>
              {t('Stars', '星标')} {Intl.NumberFormat(props.locale).format(hit.stars)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="market-card-footer market-community-footer">
        {sourceUrl ? (
          <Button
            variant="ghost"
            size="compact"
            onClick={() => void openExternalUrl(sourceUrl)}
            title={t(`Open ${sourceLabel} page`, `打开 ${sourceLabel} 页面`)}
          >
            {sourceLabel} ↗
          </Button>
        ) : (
          <span />
        )}
        <div className="market-community-actions">
          <Button
            variant="ghost"
            size="compact"
            onClick={handleCopy}
            title={t('Copy install command', '复制安装命令')}
            aria-label={t('Copy install command', '复制安装命令')}
          >
            {copied ? (
              <IconCheck width={14} height={14} aria-hidden="true" />
            ) : (
              <IconCopy width={14} height={14} aria-hidden="true" />
            )}
          </Button>
          <Button
            variant="secondary"
            size="compact"
            data-testid={`${testId}-install`}
            disabled={!installable || installState === 'installing' || installState === 'installed'}
            aria-busy={installState === 'installing'}
            onClick={() => props.onInstall(hit)}
          >
            {!installable ? (
              t('Source unavailable', '缺少来源')
            ) : installState === 'installed' ? (
              t('Installed', '已安装')
            ) : installState === 'installing' ? (
              <span className="market-btn-inner market-btn-installing">
                <ProgressRing
                  size={13}
                  strokeWidth={2.2}
                  tone="pine"
                  testId={`${testId}-progress-ring`}
                />
                {t('Installing…', '安装中…')}
              </span>
            ) : installState === 'failed' ? (
              t('Retry…', '重试…')
            ) : (
              t('Install…', '安装…')
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
