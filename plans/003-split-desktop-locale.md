# Plan 003: Split `desktop-locale.ts` catalogs from persistence

> **Executor**: Follow step by step. Run every verify before next step.
> On any STOP condition — stop and report; do not improvise.
> Update `plans/README.md` status unless a reviewer owns the index.
>
> **Drift check first**: `git diff --stat 76bcd6dd..HEAD -- apps/desktop/src/desktop-locale.ts apps/desktop/src/desktop-locale-context.tsx`
> If in-scope files changed, compare Current state excerpts to live code; mismatch → STOP.

## Status
- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `76bcd6dd`, 2026-09-24

## Why this matters

`apps/desktop/src/desktop-locale.ts` is **1702 lines** (hard cap 1000; split trigger ~400).
It mixes: locale persistence, the `DesktopCopy` type, a full zh-CN catalog, a full
en catalog, and a separately duplicated `DesktopTranslator` tree with inline
ternaries. Every copy tweak recompiles the whole module; zh/en drift is invisible.

This is the largest production source file that is a **catalog dump**, not a
facade and not generated font CSS.

## Current state

- `apps/desktop/src/desktop-locale.ts` — everything (1702 lines)
- `apps/desktop/src/desktop-locale-context.tsx` — React context; imports
  `getDesktopTranslator`, `DesktopLocale`, `DesktopTranslator` from `./desktop-locale`

```7:12:apps/desktop/src/desktop-locale.ts
export type DesktopLocale = 'zh-CN' | 'en';

const DESKTOP_LOCALE_KEY = 'piwin.desktop.locale';
const DEFAULT_DESKTOP_LOCALE: DesktopLocale = 'zh-CN';
```

```12:12:apps/desktop/src/desktop-locale.ts
export type DesktopCopy = {
```

`DesktopCopy` runs through line 358. `DesktopTranslator` starts at line 360.
`COPY_BY_LOCALE` at 614 (`zh-CN` through ~967, `en` through ~1336).
`getDesktopCopy` 1338–1340. `getDesktopTranslator` 1342–1681 (inline
`isChinese ? … : …`, **second catalog**). Persistence 1683–1702.

```1683:1702:apps/desktop/src/desktop-locale.ts
export function loadDesktopLocale(): DesktopLocale {
  try {
    const storedLocale = localStorage.getItem(DESKTOP_LOCALE_KEY);
    if (storedLocale === 'zh-CN' || storedLocale === 'en') {
      return storedLocale;
    }
  } catch {
    // Storage may be unavailable in private browsing or test environments.
  }
  return DEFAULT_DESKTOP_LOCALE;
}
```

Callers import from `./desktop-locale` or `./desktop-locale.js`:
`getDesktopCopy`, `getDesktopTranslator`, types `DesktopLocale` /
`DesktopCopy` / `DesktopTranslator`. Context file is the React seam.

**Conventions**: desktop source is kebab-case, no `utils.ts`. Re-export from
`desktop-locale.ts` so existing import paths stay valid (surgical: do not
rewrite 40+ callers). Match nearby `desktop-locale-context.tsx`. Extensionless
or `.js` — match each caller's existing specifier; new sibling files use no
extension if the parent file does (`desktop-locale-context.tsx` uses
`from './desktop-locale'`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `pnpm --dir apps/desktop typecheck` | exit 0 |
| Locale-related tests | `pnpm --dir apps/desktop exec vitest run src/desktop-locale-context.tsx src/settings/section-registry.test.ts src/settings/settings-shell.test.ts` | pass (adjust glob if a dedicated locale test exists) |
| Broader desktop smoke | `pnpm --dir apps/desktop exec vitest run src/composer-card.tsx src/host-reconnect-banner.tsx src/continue-session-in-project-dialog.tsx` | pass, or skip files that are not tests |
| Line count | `wc -l apps/desktop/src/desktop-locale.ts apps/desktop/src/desktop-copy.ts apps/desktop/src/desktop-copy.zh-CN.ts apps/desktop/src/desktop-copy.en.ts apps/desktop/src/desktop-translator.ts` | each production file **< 1000**; prefer **< 700** |

There may be no `desktop-locale.test.ts`. Do not add a framework. If you add a
test, colocate `desktop-locale.test.ts` covering load/save + both catalogs
having the same `DesktopCopy` keys (optional structural assert).

## Scope

**In scope**:
- `apps/desktop/src/desktop-locale.ts` (becomes barrel + persistence)
- new `apps/desktop/src/desktop-copy.ts` (types only)
- new `apps/desktop/src/desktop-copy.zh-CN.ts`
- new `apps/desktop/src/desktop-copy.en.ts`
- new `apps/desktop/src/desktop-translator.ts` (`getDesktopTranslator`)
- optional `apps/desktop/src/desktop-locale.test.ts`

**Out of scope**:
- Rewriting callers to new paths
- Merging `DesktopCopy` and `DesktopTranslator` into one tree (that's a product
  i18n redesign; this plan only **filesplits**)
- Settings copy, `desktop-locale-context.tsx` behavior
- CSS / composer

## Steps

### Step 1: Extract types

Move `DesktopCopy` and `DesktopTranslator` (and any nested helper types they
need) into `desktop-copy.ts`. `desktop-locale.ts` re-exports them.

Do not change type shapes.

**Verify**: `pnpm --dir apps/desktop typecheck` still compiles after the move
(may fail until catalogs move — that's OK if you do Step 2 in the same sitting).
If you commit per step, keep the barrel compiling at each step.

### Step 2: Extract catalogs

Move `COPY_BY_LOCALE['zh-CN']` to `desktop-copy.zh-CN.ts` as
`export const DESKTOP_COPY_ZH_CN: DesktopCopy = { … }`.
Move `en` likewise.

`desktop-locale.ts`:

```ts
import { DESKTOP_COPY_ZH_CN } from './desktop-copy.zh-CN';
import { DESKTOP_COPY_EN } from './desktop-copy.en';

const COPY_BY_LOCALE: Record<DesktopLocale, DesktopCopy> = {
  'zh-CN': DESKTOP_COPY_ZH_CN,
  en: DESKTOP_COPY_EN,
};

export function getDesktopCopy(locale: DesktopLocale): DesktopCopy {
  return COPY_BY_LOCALE[locale];
}
```

**Do not** reformat catalog strings. Character-identical move. Prettier may wrap
lines — if `git diff` on catalog values is not empty besides imports/filename,
STOP and restore strings.

**Verify**: `pnpm --dir apps/desktop typecheck` exit 0.

### Step 3: Extract translator

Move `getDesktopTranslator` unchanged into `desktop-translator.ts`.
Re-export from `desktop-locale.ts`. Context keeps importing from `./desktop-locale`.

**Verify**: typecheck exit 0. Spot-check `desktop-locale-context.tsx` still
compiles.

### Step 4: Keep persistence in the barrel

Leave `DesktopLocale`, `DESKTOP_LOCALE_KEY`, `loadDesktopLocale`,
`saveDesktopLocale`, `getDesktopCopy` re-export in `desktop-locale.ts`.
Target barrel **under ~80 lines**.

**Verify**: `wc -l` on every new/changed production file < 1000.
`git grep -n "from './desktop-locale'" apps/desktop/src` still resolves.

## Test plan

- If adding a test: `loadDesktopLocale` falls back to `zh-CN` when storage throws;
  `getDesktopCopy('en').settings` is `'Settings'`; `getDesktopCopy('zh-CN').settings`
  is `'设置'`; `getDesktopTranslator('en').common.cancel` is `'Cancel'`.
- Do not snapshot the whole catalog.
- **Verify**: `pnpm --dir apps/desktop typecheck` + any new vitest file pass.

## Done criteria

ALL must hold:
- [ ] `pnpm --dir apps/desktop typecheck` exit 0
- [ ] existing desktop tests that import locale still pass
- [ ] every new production file < 1000 lines; barrel is persistence + re-exports only
- [ ] callers still import `./desktop-locale` (no mass import rewrite)
- [ ] catalog string values unchanged
- [ ] `plans/README.md` row 003 → DONE

## STOP conditions

- Current state excerpts mismatch live code
- Typecheck fails twice after a reasonable fix
- Merging Copy + Translator looks “simpler” — that is out of scope; do not
- Key assumption “re-exporting from `desktop-locale.ts` keeps Vite/tsc happy
  without updating callers” is false

## Maintenance notes

- Next i18n pass should kill the dual `DesktopCopy` vs `DesktopTranslator`
  trees. Do not start that here.
- New UI strings: add to **both** `desktop-copy.zh-CN.ts` and
  `desktop-copy.en.ts` if they live on `DesktopCopy`; translator keys stay in
  `desktop-translator.ts` until the trees merge.
- Reviewers: reject diffs that rewrite English/Chinese wording while splitting.
