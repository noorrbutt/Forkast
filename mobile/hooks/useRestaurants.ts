import { useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';
import { useAuth } from './useAuth';
import type { Restaurant } from '../lib/types';

/**
 * The shared registry, for the autocomplete on the log screen. Listing every
 * restaurant is the point there: it is what stops the same place being typed
 * in five slightly different ways.
 */
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

/**
 * Only the places this user has actually eaten at.
 *
 * The map is a personal food heatmap, so the shared registry is the wrong list
 * for it: it pins restaurants they have never been to and quietly shows them
 * which places other people have been adding.
 */
export function useVisitedRestaurants() {
  const { signedIn } = useAuth();
  return useQuery({
    queryKey: ['restaurants', 'mine'],
    enabled: signedIn,
    staleTime: 60_000,
    queryFn: async () => {
      const response = await api.get<Restaurant[]>('/restaurants', {
        params: { mine: true, limit: 100 },
      });
      return response.data;
    },
  });
}
