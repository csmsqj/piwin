# Plan 004: Split session product commands by index / lifecycle / derive

> **Executor**: Follow step by step. Run every verify before next step.
> On any STOP condition — stop and report; do not improvise.
> Update `plans/README.md` status unless a reviewer owns the index.
>
> **Drift check first**: `git diff --stat 76bcd6dd..HEAD -- packages/host-runtime/src/commands/session-product-commands.ts packages/host-runtime/src/commands/session-lifecycle-commands.test.ts packages/host-runtime/src/commands/domain-command-dispatch.ts`
> If in-scope files changed, compare Current state excerpts to live code; mismatch → STOP.

## Status
- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `76bcd6dd`, 2026-09-24

## Why this matters

`session-product-commands.ts` is **1009 lines** (at the hard cap). The file
header claims “index lifecycle only”; the body also clones transcripts, media,
and model-context DBs for `session/duplicate` and `session/fork`.

`session-lifecycle-commands.test.ts` already imports `handleSessionProductCommand`
from this file — the naming is a lie. Split by responsibility so delete/archive
and duplicate/fork can change without colliding, matching the CLI “one module
per subcommand” exemplar (`505f4026`) and host-runtime command splits.

## Current state

- `packages/host-runtime/src/commands/session-product-commands.ts` — switch + helpers
- `packages/host-runtime/src/commands/domain-command-dispatch.ts` — imports
  `handleSessionProductCommand` / `SessionProductCommandContext` (22–29)
- `packages/host-runtime/src/commands/session-lifecycle-commands.test.ts` — tests
  archive/delete via the product handler

```1:4:packages/host-runtime/src/commands/session-product-commands.ts
/**
 * Product-layer session index commands (list/pin/rename/archive/delete/duplicate/search).
 * Keep live prompt/spawn/compaction in HostRuntime — this module owns index lifecycle only.
 */
```

```120:137:packages/host-runtime/src/commands/session-product-commands.ts
const PRODUCT_COMMAND_TYPES = new Set<HostCommand['type']>([
  'session/list',
  'session/list-page',
  'session/pin',
  'session/unpin',
  'session/rename',
  'session/auto-name',
  'session/archive',
  'session/unarchive',
  'session/lifecycle-plan',
  'session/lifecycle-apply',
  'session/delete',
  'session/duplicate',
  'session/fork',
  'session/lineage',
  'session/search',
  'session/model-context-summary',
  'session/context-get',
]);
```

Switch seams (from the live file):

| Commands | Approx lines | Concern |
|----------|-------------:|---------|
| list, list-page, pin, unpin, rename, auto-name | 180–322 | index |
| archive, lifecycle-plan/apply, unarchive, delete | 323–453 | lifecycle |
| duplicate | 454–606 | derive I/O |
| fork | 607–780 | derive I/O |
| lineage, search, model-context-summary, context-get | 781–end | index/read |
| helpers `copyNativeEntries` / compaction clone | ~900–1009 | derive |

**Conventions**: host-runtime commands are one file per domain, `handleXCommand`
returns `HostResponse | null`, `fail`/`ok` from `../response-helpers.js`.
Keep `SessionProductCommandContext` as the **shared context type** (do not
invent three context interfaces). ESM `.js` imports. Exemplar: `session-pack-commands.ts`
sits beside this file.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lifecycle tests | `pnpm --filter @piwin/host-runtime exec vitest run src/commands/session-lifecycle-commands.test.ts` | pass |
| Product/session tests | `pnpm --filter @piwin/host-runtime exec vitest run src/commands/session-lifecycle-commands.test.ts src/commands/session-live-commands.test.ts` | pass |
| Package tests (if time) | `pnpm --filter @piwin/host-runtime test` | pass |
| Typecheck | `pnpm --filter @piwin/host-runtime typecheck` | exit 0 |
| Line count | `wc -l packages/host-runtime/src/commands/session-*.ts` | each new production file **< 1000**, preferably **< 500** |

## Scope

**In scope**:
- `packages/host-runtime/src/commands/session-product-commands.ts` (barrel: `isSessionProductCommand` + `handleSessionProductCommand` switch that delegates)
- new `packages/host-runtime/src/commands/session-index-commands.ts`
- new `packages/host-runtime/src/commands/session-derive-commands.ts` (duplicate + fork + clone helpers)
- optionally rename-in-place the archive/delete cases into
  `session-lifecycle-apply-commands.ts` **only if** the barrel would stay over 400
  lines; otherwise keep lifecycle cases in the barrel's delegate file
  `session-index-lifecycle-commands.ts`
- `packages/host-runtime/src/commands/domain-command-dispatch.ts` — **only if**
  import path of the context type moves; prefer keeping the type export on
  `session-product-commands.ts` so dispatch does not change
- tests: update import paths if needed; do not rewrite assertions

**Out of scope**:
- Changing duplicate/fork behavior, media clone, or remote allowlist
- `session-live-commands.ts`
- Desktop session list UI
- Splitting `SessionProductCommandContext`

## Steps

### Step 1: Move clone helpers with fork/duplicate

Create `session-derive-commands.ts` exporting:

```ts
export async function handleSessionDeriveCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: SessionProductCommandContext,
): Promise<HostResponse | null>
```

Handle only `session/duplicate` and `session/fork`. Cut-paste the two `case`
blocks and the private helpers they use (`copyNativeEntries`, compaction clone,
`appendDerivedMessage` if present). Import `SessionProductCommandContext` from
`session-product-commands.ts` to avoid a cycle: if a cycle appears, put the
**context type** in `session-product-command-context.ts` (types only) and import
it from both. That extra file is allowed.

**Verify**: typecheck. Behavior unchanged — existing lifecycle test still passes.

### Step 2: Move list/pin/rename/search/context

Create `session-index-commands.ts` with the index + read cases listed above.
Leave archive/delete/lifecycle-plan in the original file **or** a third file if
the original is still ≥ 400 lines after Step 1.

### Step 3: Barrel

`session-product-commands.ts` should look like:

```ts
export function isSessionProductCommand(command: HostCommand): boolean {
  return PRODUCT_COMMAND_TYPES.has(command.type);
}

export async function handleSessionProductCommand(...): Promise<HostResponse | null> {
  if (!isSessionProductCommand(command)) return null;
  return (
    (await handleSessionIndexCommand(command, requestId, context)) ??
    (await handleSessionLifecycleCommand(command, requestId, context)) ??
    (await handleSessionDeriveCommand(command, requestId, context))
  );
}
```

Keep `PRODUCT_COMMAND_TYPES` in the barrel so `isSessionProductCommand` stays
the single membership set. Sub-handlers return `null` for types they do not own.

Update the file header comment so it no longer claims “index lifecycle only”.

**Verify**: `pnpm --filter @piwin/host-runtime exec vitest run src/commands/session-lifecycle-commands.test.ts` pass.
`pnpm --filter @piwin/host-runtime typecheck` exit 0.
`wc -l` each production file < 1000.

## Test plan

- No new behavior tests required if this is a pure move.
- If you extract helpers, keep them unexported unless tests need them.
- If a cycle forces `session-product-command-context.ts`, grep that
  `domain-command-dispatch.ts` still compiles with the re-exported type from
  `session-product-commands.ts`.
- **Verify**: commands above.

## Done criteria

ALL must hold:
- [ ] typecheck exit 0
- [ ] session-lifecycle tests exit 0
- [ ] duplicate/fork code is not in the same file as list/pin
- [ ] production files in scope all < 1000 lines
- [ ] `isSessionProductCommand` + `handleSessionProductCommand` still exported
      from `session-product-commands.ts`
- [ ] no files outside in-scope
- [ ] `plans/README.md` row 004 → DONE

## STOP conditions

- Current state excerpts mismatch live code
- Duplicate/fork tests fail and “fixing” them needs media/session package changes
- You feel the need to change Host command types or contracts
- Import cycle cannot be broken with a types-only context file

## Maintenance notes

- Reviewers: this must be a move. `git diff -w` on derive cases should be empty
  besides imports and function wrappers.
- Follow-up (not this plan): `session-lifecycle-commands.test.ts` should import
  from the lifecycle module once that export exists.
- Do not pull live prompt/compaction into these files (header invariant).
