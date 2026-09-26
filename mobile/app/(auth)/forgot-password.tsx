import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Text, View } from 'react-native';

import { Button, Field, FormError, Screen } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { useTheme } from '../../theme';

export default function ForgotPasswordScreen() {
  const { colors, layout, spacing, type } = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const request = useMutation({
    mutationFn: async (address: string) => {
      await api.post('/auth/forgot-password', { email: address });
    },
    onSuccess: () =>
      router.replace({ pathname: '/reset-confirmation', params: { stage: 'request' } }),
  });

  const submit = () => {
    const address = email.trim();
    if (!address) {
      setProblem('Enter the email address on your account.');
      return;
    }
    setProblem(null);
    request.mutate(address);
  };

  const message = problem ?? (request.isError ? describeError(request.error) : null);

  return (
    <Screen scroll onBack={() => router.back()}>
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
          <Text style={[type.display, { color: colors.text }]}>Reset your password.</Text>
          <Text style={[type.body, { color: colors.muted }]}>
            Enter your account email and we’ll send a reset link if it’s eligible.
          </Text>
        </View>

        <View style={{ gap: spacing.lg }}>
          <Field
            label="Email"
            value={email}
            onChangeText={(value) => {
              setProblem(null);
              setEmail(value);
            }}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          {message ? <FormError>{message}</FormError> : null}
          <Button label="Send reset link" size="lg" full onPress={submit} loading={request.isPending} />
        </View>
      </View>
    </Screen>
  );
}
