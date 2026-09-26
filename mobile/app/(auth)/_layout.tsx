import { Stack } from 'expo-router';

import { useTheme } from '../../theme';

export default function AuthLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="check-email" />
    </Stack>
  );
}
