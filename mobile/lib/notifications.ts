import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Local reminders: nudge after a quiet stretch, and protect a live streak.
 *
 * Local, not push. Remote push needs a project id, a native build and a server
 * holding device tokens, and Expo Go dropped remote push support on Android in
 * SDK 53. Everything the brief asks for here is a reminder the phone can work
 * out for itself from data the app already has, so nothing needs to leave the
 * device and the whole feature keeps working in Expo Go.
 *
 * Every call is wrapped. Notification support varies by platform and by how the
 * app was launched, and a reminder failing to schedule must never take a screen
 * down with it: the worst acceptable outcome is that no reminder arrives.
 */

const INACTIVITY_ID = 'forkast.inactivity';
const STREAK_ID = 'forkast.streak';

/** How long a gap counts as "you have stopped logging". */
const INACTIVITY_HOURS = 30;

/** Evening local hour for the streak reminder, late enough to be actionable. */
const STREAK_HOUR = 20;
const STREAK_MINUTE = 30;

let handlerInstalled = false;

function installHandler(): void {
  if (handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Ask once, and report what we got.
 *
 * Returns false rather than throwing when the platform has no notification
 * support at all, so callers can treat "declined" and "unavailable" the same
 * way: no reminders, no error.
 */
export async function requestReminderPermission(): Promise<boolean> {
  try {
    installHandler();

    if (Platform.OS === 'android') {
      // Android 8+ drops notifications posted to no channel. Creating it is
      // idempotent, so this is safe to call on every request.
      await Notifications.setNotificationChannelAsync('reminders', {
        name: 'Reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: null,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    if (!existing.canAskAgain) return false;

    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    return false;
  }
}

export async function hasReminderPermission(): Promise<boolean> {
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

async function cancel(identifier: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  } catch {
    // Cancelling something that was never scheduled is not an error worth
    // surfacing, and on some platforms it throws rather than no-oping.
  }
}

export async function cancelAllReminders(): Promise<void> {
  await cancel(INACTIVITY_ID);
  await cancel(STREAK_ID);
}

type ReminderState = {
  /** ISO timestamp of the most recent log, or null if there are none. */
  lastLoggedAt: string | null;
  currentStreak: number;
};

/**
 * Rewrite both reminders from scratch to match the current state.
 *
 * Cancel-then-schedule rather than reconcile: there are two reminders and the
 * inactivity one moves every time anything is logged, so working out what
 * changed would cost more than redoing it. Both use fixed identifiers, so a
 * reschedule replaces rather than accumulating a new reminder per log.
 */
export async function syncReminders(state: ReminderState): Promise<void> {
  try {
    installHandler();
    await cancelAllReminders();

    const channelId = Platform.OS === 'android' ? 'reminders' : undefined;

    // Inactivity: measured from the last log, not from now, so opening the app
    // does not quietly push the reminder back and stop it ever arriving.
    const since = state.lastLoggedAt ? new Date(state.lastLoggedAt).getTime() : Date.now();
    const dueAt = since + INACTIVITY_HOURS * 60 * 60 * 1000;
    const seconds = Math.round((dueAt - Date.now()) / 1000);

    await Notifications.scheduleNotificationAsync({
      identifier: INACTIVITY_ID,
      content: {
        title: 'What did you eat?',
        body: 'It has been a while. A quick log keeps your estimates honest.',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        // Never schedule into the past: an overdue reminder fires immediately,
        // which is a notification the moment someone opens the app.
        seconds: Math.max(seconds, 60),
        channelId,
      },
    });

    // Streak protection only makes sense when there is a streak to protect.
    if (state.currentStreak > 0) {
      await Notifications.scheduleNotificationAsync({
        identifier: STREAK_ID,
        content: {
          title: `${state.currentStreak} clean ${state.currentStreak === 1 ? 'day' : 'days'}`,
          body: 'Still going. Log tonight and it keeps running.',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: STREAK_HOUR,
          minute: STREAK_MINUTE,
          channelId,
        },
      });
    }
  } catch {
    // No reminders is an acceptable outcome. A crashed screen is not.
  }
}
