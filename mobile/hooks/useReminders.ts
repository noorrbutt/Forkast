import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import {
  cancelAllReminders,
  cancelRamadanReminders,
  hasReminderPermission,
  requestReminderPermission,
  scheduleRamadanReminders,
  syncReminders,
} from '../lib/notifications';
import { fastingWindow } from '../lib/ramadan';
import { useReminderSignal, useStreaks, useWeeklyDigest } from './useInsights';
import { useLogs } from './useLogs';
import { useRamadan } from './useRamadan';

/** How many days of Ramadan reminders are kept rolling ahead. */
const RAMADAN_DAYS_AHEAD = 7;

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
  const ramadan = useRamadan();

  // One page is enough: only the newest log matters for the inactivity nudge.
  const logs = useLogs(1, 0);
  const streaks = useStreaks();
  const reminderSignal = useReminderSignal();
  const weeklyDigest = useWeeklyDigest();

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
  const signal = reminderSignal.isSuccess && !reminderSignal.isFetching
    ? reminderSignal.data
    : undefined;
  const digest = weeklyDigest.isSuccess && !weeklyDigest.isFetching
    ? weeklyDigest.data
    : undefined;

  useEffect(() => {
    if (enabled !== true) return;
    // Wait for Ramadan's own settings to load before deciding anything:
    // `ramadan.enabled` defaults to false until then, and syncing the
    // standard reminders on that unloaded default would schedule them for a
    // moment, then immediately replace them once the real value arrives.
    if (!ramadan.loaded) return;
    // Ramadan mode replaces the standard reminders with its own sehri/iftar
    // ones below: logging patterns during a fast have nothing to do with
    // "quiet since lunch" or an evening streak nudge.
    if (ramadan.enabled) return;
    // Wait until both queries have answered, or the first sync would schedule
    // from "no logs, no streak" and immediately be replaced.
    if (!logs.data || !streaks.data) return;
    void syncReminders({ lastLoggedAt, currentStreak, signal, digest });
  }, [enabled, ramadan.loaded, ramadan.enabled, logs.data, streaks.data, lastLoggedAt, currentStreak, signal, digest]);

  /**
   * Ramadan mode's own reminders: sehri and iftar, rolled seven days ahead.
   *
   * Rescheduled on mount and every time the app comes back to the foreground,
   * since fajr and maghrib move a few minutes a day and the window has to
   * keep sliding forward -- a static seven-day schedule laid down once would
   * be running on stale times by the second week. Turning the mode off, or
   * reminders themselves off, cancels every one of them outright rather than
   * leaving next Tuesday's sehri reminder armed for a mode nobody is in
   * anymore.
   */
  useEffect(() => {
    if (!ramadan.loaded) return;

    if (enabled !== true || !ramadan.enabled) {
      void cancelRamadanReminders();
      return;
    }

    const reschedule = () => {
      const windows = Array.from({ length: RAMADAN_DAYS_AHEAD }, (_, day) => {
        const date = new Date();
        date.setDate(date.getDate() + day);
        return fastingWindow(date, ramadan.city, ramadan.offsetMin);
      });
      void scheduleRamadanReminders(windows);
    };

    reschedule();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') reschedule();
    });
    return () => subscription.remove();
  }, [ramadan.loaded, ramadan.enabled, ramadan.city, ramadan.offsetMin, enabled]);

  const enable = useCallback(async () => {
    const granted = await requestReminderPermission();
    setEnabled(granted);
    // Ramadan mode's own effect above owns scheduling while it's on; syncing
    // the standard three here as well would schedule them for a moment until
    // that effect's next run replaced them.
    if (granted && !(ramadan.loaded && ramadan.enabled)) {
      await syncReminders({ lastLoggedAt, currentStreak, signal, digest });
    }
    return granted;
  }, [lastLoggedAt, currentStreak, signal, digest, ramadan.loaded, ramadan.enabled]);

  const disable = useCallback(async () => {
    await cancelAllReminders();
    await cancelRamadanReminders();
    setEnabled(false);
  }, []);

  return { enabled, enable, disable };
}
