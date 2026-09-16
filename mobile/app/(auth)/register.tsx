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
  const [problem, setProblem] = useState<string | null>(null);
  const register = useRegister();

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;

  // Live, like the sign in button, and for the same reason: an affordance that
  // only appears once you have done the thing it invites is not an affordance.
  const submit = () => {
    if (register.isPending) return;
    if (!email.trim()) {
      setProblem('Enter an email so you can get back in.');
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setProblem(`Pick a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setProblem(null);
    register.mutate({ email: email.trim(), password });
  };

  const message = problem ?? (register.isError ? describeError(register.error) : null);

  return (
    <Screen scroll bottomInset={spacing.xxl} title="Sign up" onBack={() => router.back()}>
      <View style={{ gap: spacing.xl, paddingTop: spacing.sm }}>
        <View style={{ gap: spacing.sm }}>
          <Text style={[type.display, { color: colors.text }]}>Start{'\n'}the streak.</Text>
          <Text style={[type.body, { color: colors.muted }]}>
            One account, every meal, no judgement.
          </Text>
        </View>

        <View style={{ gap: spacing.lg }}>
          <Field
            label="Email"
            value={email}
            onChangeText={(next) => {
              setProblem(null);
              setEmail(next);
            }}
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
            onChangeText={(next) => {
              setProblem(null);
              setPassword(next);
            }}
            placeholder={`At least ${MIN_PASSWORD} characters`}
            hint={tooShort ? `A little longer, ${MIN_PASSWORD} characters minimum.` : undefined}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={submit}
          />

          {message ? <Text style={[type.caption, { color: colors.danger }]}>{message}</Text> : null}

          <Button label="Sign up" size="lg" full onPress={submit} loading={register.isPending} />
        </View>

        <View style={{ gap: spacing.sm, alignItems: 'stretch' }}>
          <Text style={[type.caption, { color: colors.muted, textAlign: 'center' }]}>
            Already have an account?
          </Text>
          <Button
            label="Sign in"
            variant="secondary"
            size="lg"
            full
            onPress={() => router.replace('/login')}
            disabled={register.isPending}
          />
        </View>
      </View>
    </Screen>
  );
}
