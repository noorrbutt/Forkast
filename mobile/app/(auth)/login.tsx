import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Field, Screen } from '../../components/ui';
import { useLogin } from '../../hooks/useAuth';
import { describeError } from '../../lib/api';
import { useTheme } from '../../theme';

export default function LoginScreen() {
  const { colors, spacing, type } = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const login = useLogin();

  /**
   * The button stays live even with the fields empty, and says what is missing
   * when pressed.
   *
   * Disabling it until both fields were filled hid the affordance behind the
   * very action it existed to invite: the disabled fill dropped to 1.39:1 in
   * light theme, so someone looking at the screen before typing saw no button
   * at all and reasonably concluded there wasn't one.
   */
  const submit = () => {
    if (login.isPending) return;
    if (!email.trim()) {
      setProblem('Enter the email you signed up with.');
      return;
    }
    if (!password) {
      setProblem('Enter your password.');
      return;
    }
    setProblem(null);
    login.mutate({ email: email.trim(), password });
  };

  const message = problem ?? (login.isError ? describeError(login.error) : null);

  return (
    <Screen scroll bottomInset={spacing.xxl} title="Sign in" onBack={() => router.back()}>
      <View style={{ gap: spacing.xl, paddingTop: spacing.sm }}>
        <View style={{ gap: spacing.sm }}>
          <Text style={[type.display, { color: colors.text }]}>Welcome{'\n'}back.</Text>
          <Text style={[type.body, { color: colors.muted }]}>
            Pick up where your last meal left off.
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
            placeholder="Your password"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
          />

          {message ? <Text style={[type.caption, { color: colors.danger }]}>{message}</Text> : null}

          <Button label="Sign in" size="lg" full onPress={submit} loading={login.isPending} />
        </View>

        <View style={{ gap: spacing.sm, alignItems: 'stretch' }}>
          <Text style={[type.caption, { color: colors.muted, textAlign: 'center' }]}>
            New to Forkast?
          </Text>
          {/* Labelled with the word people actually look for. "Create an
              account" was the old label, and it is not the phrase anyone scans
              a screen hunting for. */}
          <Button
            label="Sign up"
            variant="secondary"
            size="lg"
            full
            onPress={() => router.replace('/register')}
            disabled={login.isPending}
          />
        </View>
      </View>
    </Screen>
  );
}
