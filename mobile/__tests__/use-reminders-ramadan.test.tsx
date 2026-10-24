/**
 * useReminders' coordination with Ramadan mode: while it's on, the standard
 * reminders step aside for sehri/iftar ones, and turning it off removes every
 * Ramadan reminder outright (the one thing the task's acceptance criteria
 * actually asks for).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import type { ReactNode } from 'react';

import { useReminders } from '../hooks/useReminders';
import { RamadanProvider, useRamadan } from '../hooks/useRamadan';
import { writeRamadanSettings } from '../lib/ramadanStore';

/** Both hooks together, the way Profile and Home really use them, so the
 * test can flip Ramadan mode through its own public setter. */
function useCombined() {
  const ramadan = useRamadan();
  const reminders = useReminders();
  return { ramadan, reminders };
}

jest.mock('../hooks/useInsights', () => ({
  useReminderSignal: () => ({ isSuccess: true, isFetching: false, data: undefined }),
  useStreaks: () => ({ data: { current_streak: 0, longest_streak: 0 } }),
  useWeeklyDigest: () => ({ isSuccess: true, isFetching: false, data: undefined }),
}));

jest.mock('../hooks/useLogs', () => ({
  useLogs: () => ({ data: { items: [], total: 0 } }),
}));

const mocked = Notifications as jest.Mocked<typeof Notifications>;

// Same reasoning as __tests__/use-ramadan.test.ts: jest-expo's auto-mock for
// expo-secure-store resolves every call without storing anything, so a write
// followed by a read would see nothing written. A small Map-backed mock
// stands in for the OS keystore.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItemAsync: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RamadanProvider>{children}</RamadanProvider>
    </QueryClientProvider>
  );
}

function scheduledIds(): string[] {
  return mocked.scheduleNotificationAsync.mock.calls.map(([request]) => request.identifier as string);
}

beforeEach(async () => {
  jest.clearAllMocks();
  mocked.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true } as never);
  await writeRamadanSettings({ enabled: false, cityId: 'karachi', offsetMin: 0, suggestionDismissed: false, dismissedEnded: false });
});

test('Ramadan mode on: sehri/iftar reminders are scheduled, not the standard three', async () => {
  await writeRamadanSettings({ enabled: true, cityId: 'karachi', offsetMin: 0, suggestionDismissed: false, dismissedEnded: false });

  const { result } = renderHook(() => useCombined(), { wrapper });
  await waitFor(() => expect(result.current.ramadan.enabled).toBe(true));
  await act(async () => {
    await result.current.reminders.enable();
  });

  await waitFor(() => expect(scheduledIds().some((id) => id.startsWith('forkast.ramadan.'))).toBe(true));
  expect(scheduledIds()).not.toContain('forkast.inactivity');
});

test('turning Ramadan mode off cancels every Ramadan reminder', async () => {
  await writeRamadanSettings({ enabled: true, cityId: 'karachi', offsetMin: 0, suggestionDismissed: false, dismissedEnded: false });

  const { result } = renderHook(() => useCombined(), { wrapper });
  await waitFor(() => expect(result.current.ramadan.enabled).toBe(true));
  await act(async () => {
    await result.current.reminders.enable();
  });
  await waitFor(() => expect(scheduledIds().some((id) => id.startsWith('forkast.ramadan.'))).toBe(true));

  act(() => result.current.ramadan.setEnabled(false));
  await waitFor(() => expect(result.current.ramadan.enabled).toBe(false));

  await waitFor(() => {
    const cancelled = mocked.cancelScheduledNotificationAsync.mock.calls.map(([id]) => id);
    expect(cancelled.some((id) => (id as string).startsWith('forkast.ramadan.'))).toBe(true);
  });
});
