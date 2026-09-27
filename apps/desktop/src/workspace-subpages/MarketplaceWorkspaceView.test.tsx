// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type {
  HostCommand,
  HostResponse,
  HostServerMessage,
  MarketplaceCatalogEntry,
  MarketplaceInstalledItem,
} from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { findButton, flush, setInputValue } from './workspace-subpages-test-helpers.js';
import { MarketplaceWorkspaceView } from './MarketplaceWorkspaceView.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SKILL_ENTRY: MarketplaceCatalogEntry = {
  entryId: 'skill:doc-coauthoring',
  capabilityId: 'doc-coauthoring',
  kind: 'skill',
  category: 'docs-research',
  name: { en: 'doc-coauthoring', zhCN: '文档协作写作' },
  summary: { en: 'Structured docs', zhCN: '结构化写文档' },
  description: { en: 'Structured docs', zhCN: '结构化写文档' },
  version: 'a'.repeat(40),
  author: 'Anthropic',
  sourceLabel: 'GitHub',
  install: {
    kind: 'skill',
    source: { kind: 'git', url: 'https://github.com/anthropics/skills.git', ref: 'a'.repeat(40) },
  },
  requirements: [],
  examples: [
    {
      title: { en: 'Write', zhCN: '写提案' },
      prompt: { en: 'Write a proposal', zhCN: '帮我写提案' },
    },
  ],
  verification: [{ level: 'author-declared' }],
  featured: true,
};

const EXTENSION_ENTRY: MarketplaceCatalogEntry = {
  ...SKILL_ENTRY,
  entryId: 'extension:pi-lens',
  capabilityId: 'pi-lens',
  kind: 'extension',
  category: 'code-development',
  name: { en: 'pi-lens', zhCN: 'pi-lens 代码反馈' },
  summary: { en: 'Code feedback', zhCN: '代码反馈' },
  version: '4.2.1',
  sourceLabel: 'npm',
  install: {
    kind: 'pi-package',
    source: { kind: 'npm', packageName: 'pi-lens', version: '4.2.1' },
  },
};

type FakeHost = {
  request: ReturnType<typeof vi.fn>;
  commands: () => HostCommand[];
  setItems: (items: MarketplaceInstalledItem[]) => void;
  emit: (message: HostServerMessage) => void;
  subscribe: (listener: (message: HostServerMessage) => void) => () => void;
};

function ok(command: string, data: unknown): HostResponse {
  return { type: 'response', command, success: true, data };
}

function createFakeHost(
  overrides: Partial<Record<HostCommand['type'], (command: HostCommand) => HostResponse>> = {},
): FakeHost {
  let items: MarketplaceInstalledItem[] = [];
  const listeners = new Set<(message: HostServerMessage) => void>();
  const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
    const override = overrides[command.type];
    if (override) return override(command);
    switch (command.type) {
      case 'marketplace/catalog-list':
        return ok(command.type, { entries: [EXTENSION_ENTRY, SKILL_ENTRY] });
      case 'marketplace/installed-list':
        return ok(command.type, { revision: String(items.length), items });
      default:
        return ok(command.type, {});
    }
  });
  return {
    request,
    commands: () => request.mock.calls.map(([command]) => command as HostCommand),
    setItems: (next) => {
      items = next;
    },
    emit: (message) => {
      for (const listener of listeners) listener(message);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function installedItem(overrides: Partial<MarketplaceInstalledItem>): MarketplaceInstalledItem {
  return {
    installationKey: 'skill:doc-coauthoring',
    capabilityId: 'doc-coauthoring',
    kind: 'skill',
    name: 'doc-coauthoring',
    catalogEntryId: 'skill:doc-coauthoring',
    availability: 'available',
    enabled: true,
    source: 'user',
    canToggle: true,
    removal: { command: 'skills/uninstall' },
    ...overrides,
  };
}

describe('MarketplaceWorkspaceView', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  function render(
    host: FakeHost,
    extra: { sessionId?: string; onUseExample?: (text: string) => void } = {},
  ): void {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MarketplaceWorkspaceView
            locale="zh-CN"
            onClose={vi.fn()}
            request={host.request}
            subscribeHostMessages={host.subscribe}
            {...(extra.sessionId ? { sessionId: extra.sessionId } : {})}
            {...(extra.onUseExample ? { onUseExample: extra.onUseExample } : {})}
          />
        </PiwinUiProvider>,
      );
    });
  }

  it('renders the Host catalog in one full-width discovery grid, with no simulated runtime badge', async () => {
    const host = createFakeHost();
    render(host);
    await flush();

    expect(host.commands().map((command) => command.type)).toEqual(
      expect.arrayContaining(['marketplace/catalog-list', 'marketplace/installed-list']),
    );
    expect(container.querySelector('[data-testid="marketplace-catalog"]')).not.toBeNull();
    expect(
      container
        .querySelector('[data-testid="marketplace-search-input"]')
        ?.closest('.market-filter-row'),
    ).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll('[data-testid^="market-entry-"]')).map((node) =>
        node.getAttribute('data-testid'),
      ),
    ).toEqual(['market-entry-extension:pi-lens', 'market-entry-skill:doc-coauthoring']);
    expect(container.querySelector('.market-card-source')?.textContent).toContain('作者声明');
    expect(
      Array.from(container.querySelectorAll('.market-category-section .market-card-title')).map(
        (node) => node.textContent,
      ),
    ).toEqual(['pi-lens', 'doc-coauthoring']);
    expect(container.querySelector('[data-testid="marketplace-catalog"]')?.textContent).toContain(
      '固定来源',
    );
    expect(container.textContent).not.toContain('Runtime Gen');
  });

  it('shows a small real community preview on opening Discover', async () => {
    const host = createFakeHost({
      'marketplace/search': (command) =>
        ok(command.type, {
          query: '',
          hits: [
            {
              entryId: 'npm:pi-example',
              name: 'pi-example',
              version: '1.0.0',
              description: 'Example package',
              source: 'npm-pi-package',
              installCommand: 'pi install npm:pi-example',
            },
            {
              entryId: 'github:missing-source',
              name: 'missing-source',
              version: '',
              description: 'Repository URL is missing',
              source: 'github',
              installCommand: 'pi install git:missing-source',
            },
          ],
        }),
    });
    render(host);
    await flush();

    expect(host.commands()).toContainEqual({ type: 'marketplace/search', query: '', limit: 4 });
    expect(container.querySelector('[data-testid="marketplace-ecosystem"]')?.textContent).toContain(
      'pi-example',
    );
    expect(container.querySelector('.market-community-grid .market-community-card')).not.toBeNull();
    expect(container.querySelector('.market-community-name')?.textContent).toBe('pi-example');
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="market-github-missing-source-install"]',
      )?.disabled,
    ).toBe(true);
    expect(
      (container
        .querySelector('[data-testid="marketplace-ecosystem"]')
        ?.compareDocumentPosition(
          container.querySelector('[data-testid="marketplace-catalog"]') ?? container,
        ) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    act(() => {
      findButton(
        container.querySelector('[data-testid="marketplace-ecosystem"]') ?? container,
        '查看全部',
      )?.click();
    });
    await flush();
    expect(host.commands()).toContainEqual({ type: 'marketplace/search', query: '', limit: 20 });
  });

  it('installs a Skill through skills/install and shows the Host-reported state afterwards', async () => {
    const host = createFakeHost({
      'skills/install': (command) => {
        host.setItems([installedItem({})]);
        return ok(command.type, { skillId: 'doc-coauthoring', targetPath: '/tmp/x' });
      },
    });
    render(host);
    await flush();

    const card = container.querySelector('[data-testid="market-entry-skill:doc-coauthoring"]');
    act(() => {
      findButton(card ?? container, '安装')?.click();
    });
    const dialog = document.querySelector('[data-testid="marketplace-entry-dialog"]');
    expect(dialog?.textContent).toContain('可能附带');
    act(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="marketplace-entry-install"]')
        ?.click();
    });
    await flush();

    expect(host.commands()).toContainEqual({
      type: 'skills/install',
      source: SKILL_ENTRY.install.kind === 'skill' ? SKILL_ENTRY.install.source : undefined,
    });
    expect(card?.textContent).toContain('已安装');
  });

  it('installs a pinned Pi package and says it is queued, not live, while the run continues', async () => {
    const host = createFakeHost({
      'extensions/apply': (command) =>
        ok(command.type, {
          sessionId: 's1',
          deploymentId: 'd1',
          state: 'waiting-current-run',
          when: 'after-current-run',
          registryRevision: 'r',
        }),
    });
    render(host, { sessionId: 's1' });
    await flush();

    act(() => {
      findButton(
        container.querySelector('[data-testid="market-entry-extension:pi-lens"]') ?? container,
        '安装',
      )?.click();
    });
    act(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="marketplace-entry-install"]')
        ?.click();
    });
    await flush();

    const sent = host.commands();
    expect(sent).toContainEqual({
      type: 'marketplace/package-install',
      source: { kind: 'npm', packageName: 'pi-lens', version: '4.2.1' },
    });
    expect(sent).toContainEqual({
      type: 'extensions/apply',
      sessionId: 's1',
      when: 'after-current-run',
    });
    expect(document.body.textContent).toContain('当前任务结束后同步到本会话');
    expect(document.body.textContent).not.toContain('已无缝就绪');
  });

  it('reports a failed install as failure and leaves the entry uninstalled', async () => {
    const host = createFakeHost({
      'skills/install': (command) => ({
        type: 'response',
        command: command.type,
        success: false,
        error: 'git clone failed',
      }),
    });
    render(host);
    await flush();
    act(() => {
      findButton(
        container.querySelector('[data-testid="market-entry-skill:doc-coauthoring"]') ?? container,
        '安装',
      )?.click();
    });
    act(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="marketplace-entry-install"]')
        ?.click();
    });
    await flush();

    expect(document.body.textContent).toContain('git clone failed');
    expect(
      container.querySelector('[data-testid="market-entry-skill:doc-coauthoring"]')?.textContent,
    ).not.toContain('当前可用');
  });

  it('uninstalls from the Installed tab only after confirmation, using the Host removal route', async () => {
    const host = createFakeHost({
      'skills/uninstall': (command) => {
        host.setItems([]);
        return ok(command.type, { skillId: 'doc-coauthoring' });
      },
    });
    host.setItems([installedItem({ availability: 'pending-apply', message: 'Applies later' })]);
    render(host);
    await flush();

    act(() => {
      setInputValue(
        container.querySelector<HTMLInputElement>('[data-testid="marketplace-search-input"]'),
        'no-match',
      );
    });
    act(() => {
      findButton(container, '已安装')?.click();
    });
    const row = container.querySelector('[data-testid="market-installed-skill:doc-coauthoring"]');
    expect(row?.textContent).toContain('待应用');
    act(() => {
      findButton(row ?? container, '卸载')?.click();
    });
    expect(host.commands().some((command) => command.type === 'skills/uninstall')).toBe(false);
    act(() => {
      findButton(
        document.querySelector('[data-testid="marketplace-remove-confirm"]') ?? document.body,
        '卸载',
      )?.click();
    });
    await flush();

    expect(host.commands()).toContainEqual({
      type: 'skills/uninstall',
      skillId: 'doc-coauthoring',
    });
    expect(
      container.querySelector('[data-testid="market-installed-skill:doc-coauthoring"]'),
    ).toBeNull();
  });

  it('re-reads the inventory when the Host pushes an inventory change', async () => {
    const host = createFakeHost();
    render(host);
    await flush();
    const before = host
      .commands()
      .filter((command) => command.type === 'marketplace/installed-list').length;

    host.setItems([installedItem({})]);
    act(() => {
      host.emit({ type: 'marketplace/inventory-updated', revision: '1', changedKinds: ['skill'] });
    });
    await flush();

    const after = host
      .commands()
      .filter((command) => command.type === 'marketplace/installed-list').length;
    expect(after).toBe(before + 1);
    expect(
      container.querySelector('[data-testid="market-entry-skill:doc-coauthoring"]')?.textContent,
    ).toContain('已安装');
  });

  it('offers the example request to the composer once the capability is usable', async () => {
    const host = createFakeHost();
    host.setItems([installedItem({})]);
    const onUseExample = vi.fn();
    render(host, { onUseExample });
    await flush();
    act(() => {
      findButton(
        container.querySelector('[data-testid="market-entry-skill:doc-coauthoring"]') ?? container,
        '已安装',
      )?.click();
    });
    act(() => {
      findButton(
        document.querySelector('[data-testid="marketplace-entry-dialog"]') ?? document.body,
        '填入输入框',
      )?.click();
    });
    expect(onUseExample).toHaveBeenCalledWith('帮我写提案');
  });

  it('shows a Host read failure instead of pretending the inventory is empty', async () => {
    const host = createFakeHost({
      'marketplace/installed-list': (command) => ({
        type: 'response',
        command: command.type,
        success: false,
        error: 'host offline',
      }),
    });
    render(host);
    await flush();
    expect(
      container.querySelector('[data-testid="marketplace-host-error"]')?.textContent,
    ).toContain('host offline');
  });

  it('does not search ecosystem on typing alone, but adds results on Enter or search submit', async () => {
    const host = createFakeHost({
      'marketplace/search': (command) =>
        ok(command.type, {
          query: 'lens',
          hits: [
            {
              entryId: 'npm:pi-lens-extra',
              name: 'pi-lens-extra',
              version: '1.0.0',
              description: 'x',
              source: 'npm-pi-package',
              installCommand: 'pi install npm:pi-lens-extra',
            },
          ],
        }),
    });
    render(host);
    await flush();

    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="marketplace-search-input"]',
    );
    act(() => {
      setInputValue(input, 'lens');
    });
    await flush();

    // Local catalog is filtered immediately without network request:
    expect(
      container.querySelector('[data-testid="market-entry-extension:pi-lens"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="market-entry-skill:doc-coauthoring"]'),
    ).toBeNull();
    expect(container.querySelector('.market-page-intro')).toBeNull();
    // The page loads a community preview; typing does not launch another request.
    expect(host.commands().filter((c) => c.type === 'marketplace/search')).toHaveLength(1);
    expect(container.querySelector('[data-testid="marketplace-ecosystem"]')).toBeNull();

    // Submit search via Enter key:
    act(() => {
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await flush();

    expect(host.commands().filter((c) => c.type === 'marketplace/search')).toHaveLength(2);
    expect(container.querySelector('[data-testid="marketplace-ecosystem"]')?.textContent).toContain(
      'pi-lens-extra',
    );
  });

  it('reports ecosystem search errors via toast and does not render in-page notice banner', async () => {
    const host = createFakeHost({
      'marketplace/search': (command) =>
        ok(command.type, {
          query: 'failing-package',
          hits: [],
          remoteError: 'GitHub: GitHub search failed: HTTP 403',
        }),
    });
    render(host);
    await flush();

    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="marketplace-search-input"]',
    );
    act(() => {
      setInputValue(input, 'failing-package');
    });
    await flush();

    // Submit via clickable search button:
    const submitBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="vault-search-submit-btn"]',
    );
    expect(submitBtn).not.toBeNull();
    act(() => {
      submitBtn?.click();
    });
    await flush();

    // In-page Notice banner must NOT be rendered:
    expect(container.querySelector('[data-testid="marketplace-ecosystem-error"]')).toBeNull();
    // Toast must show the error:
    expect(document.body.textContent).toContain('GitHub: GitHub search failed: HTTP 403');
  });

  it('installs a live community card only after showing its source and confirmation', async () => {
    const host = createFakeHost({
      'marketplace/search': (command) =>
        ok(command.type, {
          query: '',
          hits: [
            {
              entryId: 'npm:pi-example',
              name: 'pi-example',
              version: '1.0.0',
              description: 'Example package',
              source: 'npm-pi-package',
              installCommand: 'pi install npm:pi-example',
            },
          ],
        }),
    });
    render(host);
    await flush();

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="market-npm-pi-example-install"]')
        ?.click();
    });
    expect(host.commands().some((command) => command.type === 'marketplace/package-install')).toBe(
      false,
    );
    expect(
      document.querySelector('[data-testid="marketplace-package-install-dialog"]')?.textContent,
    ).toContain('pi-example');

    act(() => {
      findButton(
        document.querySelector('[data-testid="marketplace-package-install-dialog"]') ??
          document.body,
        '确认安装',
      )?.click();
    });
    await flush();
    expect(host.commands()).toContainEqual({
      type: 'marketplace/package-install',
      source: { kind: 'npm', packageName: 'pi-example' },
    });
  });

  it('shows a progress bar on the card while installing, then an app toast', async () => {
    let finish: (() => void) | undefined;
    const host = createFakeHost({});
    host.request.mockImplementation(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'marketplace/catalog-list')
        return ok(command.type, { entries: [SKILL_ENTRY] });
      if (command.type === 'marketplace/installed-list')
        return ok(command.type, { revision: '0', items: [] });
      if (command.type === 'skills/install') {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return ok(command.type, { skillId: 'doc-coauthoring', targetPath: '/tmp/x' });
      }
      return ok(command.type, {});
    });
    render(host);
    await flush();
    act(() => {
      findButton(
        container.querySelector('[data-testid="market-entry-skill:doc-coauthoring"]') ?? container,
        '安装',
      )?.click();
    });
    act(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="marketplace-entry-install"]')
        ?.click();
    });
    await flush();
    expect(
      container.querySelector('[data-testid="market-entry-progress-skill:doc-coauthoring"]'),
    ).not.toBeNull();

    await act(async () => {
      finish?.();
    });
    await flush();
    expect(
      container.querySelector('[data-testid="market-entry-progress-skill:doc-coauthoring"]'),
    ).toBeNull();
    expect(document.body.textContent).toContain('下一条消息起即可使用');
  });

  it('renders exactly 5 featured native capabilities when present, separated from catalog', async () => {
    const featuredItems: MarketplaceCatalogEntry[] = [
      {
        ...SKILL_ENTRY,
        entryId: 'extension:ff-labs-pi-fff',
        capabilityId: 'ff-labs-pi-fff',
        kind: 'extension',
        name: { en: 'pi-fff', zhCN: 'pi-fff' },
      },
      {
        ...SKILL_ENTRY,
        entryId: 'skill:doc-coauthoring',
        capabilityId: 'doc-coauthoring',
        kind: 'skill',
        name: { en: 'doc-coauthoring', zhCN: 'doc-coauthoring' },
      },
      {
        ...SKILL_ENTRY,
        entryId: 'skill:frontend-design',
        capabilityId: 'frontend-design',
        kind: 'skill',
        name: { en: 'frontend-design', zhCN: 'frontend-design' },
      },
      {
        ...SKILL_ENTRY,
        entryId: 'skill:webapp-testing',
        capabilityId: 'webapp-testing',
        kind: 'skill',
        name: { en: 'webapp-testing', zhCN: 'webapp-testing' },
      },
      {
        ...SKILL_ENTRY,
        entryId: 'mcp:memory',
        capabilityId: 'memory',
        kind: 'mcp',
        name: { en: 'memory', zhCN: 'memory' },
      },
      {
        ...SKILL_ENTRY,
        entryId: 'skill:skill-creator',
        capabilityId: 'skill-creator',
        kind: 'skill',
        name: { en: 'skill-creator', zhCN: 'skill-creator' },
      },
    ];
    const host = createFakeHost({
      'marketplace/catalog-list': (command) => ok(command.type, { entries: featuredItems }),
    });
    render(host);
    await flush();

    const featuredSection = container.querySelector('[data-testid="marketplace-featured"]');
    expect(featuredSection).not.toBeNull();
    expect(featuredSection?.textContent).toContain('精选推荐');
    expect(featuredSection?.textContent).toContain('实测可用 · 原生支持');

    const featuredCards = featuredSection?.querySelectorAll('.market-card');
    expect(featuredCards?.length).toBe(5);

    const ecosystemSection = container.querySelector('[data-testid="marketplace-ecosystem"]');
    if (ecosystemSection && featuredSection) {
      expect(
        (featuredSection.compareDocumentPosition(ecosystemSection) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
          0,
      ).toBe(true);
    }

    const catalogSection = container.querySelector('[data-testid="marketplace-catalog"]');
    expect(catalogSection).not.toBeNull();
    expect(catalogSection?.textContent).toContain('全域能力库');
    const catalogCards = catalogSection?.querySelectorAll('.market-card');
    expect(catalogCards?.length).toBe(1);
    expect(catalogCards?.[0]?.textContent).toContain('skill-creator');
  });
});

