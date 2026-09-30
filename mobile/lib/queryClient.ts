import NetInfo from '@react-native-community/netinfo';
import { QueryClient, onlineManager } from '@tanstack/react-query';
import { Platform } from 'react-native';

/**
 * React Query's default online detection is `navigator.onLine`, which does
 * not exist in React Native: every build reads it as always online, so a
 * request made with no signal at all was still tried immediately, failed,
 * and surfaced as an ordinary error rather than as "no connection yet" --
 * indistinguishable from a broken save to whoever was looking at the screen.
 * NetInfo is the actual signal on a phone, and wiring it here is what makes
 * `networkMode: 'offlineFirst'` below mean something: a mutation made with no
 * connection is held as pending rather than attempted and failed, and
 * everything paused resumes automatically on this same listener firing true
 * again. See useCreateLog in hooks/useLogs.ts for what a paused log looks
 * like on screen meanwhile.
 */
onlineManager.setEventListener((setOnline) => {
  return NetInfo.addEventListener((state) => {
    setOnline(state.isConnected === true && state.isInternetReachable !== false);
  });
});

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
      // A read with no connection queues behind the same online signal a
      // write does, rather than failing outright and showing an ErrorState
      // for a screen that would have rendered fine three seconds later.
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: 0,
      // The point of this whole file: a mutation made with no signal is held
      // as `isPaused`, not run and failed. useCreateLog's optimistic insert
      // (onMutate) still fires immediately either way, so the meal appears
      // in the diary the instant it is logged; this is what decides whether
      // the follow-up network call is attempted now or queued for when
      // `onlineManager` next reports true.
      networkMode: 'offlineFirst',
    },
  },
});
