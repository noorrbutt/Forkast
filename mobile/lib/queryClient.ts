import { QueryClient } from '@tanstack/react-query';

/**
 * Tuned for a phone on a flaky connection: one retry, data considered fresh
 * for thirty seconds, and no window focus refetching (there are no windows).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
