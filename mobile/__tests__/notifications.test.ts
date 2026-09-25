/**
 * The local reminder scheduler.
 *
 * Worth testing rather than trusting, for the same reason as the haptics
 * wrapper: every failure here is silent. The module swallows its own errors on
 * purpose, so a reminder scheduled into the past, scheduled twice, or never
 * cancelled would not surface as an error anywhere. It would just mean the app
 * nags at the wrong time, or not at all.
 *
 * What these tests cannot prove is that the OS ever delivers one. That is a
 * question only a device answers.
 */

import * as Notifications from 'expo-notifications';

import { cancelAllReminders, requestReminderPermission, syncReminders } from '../lib/notifications';

const mocked = Notifications as jest.Mocked<typeof Notifications>;

const HOUR_MS = 60 * 60 * 1000;

function scheduledWithId(id: string) {
  return mocked.scheduleNotificationAsync.mock.calls
    .map(([request]) => request)
    .find((request) => request.identifier === id);
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true } as never);
  mocked.requestPermissionsAsync.mockResolvedValue({ granted: true } as never);
});

describe('scheduling', () => {
  it('uses the existing generic copy when the signal is unavailable', async () => {
    await syncReminders({ lastLoggedAt: new Date().toISOString(), currentStreak: 0 });

    expect(scheduledWithId('forkast.inactivity')?.content.body).toBe(
      'It has been a while. A quick log keeps your estimates honest.',
    );
  });

  it('uses the breakfast gap from the backend signal', async () => {
    await syncReminders({
      lastLoggedAt: new Date().toISOString(),
      currentStreak: 0,
      signal: {
        hours_since_last_log: 8,
        current_streak: 0,
        todays_meals_logged: ['breakfast'],
        is_on_junk_streak: false,
      },
    });

    expect(scheduledWithId('forkast.inactivity')?.content.body).toBe(
      "You haven't logged since breakfast.",
    );
  });

  it('uses the junk streak warning from the backend signal', async () => {
    await syncReminders({
      lastLoggedAt: new Date().toISOString(),
      currentStreak: 0,
      signal: {
        hours_since_last_log: 2,
        current_streak: 0,
        todays_meals_logged: ['lunch'],
        is_on_junk_streak: true,
      },
    });

    expect(scheduledWithId('forkast.inactivity')?.content.body).toBe(
      'A junk streak is on today. Want to break it?',
    );
  });

  it('cancels both reminders before scheduling, so a reschedule replaces rather than stacks', async () => {
    await syncReminders({ lastLoggedAt: new Date().toISOString(), currentStreak: 3 });

    const cancelled = mocked.cancelScheduledNotificationAsync.mock.calls.map(([id]) => id);
    expect(cancelled).toEqual(
      expect.arrayContaining(['forkast.inactivity', 'forkast.streak']),
    );
  });

  it('measures the inactivity nudge from the last log, not from now', async () => {
    // Logged 6 hours ago, so the 30 hour nudge is due in roughly 24.
    const sixHoursAgo = new Date(Date.now() - 6 * HOUR_MS).toISOString();

    await syncReminders({ lastLoggedAt: sixHoursAgo, currentStreak: 0 });

    const request = scheduledWithId('forkast.inactivity');
    const seconds = (request?.trigger as { seconds: number }).seconds;
    expect(seconds).toBeGreaterThan(23 * 3600);
    expect(seconds).toBeLessThan(25 * 3600);
  });

  it('never schedules into the past, which would fire the moment the app opens', async () => {
    const longAgo = new Date(Date.now() - 100 * HOUR_MS).toISOString();

    await syncReminders({ lastLoggedAt: longAgo, currentStreak: 0 });

    const request = scheduledWithId('forkast.inactivity');
    expect((request?.trigger as { seconds: number }).seconds).toBeGreaterThan(0);
  });

  it('skips the streak reminder when there is no streak to protect', async () => {
    await syncReminders({ lastLoggedAt: new Date().toISOString(), currentStreak: 0 });

    expect(scheduledWithId('forkast.streak')).toBeUndefined();
  });

  it('schedules a daily evening reminder while a streak is running', async () => {
    await syncReminders({ lastLoggedAt: new Date().toISOString(), currentStreak: 5 });

    const request = scheduledWithId('forkast.streak');
    expect(request).toBeDefined();
    expect(request?.trigger).toMatchObject({ hour: 20, minute: 30 });
    expect(request?.content.title).toContain('5');
  });

  it('reads as singular on the first clean day', async () => {
    await syncReminders({ lastLoggedAt: new Date().toISOString(), currentStreak: 1 });

    expect(scheduledWithId('forkast.streak')?.content.title).toBe('1 clean day');
  });

  it('still sets an inactivity nudge for an account with nothing logged', async () => {
    await syncReminders({ lastLoggedAt: null, currentStreak: 0 });

    expect(scheduledWithId('forkast.inactivity')).toBeDefined();
  });
});

describe('when the platform misbehaves', () => {
  it('does not throw if scheduling fails', async () => {
    mocked.scheduleNotificationAsync.mockRejectedValueOnce(new Error('no notification support'));

    await expect(
      syncReminders({ lastLoggedAt: null, currentStreak: 2 }),
    ).resolves.toBeUndefined();
  });

  it('does not throw if cancelling something that was never scheduled', async () => {
    mocked.cancelScheduledNotificationAsync.mockRejectedValue(new Error('unknown identifier'));

    await expect(cancelAllReminders()).resolves.toBeUndefined();
  });

  it('reports declined rather than throwing when permission is refused', async () => {
    mocked.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true } as never);
    mocked.requestPermissionsAsync.mockResolvedValue({ granted: false } as never);

    await expect(requestReminderPermission()).resolves.toBe(false);
  });

  it('does not ask again once the user has permanently declined', async () => {
    mocked.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false } as never);

    expect(await requestReminderPermission()).toBe(false);
    expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});
