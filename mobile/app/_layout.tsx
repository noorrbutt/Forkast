import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../hooks/useAuth';
import { queryClient } from '../lib/queryClient';
import { ThemeProvider, useTheme } from '../theme';

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

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SafeAreaProvider>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
