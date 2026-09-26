import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Text, View } from 'react-native';

import { Button, Field, FormError, Screen } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { api, describeError } from '../../lib/api';
import { useTheme } from '../../theme';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function ResetPasswordScreen() {
  const { colors, layout, spacing, type } = useTheme();
  const { signOut } = useAuth();
  const router = useRouter();
  const { token: rawToken } = useLocalSearchParams<{ token?: string | string[] }>();
  const token = first(rawToken);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const reset = useMutation({
    mutationFn: async () => {
      await api.post('/auth/reset-password', { token, new_password: password });
    },
    onSuccess: async () => {
      await signOut();
      router.replace({ pathname: '/reset-confirmation', params: { stage: 'reset' } });
    },
  });

  const submit = () => {
    if (!token) {
      setProblem('This reset link is missing or incomplete. Request another one.');
      return;
    }
    if (password.length < 8) {
      setProblem('Choose a password of at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setProblem('Those passwords do not match.');
      return;
    }
    setProblem(null);
    reset.mutate();
  };

  const message = problem ?? (reset.isError ? describeError(reset.error) : null);

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
          <Text style={[type.display, { color: colors.text }]}>Choose a new password.</Text>
          <Text style={[type.body, { color: colors.muted }]}>Use at least 8 characters.</Text>
        </View>

        <View style={{ gap: spacing.lg }}>
          <Field
            label="New password"
            value={password}
            onChangeText={(value) => {
              setProblem(null);
              setPassword(value);
            }}
            placeholder="At least 8 characters"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            reveal
            textContentType="newPassword"
          />
          <Field
            label="Confirm new password"
            value={confirm}
            onChangeText={(value) => {
              setProblem(null);
              setConfirm(value);
            }}
            placeholder="Type it once more"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            reveal
            textContentType="newPassword"
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          {message ? <FormError>{message}</FormError> : null}
          <Button label="Reset password" size="lg" full onPress={submit} loading={reset.isPending} />
          {!token || reset.isError ? (
            <Button
              label="Request another reset link"
              variant="secondary"
              onPress={() => router.replace('/forgot-password')}
            />
          ) : null}
        </View>
      </View>
    </Screen>
  );
}
