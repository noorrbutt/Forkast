import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/** How long a delete stays undoable before it actually happens. */
export const UNDO_WINDOW_MS = 5000;

type Pending = {
  timer: ReturnType<typeof setTimeout>;
  commit: () => void;
};

/**
 * A delete that can be taken back, for as long as nobody has looked away.
 *
 * The row disappears the instant someone swipes it away -- waiting on the
 * server first would mean holding a photo's worth of visual feedback
 * hostage to a network round trip for an action that is reversible anyway.
 * What actually reaches the server is delayed instead: `schedule` starts a
 * five second timer, `cancel` (Undo) clears it before it fires, and nothing
 * about the row's real deletion happens until either the timer elapses or
 * something forces it to happen sooner.
 *
 * "Sooner" has to include leaving without pressing Undo. A five second timer
 * alone assumes the person stays on this exact screen for five seconds,
 * which swiping away a row and immediately switching tabs, backgrounding
 * the app, or signing out all violate, and no version of this feature is
 * honest that would let a hard exit quietly cancel a delete the swipe had
 * already promised. `flush` -- called on unmount, on the screen losing
 * focus, and on the app backgrounding, all wired by the caller -- commits
 * every still-pending delete immediately rather than losing it.
 */
export function useSoftDelete<Id extends string>(commitDelete: (id: Id) => void) {
  const [pendingIds, setPendingIds] = useState<ReadonlySet<Id>>(new Set());
  // A ref alongside the state: state is what the UI reads to grey out a row,
  // but flush() and cancel() need the live timers themselves, and closures
  // captured at render time would see a stale map on the very unmount path
  // this exists to make reliable.
  const pending = useRef<Map<Id, Pending>>(new Map());

  const settle = useCallback((id: Id) => {
    pending.current.delete(id);
    setPendingIds(new Set(pending.current.keys()));
  }, []);

  const schedule = useCallback(
    (id: Id) => {
      // Re-swiping a row already pending restarts its own window rather
      // than stacking a second timer that would double-commit it.
      const existing = pending.current.get(id);
      if (existing) clearTimeout(existing.timer);

      const commit = () => {
        settle(id);
        commitDelete(id);
      };
      const timer = setTimeout(commit, UNDO_WINDOW_MS);
      pending.current.set(id, { timer, commit });
      setPendingIds(new Set(pending.current.keys()));
    },
    [commitDelete, settle],
  );

  const cancel = useCallback(
    (id: Id) => {
      const existing = pending.current.get(id);
      if (!existing) return;
      clearTimeout(existing.timer);
      settle(id);
    },
    [settle],
  );

  /**
   * Commit every pending delete right now, instead of waiting out its timer.
   *
   * Safe to mutate `pending.current` from inside the loop that iterates it:
   * each `commit()` only ever deletes the one key `for...of` is currently
   * visiting, and a Map's iterator is specified to tolerate that (it is only
   * *adding* keys mid-iteration that has undefined visitation order, and
   * nothing here does that).
   */
  const flush = useCallback(() => {
    for (const [, { timer, commit }] of pending.current) {
      clearTimeout(timer);
      commit();
    }
  }, []);

  // Backgrounding the app is a form of leaving without ever unmounting this
  // hook's owner, so it needs its own listener rather than relying on the
  // unmount effect below to ever run.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') flush();
    });
    return () => subscription.remove();
  }, [flush]);

  useEffect(() => {
    return () => flush();
  }, [flush]);

  return {
    /** Whether this id is mid-undo-window right now. */
    isPending: useCallback((id: Id) => pendingIds.has(id), [pendingIds]),
    pendingCount: pendingIds.size,
    schedule,
    cancel,
    flush,
  };
}
