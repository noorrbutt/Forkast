import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../lib/api';
import { useAuth } from './useAuth';
import type { FoodLog, LogInput, LogPage, LogPatch, Uuid } from '../lib/types';

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

export function useLog(id: Uuid | null) {
  const { signedIn } = useAuth();
  return useQuery({
    queryKey: ['log', id],
    enabled: signedIn && id !== null,
    queryFn: async () => {
      const response = await api.get<FoodLog>(`/logs/${id}`);
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
      // The dashboard and streaks are aggregated from food_logs on the
      // server, so adding a log really does move both of them.
      void queryClient.invalidateQueries({ queryKey: ['logs'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['streaks'] });
    },
  });
}

export function useUpdateLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: Uuid; patch: LogPatch }) => {
      const response = await api.patch<FoodLog>(`/logs/${id}`, patch);
      return response.data;
    },
    onSuccess: (log) => {
      queryClient.setQueryData(['log', log.id], log);
      // Editing the dish, category or serving size makes the server recompute
      // the estimate, so the totals and the streak can both move.
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
    onSuccess: (id) => {
      queryClient.removeQueries({ queryKey: ['log', id] });
      void queryClient.invalidateQueries({ queryKey: ['logs'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['streaks'] });
    },
  });
}

/**
 * Log the same meal again.
 *
 * The server copies the old row rather than the client resubmitting a form,
 * which is what makes this one tap: nothing has to be re-derived here, and the
 * calorie figure is guaranteed to match the meal it was copied from.
 */
export function useRepeatLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: Uuid) => {
      const response = await api.post<FoodLog>(`/logs/${id}/repeat`);
      return response.data;
    },
    onSuccess: () => {
      // A new meal on today, so every derived figure moves.
      void queryClient.invalidateQueries({ queryKey: ['logs'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['streaks'] });
      void queryClient.invalidateQueries({ queryKey: ['trend'] });
    },
  });
}
