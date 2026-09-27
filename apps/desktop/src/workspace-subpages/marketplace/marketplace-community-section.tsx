import { useMemo, useState, type ReactElement } from 'react';
import type { MarketplaceInstalledItem, MarketplaceSearchHit } from '@piwin/contracts';
import { normalizeResourceId } from '@piwin/contracts';
import type { DesktopLocale } from '../../desktop-locale.js';
import { MarketplacePiPackageCard } from './marketplace-pi-package-card.js';
import type { MarketKindFilter, MarketplaceToast } from './marketplace-types.js';
import type { MarketplacePackageInstallState } from './use-marketplace-package-install.js';
import type { MarketplaceEcosystemSearch } from './use-marketplace-ecosystem-search.js';

export type MarketplaceCommunitySectionProps = {
  locale?: DesktopLocale | undefined;
  kindFilter?: MarketKindFilter | undefined;
  ecosystem: MarketplaceEcosystemSearch;
  installedItems: readonly MarketplaceInstalledItem[];
  installStates: Record<string, MarketplacePackageInstallState>;
  onInstall: (hit: MarketplaceSearchHit) => void;
  showToast: (toast: MarketplaceToast) => void;
};

export function MarketplaceCommunitySection(props: MarketplaceCommunitySectionProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, zhText: string) => (zh ? zhText : en);
  const [showAll, setShowAll] = useState(false);
  const { ecosystem } = props;
  const installedIds = useMemo(
    () =>
      new Set(
        props.installedItems.flatMap((item) =>
          item.removal?.command === 'marketplace/package-remove' ? [item.capabilityId] : [],
        ),
      ),
    [props.installedItems],
  );
  const isInstalled = (hit: MarketplaceSearchHit): boolean => {
    const namespace = normalizeResourceId(hit.name);
    return [...installedIds].some((id) => id === namespace || id.startsWith(`${namespace}-`));
  };

  const filteredHits = useMemo(() => {
    if (!props.kindFilter || props.kindFilter === 'all') return ecosystem.hits;
    if (props.kindFilter === 'piwin-extension') return [];
    return ecosystem.hits.filter((hit) => {
      if (props.kindFilter === 'mcp') {
        return hit.kind === 'mcp' || hit.source === 'mcp-registry';
      }
      if (props.kindFilter === 'skill') {
        return hit.kind === 'skill' || hit.source === 'skill';
      }
      if (props.kindFilter === 'extension') {
        return (
          hit.kind === 'extension' ||
          (!hit.kind && (hit.source === 'npm-pi-package' || hit.source === 'github'))
        );
      }
      return true;
    });
  }, [ecosystem.hits, props.kindFilter]);

  const copyInstall = (hit: MarketplaceSearchHit): void => {
    void navigator.clipboard.writeText(hit.installCommand).then(
      () =>
        props.showToast({
          type: 'success',
          title: t('Command copied', '已复制命令'),
          text: hit.installCommand,
        }),
      () =>
        props.showToast({
          type: 'error',
          title: t('Copy failed', '复制失败'),
          text: hit.installCommand,
        }),
    );
  };

  return (
    <section className="market-ecosystem" data-testid="marketplace-ecosystem">
      <header className="market-section-header market-community-header">
        <div className="market-ecosystem-title-row">
          <h2 className="market-ecosystem-title">
            {ecosystem.searchedQuery
              ? t('Ecosystem search results', '生态检索结果')
              : t('Community Pi packages', '社区 Pi 包')}
          </h2>
          <span className="market-community-unverified">{t('Unreviewed', '未审核')}</span>
          <span className="market-section-caption">
            {ecosystem.searchedQuery
              ? t(
                  `Results from npm, GitHub, MCP Registry and Skill store for “${ecosystem.searchedQuery}”`,
                  `npm、GitHub、MCP Registry 与 Skill 技能库中“${ecosystem.searchedQuery}”的结果`,
                )
              : t(
                  'pi-package on npm and GitHub, sorted by popularity',
                  'npm 上的 pi-package 与 GitHub topic:pi-package，按热度排序',
                )}
          </span>
        </div>
        {!ecosystem.searchedQuery &&
        !showAll &&
        filteredHits.length > 0 &&
        filteredHits.length <= 4 ? (
          <button
            type="button"
            className="market-view-all"
            onClick={() => {
              setShowAll(true);
              void ecosystem.browse(20);
            }}
          >
            {t('View all →', '查看全部 →')}
          </button>
        ) : null}
      </header>
      {ecosystem.loading && filteredHits.length === 0 ? (
        <p className="market-ecosystem-status" data-testid="marketplace-ecosystem-loading">
          {t('Searching npm and GitHub…', '正在搜索 npm 与 GitHub…')}
        </p>
      ) : null}
      {filteredHits.length > 0 ? (
        <div className="market-community-grid">
          {filteredHits.map((hit) => (
            <MarketplacePiPackageCard
              key={hit.entryId}
              hit={hit}
              locale={props.locale}
              onCopyInstall={copyInstall}
              onInstall={props.onInstall}
              installState={
                props.installStates[hit.entryId] ?? (isInstalled(hit) ? 'installed' : 'idle')
              }
            />
          ))}
        </div>
      ) : null}
      {!ecosystem.loading && filteredHits.length === 0 && ecosystem.searchedQuery ? (
        <p className="market-ecosystem-status" data-testid="marketplace-ecosystem-empty">
          {t('No community packages found.', '未找到相关的社区包。')}
        </p>
      ) : null}
      {!ecosystem.loading && filteredHits.length === 0 && !ecosystem.searchedQuery ? (
        <p className="market-ecosystem-status">
          {t('Community packages are unavailable right now.', '暂时无法获取社区包。')}
        </p>
      ) : null}
    </section>
  );
}
