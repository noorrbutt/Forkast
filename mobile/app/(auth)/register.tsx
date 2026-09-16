import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Field, Screen } from '../../components/ui';
import { useRegister } from '../../hooks/useAuth';
import { describeError } from '../../lib/api';
import { useTheme } from '../../theme';

const MIN_PASSWORD = 8;

export default function RegisterScreen() {
  const { colors, spacing, type } = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const register = useRegister();

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const canSubmit = email.trim().length > 0 && password.length >= MIN_PASSWORD && !register.isPending;

  const submit = () => {
    if (!canSubmit) return;
    register.mutate({ email: email.trim(), password });
  };

  return (
    <Screen scroll bottomInset={spacing.xxl}>
      <View style={{ gap: spacing.xl, paddingTop: spacing.lg }}>
        <View style={{ gap: spacing.sm }}>
          <Text style={[type.label, { color: colors.accent }]}>Forkast</Text>
          <Text style={[type.display, { color: colors.text }]}>Start{'\n'}the streak.</Text>
          <Text style={[type.body, { color: colors.muted }]}>
            One account, every meal, no judgement.
          </Text>
        </View>

        <View style={{ gap: spacing.lg }}>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder={`At least ${MIN_PASSWORD} characters`}
            hint={tooShort ? `A little longer, ${MIN_PASSWORD} characters minimum.` : undefined}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={submit}
          />

          {register.isError ? (
            <Text style={[type.caption, { color: colors.danger }]}>{describeError(register.error)}</Text>
          ) : null}

          <Button
            label="Create account"
            size="lg"
            full
            onPress={submit}
            loading={register.isPending}
            disabled={!canSubmit}
          />
          <Button
            label="I already have an account"
            variant="secondary"
            size="lg"
            full
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))}
            disabled={register.isPending}
          />
        </View>
      </View>
    </Screen>
  );
}
