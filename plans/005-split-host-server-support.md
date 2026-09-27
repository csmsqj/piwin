# Plan 005: Split `host-server-support.ts` by admission concern

> **Executor**: Follow step by step. Run every verify before next step.
> On any STOP condition — stop and report; do not improvise.
> Update `plans/README.md` status unless a reviewer owns the index.
>
> **Drift check first**: `git diff --stat 76bcd6dd..HEAD -- packages/host-server/src/host-server-support.ts packages/host-server/src/host-command-admission.ts packages/host-server/src/host-server-hydration.ts packages/host-server/src/host-server.ts packages/host-server/src/index.ts`
> If in-scope files changed, compare Current state excerpts to live code; mismatch → STOP.

## Status
- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `76bcd6dd`, 2026-09-24

## Why this matters

HostServer was already split (`1e432969`). The leftover grab-bag
`host-server-support.ts` is **1013 lines** (over the cap) and mixes:

- loopback / origin / token compare
- a ~590-line `isSafeRemoteCommand` switch (security allowlist)
- command rewrite (`resolveRemoteCommand`)
- remote media ref bookkeeping
- hydration frame trimming

`isSafeRemoteCommand` is the remote attack surface. It should be a named module,
not buried under `formatWebSocketUrl`. `host-command-admission.ts` already
imports it as the gate.

## Current state

- `packages/host-server/src/host-server-support.ts` — all of the above
- `packages/host-server/src/host-command-admission.ts` — `import { isSafeRemoteCommand } from './host-server-support.js'`
- `packages/host-server/src/host-server-hydration.ts` — already imports hydration helpers from support (27–38)
- `packages/host-server/src/host-server.ts` — mixed imports from support
- tests: `host-server-support.flashcard-study.test.ts`, `host-server-support.media-list.test.ts`

```44:56:packages/host-server/src/host-server-support.ts
export function normalizeSeq(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}
```

```133:136:packages/host-server/src/host-server-support.ts
export function isSafeRemoteCommand(command: HostCommand): boolean {
  // Phone-access listen/pairing is local sidecar IPC, not a Host command.
  if (command.type.startsWith('mobile-access/')) {
    return false;
```

The switch runs to a `default: return true` near line 721. That default is
load-bearing (unknown types currently pass). **Do not change it** in this plan.

```725:728:packages/host-server/src/host-server-support.ts
export function resolveRemoteCommand(
  command: HostCommand,
  remoteMediaPaths: Map<string, string>,
): HostCommand {
```

Other exports (from the live file): `isSafeQueuedTurnCommand`, `collectMediaRefs`,
`rememberRemoteMediaRefsFromPush`, `rememberRemoteMediaAsset`, `isSafeRemoteId`,
`isSafeTrustedTextRelativePath`, `isSafeRemoteAttachment`,
`requestIdFromSerializedWire`, `toError`, `isRecord`,
`normalizeHydrationSessionIds`, `isRemoteSessionSummary`, `limitHydrationMessage`,
`truncateUtf8`, `fitHydrationFrame`, plus session-list scope helpers at 98–131.

**Conventions**: host-server already uses focused files (`remote-settings-apply.ts`,
`remote-permission-rules.ts`, `host-hello-auth.ts`). Match that. Public package
entry is `src/index.ts` and does **not** currently re-export support helpers —
callers inside the package use relative `./host-server-support.js`. Keep a
barrel `host-server-support.ts` that re-exports everything so existing relative
imports keep working (surgical).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Support tests | `pnpm --filter @piwin/host-server exec vitest run src/host-server-support.flashcard-study.test.ts src/host-server-support.media-list.test.ts` | pass |
| Broader server tests | `pnpm --filter @piwin/host-server exec vitest run src/host-command-admission.ts src/host-server-hydration.ts src/host-hello-auth.test.ts src/remote-settings-apply.test.ts src/web-shell.test.ts` | pass (skip paths that are not tests) |
| Package | `pnpm --filter @piwin/host-server test` | pass |
| Typecheck | `pnpm --filter @piwin/host-server typecheck` | exit 0 |
| Line count | `wc -l packages/host-server/src/host-server-support.ts packages/host-server/src/remote-command-allowlist.ts packages/host-server/src/remote-origin.ts packages/host-server/src/remote-media-admission.ts` | each **< 1000**; allowlist file may be ~600 (one concern) |

## Scope

**In scope**:
- `packages/host-server/src/host-server-support.ts` (barrel re-exports)
- new `packages/host-server/src/remote-origin.ts` — loopback/wildcard/origin/token/url
- new `packages/host-server/src/remote-command-allowlist.ts` — `isSafeRemoteCommand` + id/path/session-list scope helpers it needs
- new `packages/host-server/src/remote-command-resolve.ts` — `resolveRemoteCommand`, `isSafeQueuedTurnCommand`
- new `packages/host-server/src/remote-media-admission.ts` — collect/remember media refs, `isSafeRemoteAttachment`
- move hydration helpers **into** `host-server-hydration.ts` (already exists) **or**
  `remote-hydration-limit.ts` if putting them in the hydration module creates a cycle
- existing `host-server-support.*.test.ts` — import path can stay if the barrel re-exports

**Out of scope**:
- Changing allowlist outcomes (`default: return true` stays)
- Adding new command cases
- `remote-projection.ts`
- Desktop host-client

## Steps

### Step 1: Origin / crypto helpers

Move `normalizeSeq`, `isLoopbackHost`, `isWildcardHost`, `isLoopbackBrowserOrigin`,
`authTokensEqual`, `formatWebSocketUrl` to `remote-origin.ts`. Re-export from
`host-server-support.ts`.

**Verify**: `pnpm --filter @piwin/host-server typecheck` exit 0.

### Step 2: Allowlist module

Move `isSafeRemoteCommand` and the small predicates it uses
(`isSafeRemoteId`, `isSafeRemoteProjectLocator`, session-list scope helpers,
`isSafeTrustedTextRelativePath` if only used here) to
`remote-command-allowlist.ts`.

Character-identical switch. Do not alphabetize cases. Do not tighten `default`.

**Verify**: `pnpm --filter @piwin/host-server exec vitest run src/host-server-support.flashcard-study.test.ts src/host-server-support.media-list.test.ts` pass.

### Step 3: Resolve + media

Move `resolveRemoteCommand` / queued-turn safety to `remote-command-resolve.ts`.
Move media remember/collect to `remote-media-admission.ts`.

### Step 4: Hydration helpers

`host-server-hydration.ts` already imports `fitHydrationFrame`,
`limitHydrationMessage`, `normalizeHydrationSessionIds`, `truncateUtf8`,
`isRemoteSessionSummary`. Move those function bodies next to that importer
**if** no cycle with `host-server-support.ts`. If `host-server.ts` also needs
them, keep re-exports on the barrel.

**Verify**: full `pnpm --filter @piwin/host-server test` and typecheck.
`wc -l` barrel < 80 lines of re-exports; allowlist is the big file but a
single concern.

## Test plan

- Existing flashcard-study + media-list allowlist tests must stay green without
  assertion changes.
- Do not add snapshot tests of the whole switch.
- If you add one test: a command type not listed in the switch still returns
  `true` (`default`). That documents the current (dirty) policy; do not “fix”
  it here.
- **Verify**: package test script pass.

## Done criteria

ALL must hold:
- [ ] typecheck exit 0
- [ ] host-server tests exit 0
- [ ] `isSafeRemoteCommand` switch text unchanged (whitespace/imports only)
- [ ] production files each < 1000 lines
- [ ] `host-command-admission.ts` still compiles (barrel or direct import)
- [ ] no files outside in-scope
- [ ] `plans/README.md` row 005 → DONE

## STOP conditions

- Current state excerpts mismatch live code
- Allowlist tests fail and the “fix” would change remote command admission
- Temptation to replace `default: return true` with a deny-by-default — that is
  a product/security change, new plan, not this split
- Cycle between hydration and support cannot be broken without editing
  `host-server.ts` control flow

## Maintenance notes

- Reviewers: `git diff -w` on `isSafeRemoteCommand` must show a file move, not
  case edits.
- Follow-up (rejected for this plan): deny-by-default remote commands.
- New Host commands that are remote-safe must add an explicit `case` in
  `remote-command-allowlist.ts`, not rely on `default`.
