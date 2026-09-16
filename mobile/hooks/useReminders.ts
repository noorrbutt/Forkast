import { useCallback, useEffect, useState } from 'react';

import {
  cancelAllReminders,
  hasReminderPermission,
  requestReminderPermission,
  syncReminders,
} from '../lib/notifications';
import { useStreaks } from './useInsights';
import { useLogs } from './useLogs';

/**
 * Keeps the two local reminders in step with what the user has actually logged.
 *
 * The schedule is derived, never stored: it is recomputed from the newest log
 * and the current streak every time either changes. That is the same reasoning
 * as the server computing streaks on the fly rather than keeping a counter, and
 * it means an edited or deleted log moves the reminder with it.
 */
export function useReminders() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  // One page is enough: only the newest log matters for the inactivity nudge.
  const logs = useLogs(1, 0);
  const streaks = useStreaks();

  useEffect(() => {
    let active = true;
    void hasReminderPermission().then((granted) => {
      if (active) setEnabled(granted);
    });
    return () => {
      active = false;
    };
  }, []);

  const lastLoggedAt = logs.data?.items?.[0]?.created_at ?? null;
  const currentStreak = streaks.data?.current_streak ?? 0;

  useEffect(() => {
    if (enabled !== true) return;
    // Wait until both queries have answered, or the first sync would schedule
    // from "no logs, no streak" and immediately be replaced.
    if (!logs.data || !streaks.data) return;
    void syncReminders({ lastLoggedAt, currentStreak });
  }, [enabled, logs.data, streaks.data, lastLoggedAt, currentStreak]);

  const enable = useCallback(async () => {
    const granted = await requestReminderPermission();
    setEnabled(granted);
    if (granted) {
      await syncReminders({ lastLoggedAt, currentStreak });
    }
    return granted;
  }, [lastLoggedAt, currentStreak]);

  const disable = useCallback(async () => {
    await cancelAllReminders();
    setEnabled(false);
  }, []);

  return { enabled, enable, disable };
}
