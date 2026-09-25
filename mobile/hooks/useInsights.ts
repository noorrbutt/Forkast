import { useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';
import { useAuth } from './useAuth';
import type { Dashboard, ReminderSignal, Streaks, Trend } from '../lib/types';

export function useDashboard() {
  const { signedIn } = useAuth();
  return useQuery({
    queryKey: ['dashboard'],
    enabled: signedIn,
    queryFn: async () => {
      const response = await api.get<Dashboard>('/dashboard');
      return response.data;
    },
  });
}

export function useStreaks() {
  const { signedIn } = useAuth();
  return useQuery({
    queryKey: ['streaks'],
    enabled: signedIn,
    queryFn: async () => {
      const response = await api.get<Streaks>('/streaks');
      return response.data;
    },
  });
}

export function useReminderSignal() {
  const { signedIn } = useAuth();
  return useQuery({
    queryKey: ['reminder-signal'],
    enabled: signedIn,
    queryFn: async () => {
      const response = await api.get<ReminderSignal>('/insights/reminder-signal');
      return response.data;
    },
  });
}

/**
 * This calendar month against last, in the user's own timezone.
 *
 * Separate from the dashboard because it answers a different question. The 14
 * day chart shows the shape of a fortnight; this says whether the month is
 * going better or worse than the one before it, which is the thing people
 * actually want to know and cannot read off a two week window.
 */
export function useTrend() {
  const { signedIn } = useAuth();
  return useQuery({
    queryKey: ['trend'],
    enabled: signedIn,
    queryFn: async () => {
      const response = await api.get<Trend>('/trend');
      return response.data;
    },
  });
}
