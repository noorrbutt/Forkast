import { QueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';

/**
 * Tuned for a phone on a flaky connection: one retry, and data considered fresh
 * for thirty seconds.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      /**
       * On web only, and it is the one refresh the browser has.
       *
       * This was off everywhere, reasoning that there are no windows. True on a
       * phone, where pull to refresh is the gesture and every screen wires one
       * up. In a browser that gesture does not exist: react-native-web renders
       * RefreshControl as a bare View and throws `onRefresh` away, so there was
       * no way to refresh any screen at all short of reloading the page. Coming
       * back to the tab is the browser's equivalent, and with a thirty second
       * staleTime in front of it, it costs a request only when the data is
       * genuinely old.
       */
      refetchOnWindowFocus: Platform.OS === 'web',
    },
    mutations: {
      retry: 0,
    },
  },
});
