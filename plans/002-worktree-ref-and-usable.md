# Plan 002: Sanitize worktree refs and refuse walk-up checkouts

> **Executor**: Follow step by step. Run every verify before next step.
> On any STOP condition — stop and report; do not improvise.
> Update `plans/README.md` status unless a reviewer owns the index.
>
> **Drift check first**: `git diff --stat 76bcd6dd..HEAD -- packages/git/src/worktree.ts packages/git/src/path-safety.ts packages/git/src/worktree.test.ts packages/git/src/path-safety.test.ts packages/host-runtime/src/host-runtime-subagent-tasks.ts packages/host-runtime/src/subagent-writer-slots.ts`
> If in-scope files changed, compare Current state excerpts to live code; mismatch → STOP.

## Status
- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `76bcd6dd`, 2026-09-24

## Why this matters

Two invariant holes on the subagent worktree path, both already solved elsewhere
in the same package:

1. `resetWorktreeToBase` / freeze / integrate all call `assertSafeRef`.
   `createWorktree` (used when a writer slot is rebuilt) passes `baseRef` to
   `git branch` unsanitized. A value starting with `-` is option injection.
   Host currently feeds `rev-parse HEAD`, so exploitability is low today; the
   hole is on the rebuild path (`subagent-writer-slots.ts` passes `baseCommit`).

2. `isWorktreeUsable` exists because `rev-parse --is-inside-work-tree` walks up:
   a slot whose `.git` is gone reports the enclosing repo (dotfiles around
   `~/.piwin`) as usable. The non-slot continuation path in
   `resolveRetainedSubagentWorktreeLease` still uses the walk-up check, then
   holds a lock on that cwd. The child would write in the parent checkout.

## Current state

- `packages/git/src/worktree.ts` — `createWorktree` (67–114), `resetWorktreeToBase` (191–219), `isWorktreeUsable` (225–244)
- `packages/git/src/path-safety.ts` — `assertSafeRef` (53–67)
- `packages/git/src/path-safety.test.ts` — ref charset tests, no `--output=` vector
- `packages/git/src/worktree.test.ts` — usable vs orphan slot (95–96)
- `packages/host-runtime/src/host-runtime-subagent-tasks.ts` — continuation lease (388–437)
- `packages/host-runtime/src/subagent-writer-slots.ts` — rebuild calls `createWorktree({ baseRef: input.baseCommit })` (271–276)

```78:91:packages/git/src/worktree.ts
  const baseRef = input.baseRef?.trim() || 'HEAD';

  // Create the generated branch from the captured base, then attach its worktree.
  const branchCheck = await runGitCommand({
    cwd: projectPath,
    args: ['rev-parse', '--verify', branch],
    allowFailure: true,
  });
  const createdBranch = branchCheck.exitCode !== 0;
  if (createdBranch) {
    await runGitCommand({
      cwd: projectPath,
      args: ['branch', branch, baseRef],
    });
  }
```

```191:196:packages/git/src/worktree.ts
  const worktreePath = resolve(input.worktreePath);
  const baseCommit = assertSafeRef(input.baseCommit);
  // `reset --hard` + `clean -x` are destructive; never let them reach a
  // repository that merely encloses this path.
  if (!(await isWorktreeUsable(worktreePath))) {
```

```225:244:packages/git/src/worktree.ts
export async function isWorktreeUsable(worktreePath: string): Promise<boolean> {
  // `--is-inside-work-tree` alone walks up: a slot whose `.git` file is gone
  // would report the *enclosing* repository (a dotfiles repo around ~/.piwin,
  // say) as usable, and the slot reset would then run `reset --hard` on it.
  // Only a checkout whose top level is this directory itself counts.
  const result = await runGitCommand({
    cwd: worktreePath,
    args: ['rev-parse', '--show-toplevel'],
    allowFailure: true,
  });
  ...
    const [expected, actual] = await Promise.all([realpath(worktreePath), realpath(topLevel)]);
    return expected === actual;
```

```429:437:packages/host-runtime/src/host-runtime-subagent-tasks.ts
  if (!snapshot) {
    const insideWorktree = await runGitCommand({
      cwd: matchingLease.worktreePath,
      args: ['rev-parse', '--is-inside-work-tree'],
      allowFailure: true,
    });
    if (insideWorktree.stdout.trim() !== 'true') {
      throw new Error('subagent worktree is invalid; start a new isolated task to continue');
    }
  }
```

`host-runtime-subagent-tasks.ts` already imports `runGitCommand`, `removeWorktree`,
`deleteResultSnapshotRef` from `@piwin/git`. Add `isWorktreeUsable` to that import
and drop the raw `runGitCommand` walk-up. Keep `runGitCommand` only if other
call sites in the file still need it.

**Conventions**: git tests in `packages/git/src/worktree.test.ts` / `path-safety.test.ts`.
Match `createRepository()` helper. ESM `.js` imports. No `any`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Git tests | `pnpm --filter @piwin/git exec vitest run src/worktree.test.ts src/path-safety.test.ts` | all pass, including new cases |
| Git package | `pnpm --filter @piwin/git test` | all pass |
| Git typecheck | `pnpm --filter @piwin/git typecheck` | exit 0 |
| Host-runtime tasks | `pnpm --filter @piwin/host-runtime exec vitest run src/subagent-git-integration.integration.test.ts src/subagent-workspace-service.test.ts src/subagent-writer-slots.test.ts` | all pass |
| Host-runtime typecheck | `pnpm --filter @piwin/host-runtime typecheck` | exit 0 |

## Scope

**In scope**:
- `packages/git/src/worktree.ts`
- `packages/git/src/worktree.test.ts`
- `packages/git/src/path-safety.test.ts` (optional extra vector)
- `packages/host-runtime/src/host-runtime-subagent-tasks.ts`

**Out of scope**:
- Writer-slot pool design / GC policy
- `resetWorktreeToBase` (already safe)
- Desktop branch chip
- Unrelated uncommitted git snapshot files except as needed to typecheck

## Steps

### Step 1: Fail `createWorktree` on unsafe `baseRef`

Change:

```ts
const baseRef = assertSafeRef(input.baseRef?.trim() || 'HEAD');
```

`HEAD` matches `assertSafeRef` (`^[A-Za-z0-9][A-Za-z0-9._/-]*$`).
Do this **before** `git branch`.

In `worktree.test.ts`, add:

- `createWorktree({ baseRef: '--output=/tmp/unsafe' })` rejects (throw from `assertSafeRef`).
- `createWorktree({ baseRef: 'HEAD' })` still succeeds (existing storage test can stay).

Optional: `path-safety.test.ts` `expect(() => assertSafeRef('--output=/tmp/unsafe')).toThrow()`.

**Verify**: `pnpm --filter @piwin/git exec vitest run src/worktree.test.ts src/path-safety.test.ts` → new case fails before the code change, passes after.

### Step 2: Continuation lease uses `isWorktreeUsable`

In `resolveRetainedSubagentWorktreeLease`, replace the `if (!snapshot)` walk-up
block with:

```ts
if (!snapshot) {
  const usable = await isWorktreeUsable(matchingLease.worktreePath);
  if (!usable) {
    throw new Error('subagent worktree is invalid; start a new isolated task to continue');
  }
}
```

Do **not** change the slot-without-snapshot throw above it
(`matchingLease.slotId !== undefined` still refuses). That path has no live
child state to continue from.

If `runGitCommand` becomes unused in this file, drop it from the `@piwin/git` import.

**Verify**: `pnpm --filter @piwin/host-runtime exec vitest run src/subagent-git-integration.integration.test.ts src/subagent-writer-slots.test.ts src/subagent-workspace-service.test.ts` → pass. `pnpm --filter @piwin/host-runtime typecheck` → exit 0.

## Test plan

- `packages/git/src/worktree.test.ts`: unsafe `baseRef` rejected; `HEAD` allowed.
- Existing `isWorktreeUsable(enclosing)` vs orphan slot stays green.
- No new host-runtime unit required if the continuation function is a one-line
  swap onto an already-tested git helper. If you touch control flow around the
  slot snapshot throw, add a focused test next to existing writer-slot tests.
- **Verify**: `pnpm --filter @piwin/git test` and the host-runtime vitest command above.

## Done criteria

ALL must hold:
- [ ] both typechecks exit 0
- [ ] git + listed host-runtime tests exit 0; new unsafe-ref test exists
- [ ] no files outside in-scope
- [ ] `plans/README.md` row 002 → DONE
- [ ] `createWorktree` has no remaining `baseRef` use without `assertSafeRef`

## STOP conditions

- Current state excerpts mismatch live code
- Verify fails twice after a reasonable fix
- Fix seems to require changing slot acquire/reset semantics
- `assertSafeRef('HEAD')` throws in live `path-safety.ts` (assumption false)

## Maintenance notes

- Reviewers: do not weaken `assertSafeRef` to allow leading `-`.
- Any new `git` argv that takes a caller-supplied ref must go through `assertSafeRef`.
- Continuation of **slot** leases without a frozen tree must keep failing; only
  the non-slot live-copy path needs a usable checkout.
