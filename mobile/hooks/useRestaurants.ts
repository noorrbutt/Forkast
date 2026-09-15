import { useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';
import { useAuth } from './useAuth';
import type { Restaurant } from '../lib/types';

export function useRestaurants(term = '') {
  const { signedIn } = useAuth();
  const query = term.trim();
  return useQuery({
    queryKey: ['restaurants', query],
    enabled: signedIn,
    staleTime: 60_000,
    queryFn: async () => {
      const response = await api.get<Restaurant[]>('/restaurants', {
        params: query.length > 0 ? { q: query } : undefined,
      });
      return response.data;
    },
  });
}
