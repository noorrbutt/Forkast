// Imported per weight, not from the package root. The root barrel re-exports
// every cut, so Metro then bundles all fifteen of them, italics included: 600KB
// of font for the four faces this app renders. These four subpaths ship 156KB.
import { Figtree_300Light } from '@expo-google-fonts/figtree/300Light';
import { Figtree_400Regular } from '@expo-google-fonts/figtree/400Regular';
import { Figtree_500Medium } from '@expo-google-fonts/figtree/500Medium';
import { Figtree_600SemiBold } from '@expo-google-fonts/figtree/600SemiBold';
import { useFonts } from 'expo-font';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, usePathname, useRouter, useSegments } from 'expo-router';
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
 * was three different backgrounds in two seconds. With a typeface to load as
 * well, not holding it would mean text painting in the system font and then
 * jumping to Figtree in front of the reader.
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
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const inAuthGroup = segments[0] === '(auth)';
    const isRecoveryRoute =
      inAuthGroup &&
      ['/check-email', '/forgot-password', '/reset-password', '/reset-confirmation'].some(
        (route) => pathname.endsWith(route),
      );

    const inSetup = segments[0] === 'setup';

    if (!signedIn && !inAuthGroup) {
      // The welcome screen, not the form. Someone who has never used
      // Forkast should be told what it is before being asked who they are.
      router.replace('/welcome');
    } else if (signedIn && needsSetup && !inSetup && !isRecoveryRoute) {
      // A brand new account has the server's default timezone, which decides
      // which day every meal and streak lands in. Asking now costs one screen;
      // finding out later costs days that cannot be re-bucketed.
      router.replace('/setup');
    } else if (signedIn && !needsSetup && (inAuthGroup || inSetup) && !isRecoveryRoute) {
      router.replace('/');
    }
  }, [ready, signedIn, needsSetup, segments, pathname, router]);

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
  /**
   * The four cuts the type scale actually asks for, and no more.
   *
   * 300 for the numerals the app leads with, 400 for reading text, 500 for the
   * quiet small label, 600 for titles and button labels. Italics and the
   * heavier weights are not loaded because nothing renders them, and every
   * unused cut is 40KB of launch.
   */
  const [fontsLoaded, fontError] = useFonts({
    Figtree_300Light,
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
  });

  // A font that fails to load is not a reason to show nothing forever: the
  // scale falls back to the platform face, which is what shipped before this.
  const ready = fontsLoaded || Boolean(fontError);

  const onReady = useCallback(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

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
