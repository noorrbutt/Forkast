import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../lib/api';
import { useAuth } from './useAuth';
import type { Goal, Plan } from '../lib/types';

export function usePlans() {
  const { signedIn } = useAuth();
  return useQuery({
    queryKey: ['plans'],
    enabled: signedIn,
    queryFn: async () => {
      const response = await api.get<Plan[]>('/plans');
      return response.data;
    },
  });
}

export function useGeneratePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (goal: Goal) => {
      const response = await api.post<Plan>('/plans', { goal }, { timeout: 45000 });
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
    },
  });
}
