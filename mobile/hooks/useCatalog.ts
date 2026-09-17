import { useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';
import { useAuth } from './useAuth';
import { useDebounced } from './useDebounced';
import type { Category, Cuisine, RefId, SearchResults } from '../lib/types';

export function useCuisines() {
  const { signedIn } = useAuth();
  return useQuery({
    queryKey: ['cuisines'],
    enabled: signedIn,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const response = await api.get<Cuisine[]>('/cuisines');
      return response.data;
    },
  });
}

export function useCategories(cuisineId?: RefId | null) {
  const { signedIn } = useAuth();
  return useQuery({
    queryKey: ['categories', cuisineId ?? 'all'],
    enabled: signedIn,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const response = await api.get<Category[]>('/categories', {
        params: cuisineId ? { cuisine_id: cuisineId } : undefined,
      });
      return response.data;
    },
  });
}

/** Fires only once the query has some substance, to keep the keyboard responsive. */
export function useSearch(term: string) {
  const { signedIn } = useAuth();
  // The length gate below kept the shortest queries off the wire, but every
  // keystroke past the second still sent one. Typing "chicken biryani" was
  // fourteen requests where one would do.
  const query = useDebounced(term.trim());
  return useQuery({
    queryKey: ['search', query],
    enabled: signedIn && query.length >= 2,
    staleTime: 60_000,
    queryFn: async () => {
      const response = await api.get<SearchResults>('/search', { params: { q: query } });
      return response.data;
    },
  });
}
