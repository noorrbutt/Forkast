import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../lib/api';
import type { BurnEntry } from '../lib/types';

/**
 * Today's burned calories.
 *
 * Returns null rather than zero when nothing has been entered, and the
 * distinction matters on screen: null means "you have not told us", which
 * deserves a prompt, while zero means "I did not burn anything today", which
 * deserves to be left alone.
 */
export function useBurnToday() {
  return useQuery({
    queryKey: ['burn', 'today'],
    queryFn: async () => {
      const response = await api.get<BurnEntry | null>('/burn/today');
      return response.data ?? null;
    },
  });
}

export function useSetBurn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (calories: number) => {
      // PUT, not POST: there is one number per day, so saving twice leaves the
      // same state rather than stacking entries.
      const response = await api.put<BurnEntry>('/burn', { calories });
      return response.data;
    },
    onSuccess: (entry) => {
      queryClient.setQueryData(['burn', 'today'], entry);
      // The dashboard's net figure is derived from this, so it is stale now.
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useClearBurn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (day: string) => {
      await api.delete(`/burn/${day}`);
    },
    onSuccess: () => {
      queryClient.setQueryData(['burn', 'today'], null);
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
