import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { Button, Screen } from '../../components/ui';
import { useTheme } from '../../theme';

export default function ResetConfirmationScreen() {
  const { colors, layout, spacing, type } = useTheme();
  const router = useRouter();
  const { stage } = useLocalSearchParams<{ stage?: string }>();
  const passwordReset = stage === 'reset';

  return (
    <Screen>
      <View
        style={{
          width: '100%',
          maxWidth: layout.formWidth,
          alignSelf: 'center',
          gap: spacing.xl,
          paddingTop: spacing.xxl,
        }}
      >
        <View style={{ gap: spacing.sm }}>
          <Text style={[type.display, { color: colors.text }]}>
            {passwordReset ? 'Password reset.' : 'Check your email.'}
          </Text>
          <Text style={[type.body, { color: colors.muted }]}>
            {passwordReset
              ? 'Your password has been updated. Sign in with the new one.'
              : 'If an eligible account uses that address, a password reset link is on its way.'}
          </Text>
        </View>
        <Button label="Back to sign in" size="lg" full onPress={() => router.replace('/login')} />
      </View>
    </Screen>
  );
}
