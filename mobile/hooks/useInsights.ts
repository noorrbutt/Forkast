import { useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';
import { useAuth } from './useAuth';
import type { Dashboard, Streaks } from '../lib/types';

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
