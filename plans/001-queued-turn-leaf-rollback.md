# Plan 001: Restore queued-turn leaf on starting rollback

> **Executor**: Follow step by step. Run every verify before next step.
> On any STOP condition — stop and report; do not improvise.
> Update `plans/README.md` status unless a reviewer owns the index.
>
> **Drift check first**: `git diff --stat 76bcd6dd..HEAD -- packages/session/src/transcript-store-queued-turns.ts packages/session/src/transcript-store.ts packages/session/src/transcript-store-queued-leaf.test.ts packages/session/src/transcript-store-branches.ts packages/host-runtime/src/queued-turn-controller.ts`
> If in-scope files changed, compare Current state excerpts to live code; mismatch → STOP.

## Status
- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `76bcd6dd`, 2026-09-24

## Why this matters

`createQueuedTurn` writes a durable user row with `preserveActiveLeaf: true` so a
pending queue item cannot steal the in-flight reply leaf. Admission then calls
`attachToActiveLeaf` when status becomes `starting`. The inverse path
(`starting → pending` on retryable `run-active:`, and `starting → failed`) only
flips `queued_turn.status`. The queued user row stays the live leaf.

`TREE_VISIBLE_MESSAGE` then hides that row from sibling queries because status is
no longer `starting`/`started`. New assistant rows parent under a hidden node.
A later successful start calls `attachToActiveLeaf` again: the queued user's
parent becomes a descendant of itself → cycle in the active-path CTE.

Same class as the 2026-09-22 false-fork fix; the rollback path was never closed.

## Current state

- `packages/session/src/transcript-store-queued-turns.ts` — queued-turn transitions (lines 356–360 attach only on starting/started)
- `packages/session/src/transcript-store.ts` — `attachToActiveLeaf` (778–792); `insertMessageRow` + `preserveActiveLeaf` (770–776)
- `packages/session/src/transcript-store-branches.ts` — `TREE_VISIBLE_MESSAGE` (57–64)
- `packages/session/src/transcript-store-queued-leaf.test.ts` — pending preserve + convert-to-intervention; **no starting→pending case**
- `packages/host-runtime/src/queued-turn-controller.ts` — retry rolls starting back to pending (461–469); `failStarting` goes to `failed` (503–516)

```356:360:packages/session/src/transcript-store-queued-turns.ts
          // Pending rows stay off the active path. Splice onto the current
          // leaf only when admission actually starts (or jumps to started).
          if (input.to === 'starting' || (input.to === 'started' && row.status !== 'starting')) {
            attachToActiveLeaf(row.user_message_id);
          }
```

```778:792:packages/session/src/transcript-store.ts
  function attachToActiveLeaf(messageId: string): void {
    const leafRow = db
      .prepare('SELECT active_leaf_message_id FROM transcript_meta WHERE session_id = ?')
      .get(options.sessionId) as { active_leaf_message_id: string | null } | undefined;
    const leaf = leafRow?.active_leaf_message_id ?? null;
    if (leaf === messageId) {
      return;
    }
    db.prepare('UPDATE transcript_message SET parent_message_id = ? WHERE id = ?').run(
      leaf,
      messageId,
    );
    db.prepare(
      'UPDATE transcript_meta SET active_leaf_message_id = ? WHERE session_id = ?',
    ).run(messageId, options.sessionId);
  }
```

```57:64:packages/session/src/transcript-store-branches.ts
const TREE_VISIBLE_MESSAGE = `NOT EXISTS (
  SELECT 1 FROM queued_turn queued
  WHERE queued.user_message_id = transcript_message.id
    AND queued.status NOT IN ('starting', 'started')
)`;
```

```461:469:packages/host-runtime/src/queued-turn-controller.ts
        if (isRetryableQueuedAdmissionError(response.error)) {
          const pending = await store.transitionQueuedTurn({
            queuedTurnId: starting.queuedTurnId,
            expectedRevision: starting.revision,
            from: ['starting'],
            to: 'pending',
            updatedAt: new Date().toISOString(),
          });
          if (pending) this.options.push({ type: 'session/queued-turn-updated', queuedTurn: pending });
          if (response.error.includes('run-active:')) return;
```

**Conventions**: session store tests colocate (`transcript-store-queued-leaf.test.ts`).
Match that file's `openStore` / `messageInput` helpers. Do not add a new helper
module. ESM `.js` specifiers. No `any`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Session tests | `pnpm --filter @piwin/session exec vitest run src/transcript-store-queued-leaf.test.ts src/transcript-store.test.ts` | all pass, including the new case |
| Session package | `pnpm --filter @piwin/session test` | all pass |
| Typecheck | `pnpm --filter @piwin/session typecheck` | exit 0 |
| Host-runtime (no behavior change expected) | `pnpm --filter @piwin/host-runtime exec vitest run src/queued-turn-controller.ts` | if no colocated test file, skip; do not invent one unless a controller change is required |

## Scope

**In scope** (only these may change):
- `packages/session/src/transcript-store-queued-turns.ts`
- `packages/session/src/transcript-store.ts` (only if a named restore helper is added next to `attachToActiveLeaf`)
- `packages/session/src/transcript-store-queued-leaf.test.ts`

**Out of scope**:
- `queued-turn-controller.ts` — Host already calls `transitionQueuedTurn`; fix the store invariant so every starting-rollback restores the leaf
- `TREE_VISIBLE_MESSAGE` filter — keep it; do not “fix” visibility by showing pending rows as forks again
- Desktop branch-chip / transcript UI
- Unrelated uncommitted Devin / writer-slot files

## Steps

### Step 1: Red test for starting → pending leaf restore

In `transcript-store-queued-leaf.test.ts`, add a case that:

1. Appends `user-1` then `asst-1` (leaf = `asst-1`).
2. `createQueuedTurn` for `queued-user` (leaf stays `asst-1`, parent of queued-user is `asst-1`).
3. Appends `asst-2` (leaf = `asst-2`; queued-user parent still `asst-1` — this is the live race).
4. `transitionQueuedTurn` pending → starting. Expect leaf = `queued-user`, parent = `asst-2`.
5. `transitionQueuedTurn` starting → pending. Expect **leaf = `asst-2`**, parent of `queued-user` remains `asst-2` (off the live path, same as create).
6. Append `asst-3`. Expect parent of `asst-3` = `asst-2` (not `queued-user`), leaf = `asst-3`.
7. `listBranchPoints` stays `[]`.
8. Repeat starting: leaf becomes `queued-user` again, parent = `asst-3`.

Also cover `starting → failed` with the same restore (Host `failStarting`).

**Verify**: `pnpm --filter @piwin/session exec vitest run src/transcript-store-queued-leaf.test.ts` → the new case **fails** (leaf still `queued-user` after rollback). If it already passes, STOP — the bug is gone; update this plan, do not invent a different change.

### Step 2: Restore leaf when leaving `starting` without `started`

In `transitionQueuedTurn`, after the status UPDATE, keep the existing attach on
`to === 'starting'` / jump to `started`. Add the inverse:

When `row.status === 'starting'` and `input.to` is `pending` | `failed` | `cancelled`:

- Read `parent_message_id` of `row.user_message_id` (that is the leaf `attachToActiveLeaf` spliced onto).
- If `transcript_meta.active_leaf_message_id === row.user_message_id`, set it back to that parent (or `NULL` if parent is null).
- Do **not** rewrite `parent_message_id` of the queued user — it should stay hanging off the leaf it attached to, matching `preserveActiveLeaf` create behavior.
- Do **not** restore if some other writer already moved the leaf off the queued user (equality guard).

Keep this in the same `BEGIN IMMEDIATE` transaction.

Preferred shape: a `detachFromActiveLeaf(messageId: string): void` next to
`attachToActiveLeaf` on the store core, used only from queued-turn ops. Do not
export it on `SessionTranscriptStore` unless a test needs it; tests should
assert via `getActiveLeaf` / `getParentMessageId`.

**Verify**: the Step 1 test now passes. Existing queued-leaf tests still pass
(`does not let a pending queued row steal the in-flight reply leaf`,
`attaches a converted queued row onto the current leaf`).

### Step 3: Confirm started stays attached

Do not detach on `starting → started`. A short assertion in the existing starting
test (already expects leaf = `queued-user`) is enough; do not add a third file.

**Verify**: `pnpm --filter @piwin/session exec vitest run src/transcript-store-queued-leaf.test.ts src/transcript-store.test.ts` → all pass.

## Test plan

- New cases in `packages/session/src/transcript-store-queued-leaf.test.ts` (happy rollback, failed rollback, re-start after rollback, in-flight assistant continues on previous leaf).
- Structural exemplar: the existing `does not let a pending queued row steal the in-flight reply leaf` test in the same file.
- **Verify**: `pnpm --filter @piwin/session test` → pass including the new tests.

## Done criteria

ALL must hold:
- [ ] `pnpm --filter @piwin/session typecheck` exit 0
- [ ] `pnpm --filter @piwin/session test` exit 0; new rollback tests exist
- [ ] no files outside in-scope (`git status`)
- [ ] `plans/README.md` row 001 → DONE

## STOP conditions

- Current state excerpts mismatch live code
- Verify fails twice after a reasonable fix
- Fix seems to require changing `TREE_VISIBLE_MESSAGE` or Host admission
- Key assumption “`parent_message_id` of the queued user after attach is the previous leaf” is false

## Maintenance notes

- Reviewers: watch for restoring the leaf unconditionally (would clobber a newer
  leaf). The equality guard is load-bearing.
- Do not re-introduce pending rows as tree siblings.
- Host `queued-turn-controller` retry path should keep calling the same
  `transitionQueuedTurn`; if someone “fixes” this only in Host, the store
  invariant stays broken for other callers.
