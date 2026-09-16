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
  const login = useLogin();

  const canSubmit = email.trim().length > 0 && password.length > 0 && !login.isPending;

  const submit = () => {
    if (!canSubmit) return;
    login.mutate({ email: email.trim(), password });
  };

  return (
    <Screen scroll bottomInset={spacing.xxl}>
      <View style={{ gap: spacing.xl, paddingTop: spacing.lg }}>
        <View style={{ gap: spacing.sm }}>
          <Text style={[type.label, { color: colors.accent }]}>Forkast</Text>
          <Text style={[type.display, { color: colors.text }]}>Eat{'\n'}on record.</Text>
          <Text style={[type.body, { color: colors.muted }]}>
            Log what you eat, see the pattern, keep the fun in it.
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
            placeholder="Your password"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
          />

          {login.isError ? (
            <Text style={[type.caption, { color: colors.danger }]}>{describeError(login.error)}</Text>
          ) : null}

          {/*
            Both ways in are buttons, side by side, and both sit above the fold
            before the keyboard opens. This used to be one button plus a caption
            sized text link at the bottom of a scrolling screen, which on a phone
            put the only route to registration off screen. Someone arriving
            without an account could not find how to make one.
          */}
          <Button
            label="Sign in"
            size="lg"
            full
            onPress={submit}
            loading={login.isPending}
            disabled={!canSubmit}
          />
          <Button
            label="Create an account"
            variant="secondary"
            size="lg"
            full
            onPress={() => router.push('/register')}
            disabled={login.isPending}
          />
        </View>
      </View>
    </Screen>
  );
}
