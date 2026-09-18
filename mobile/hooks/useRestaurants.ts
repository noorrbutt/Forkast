import { useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';
import { useAuth } from './useAuth';
import { useDebounced } from './useDebounced';
import type { Restaurant } from '../lib/types';

/**
 * The shared registry, for the autocomplete on the log screen. Listing every
 * restaurant is the point there: it is what stops the same place being typed
 * in five slightly different ways.
 */
export function useRestaurants(term = '') {
  const { signedIn } = useAuth();
  // Debounced, and gated on having some substance, both of which this was
  // missing while its sibling useSearch had them. Wired straight to
  // onChangeText it fired one request per keystroke, so typing a restaurant
  // name cost about fifteen round trips and the list flickered as they landed
  // out of order.
  const query = useDebounced(term.trim());
  return useQuery({
    // Namespaced under 'search' rather than sitting directly under the search
    // term. The two hooks here hit the same endpoint with different parameters,
    // so a bare term would collide with the visited list the moment someone
    // typed the word it happens to be keyed on, and the picker would show the
    // map's hundred visited places instead of a search result.
    queryKey: ['restaurants', 'search', query],
    // An empty term is a real request: it lists the registry for the picker.
    // One or two letters is not, it just matches most of it.
    enabled: signedIn && (query.length === 0 || query.length >= 2),
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
    queryKey: ['restaurants', 'visited'],
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
