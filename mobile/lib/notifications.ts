import Constants from 'expo-constants';
import { Platform } from 'react-native';

type NotificationsModule = typeof import('expo-notifications');

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
 *
 * The module is loaded on demand rather than imported at the top of this file,
 * and that is not a style choice. Importing expo-notifications runs its device
 * push token auto registration as a side effect, which throws in Expo Go since
 * SDK 53 removed remote push from that client. Forkast never asks for a push
 * token, but the import alone was enough to take the whole app down before a
 * single screen rendered, and it did, through the Profile tab.
 *
 * So in Expo Go the module is never touched and reminders report themselves
 * unavailable. In a development or production build it loads normally and the
 * feature works. Nothing is silently broken: the Profile screen says which one
 * you are in.
 */

/**
 * Expo Go cannot run this and must never be asked to. Neither can the browser.
 *
 * appOwnership is the check rather than executionEnvironment, for the same
 * reason the map seam uses it: StoreClient covers a development client too,
 * which would disable reminders in exactly the build that supports them.
 *
 * Web is excluded separately, and it is the less obvious half. appOwnership is
 * null in a browser, so the Expo Go check alone said reminders were available
 * there. They are not, and the failure was quiet in the worst way: the
 * permission half of expo-notifications does work on web, so tapping the row
 * raised a real browser permission prompt and flipped it to "On", while the
 * scheduling half has no implementation at all. The user granted a permission
 * and was promised an evening nudge that could never arrive.
 */
export const REMINDERS_AVAILABLE = Constants.appOwnership !== 'expo' && Platform.OS !== 'web';

let cached: NotificationsModule | null = null;

/** The module, or null where loading it would throw or do nothing useful. */
function load(): NotificationsModule | null {
  if (!REMINDERS_AVAILABLE) return null;
  if (cached) return cached;
  try {
    // A require rather than an import, so this is genuinely deferred to the
    // first call rather than hoisted back to module scope by the bundler.
    // The deferral is the point; an import would be hoisted to module scope.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-notifications') as NotificationsModule;
    return cached;
  } catch {
    return null;
  }
}

const INACTIVITY_ID = 'forkast.inactivity';
const STREAK_ID = 'forkast.streak';

/** How long a gap counts as "you have stopped logging". */
const INACTIVITY_HOURS = 30;

/** Evening local hour for the streak reminder, late enough to be actionable. */
const STREAK_HOUR = 20;
const STREAK_MINUTE = 30;

let handlerInstalled = false;

function installHandler(): void {
  const Notifications = load();
  if (!Notifications || handlerInstalled) return;
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
    const Notifications = load();
    if (!Notifications) return false;
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
    const Notifications = load();
    if (!Notifications) return false;
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

async function cancel(identifier: string): Promise<void> {
  try {
    const Notifications = load();
    if (!Notifications) return;
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
    const Notifications = load();
    if (!Notifications) return;
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
