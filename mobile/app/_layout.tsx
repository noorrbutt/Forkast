// Imported per weight, not from the package root. The root barrel re-exports
// every cut, so Metro then bundles all fifteen of them, italics included: 600KB
// of font for the four faces this app renders. These four subpaths ship 156KB.
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CrashView } from '../components/CrashView';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { queryClient } from '../lib/queryClient';
import { ThemeProvider, useTheme } from '../theme';

/**
 * Hold the native splash until the app can actually paint itself.
 *
 * Called at module scope, before the first render, because the splash hides on
 * its own at the first frame otherwise. That is what shipped: the splash lifted
 * straight onto a bare spinner while the stored token was read back, so launch
 * was three different backgrounds in two seconds.
 *
 * Failure is ignored on purpose. If the splash module is unavailable the app
 * must still start; the cost is a flash, not a broken launch.
 */
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Bootstrapping() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

function RootNavigator() {
  const { ready, signedIn, needsSetup } = useAuth();
  const { colors, isDark } = useTheme();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const inAuthGroup = segments[0] === '(auth)';

    const inSetup = segments[0] === 'setup';

    if (!signedIn && !inAuthGroup) {
      // The welcome screen, not the form. Someone who has never used
      // Forkast should be told what it is before being asked who they are.
      router.replace('/welcome');
    } else if (signedIn && needsSetup && !inSetup) {
      // A brand new account has the server's default timezone, which decides
      // which day every meal and streak lands in. Asking now costs one screen;
      // finding out later costs days that cannot be re-bucketed.
      router.replace('/setup');
    } else if (signedIn && !needsSetup && (inAuthGroup || inSetup)) {
      router.replace('/');
    }
  }, [ready, signedIn, needsSetup, segments, router]);

  if (!ready) return <Bootstrapping />;

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="setup" />
        <Stack.Screen name="map" />
        <Stack.Screen name="logs/[id]" />
      </Stack>
    </>
  );
}

/**
 * The app's last line of defence, picked up by expo-router.
 *
 * Exporting a component with this exact name from a layout makes expo-router
 * wrap that layout in its `Try` boundary. Without one, a single throw during
 * render unmounts the whole tree: in Expo Go and the browser that is the red
 * screen, and in a shipped build it is a blank page with no route left to
 * navigate back to.
 *
 * This one sits at the root, so it catches anything the tab level boundary does
 * not, including a failure in the providers themselves. That is also why
 * CrashView refuses to use the theme context: at this level, it is gone.
 */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return <CrashView error={error} retry={() => void retry()} />;
}

export default function RootLayout() {
  // Hidden once the tree has actually laid out, rather than at the first frame,
  // so the handover happens against real content.
  const onReady = useCallback(() => {
    void SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SafeAreaProvider>
          <AuthProvider>
            <View style={{ flex: 1 }} onLayout={onReady}>
              <RootNavigator />
            </View>
          </AuthProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
