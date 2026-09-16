import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../lib/api';
import { useAuth } from './useAuth';
import type { FoodLog, LogInput, LogPage, Uuid } from '../lib/types';

export function useLogs(limit = 20, offset = 0) {
  const { signedIn } = useAuth();
  return useQuery({
    queryKey: ['logs', limit, offset],
    enabled: signedIn,
    queryFn: async () => {
      const response = await api.get<LogPage>('/logs', { params: { limit, offset } });
      return response.data;
    },
  });
}

export function useCreateLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: LogInput) => {
      const response = await api.post<FoodLog>('/logs', input);
      return response.data;
    },
    onSuccess: () => {
      // Drop all three so the client is ready for the day these are computed
      // for real. Today the dashboard and streaks are seed snapshots and do
      // not move when a log is added.
      void queryClient.invalidateQueries({ queryKey: ['logs'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['streaks'] });
    },
  });
}

export function useDeleteLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: Uuid) => {
      await api.delete(`/logs/${id}`);
      return id;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['logs'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['streaks'] });
    },
  });
}
