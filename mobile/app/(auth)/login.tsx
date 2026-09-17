import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Field, Screen } from '../../components/ui';
import { useTheme } from '../../theme';
import { useLogin } from '../../hooks/useAuth';
import { describeError } from '../../lib/api';

/**
 * Self-critique, per the style guide section 13.
 *
 * What it was: a frosted bar titled "Sign in", a 48pt headline saying something
 * else, two fields, and two identical full width buttons.
 *
 * What it broke. Section 3, consistency: the screen carried two titles, and the
 * larger one, at 48 against the bar's 21, was not the name of the action that
 * led here. One name per action means the biggest words on this screen are the
 * ones on the button that opened it. Section 2, alignment: "New to Forkast?"
 * was centred between left aligned blocks, so the scroll changed edge three
 * times. Section 7: the primary and the escape hatch were both `size="lg"` and
 * both `full`, which is near equal weight between the one thing this screen is
 * for and a route away from it. Section 5: no cap on the column, so the form
 * ran the full width of a browser.
 *
 * What the one thing is now: "Sign in." at `display`, 48 against a next largest
 * of 16, naming the screen with the same words as the button that reaches it.
 * The bar keeps the back chevron and drops its title, so the name is said once.
 *
 * What was demoted, and why that is correct: the way to registration is now a
 * medium, outlined, left aligned button under a caption rather than a second
 * full width slab. Someone on this screen came here to sign in; the other door
 * has to be findable, not equally loud.
 */

/** Capped so the form never runs the full width of a tablet or a browser. */
const COLUMN_WIDTH = 420;

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
    // No title on the bar. The headline below is the title, and saying it twice
    // is what put two competing sizes on a screen with one job.
    <Screen scroll bottomInset={spacing.xxl} onBack={() => router.back()}>
      <View
        style={{
          width: '100%',
          maxWidth: COLUMN_WIDTH,
          alignSelf: 'center',
          gap: spacing.xl,
          paddingTop: spacing.sm,
        }}
      >
        <View style={{ gap: spacing.sm }}>
          <Text style={[type.display, { color: colors.text }]}>Sign in.</Text>
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

        {/* Left edge shared with everything above it, and quieter than the
            primary action. Labelled with the word people actually look for:
            "Create an account" was the old label, and it is not the phrase
            anyone scans a screen hunting for. */}
        <View style={{ gap: spacing.sm, alignItems: 'flex-start' }}>
          <Text style={[type.caption, { color: colors.muted }]}>New to Forkast?</Text>
          <Button
            label="Sign up"
            variant="secondary"
            onPress={() => router.replace('/register')}
            disabled={login.isPending}
          />
        </View>
      </View>
    </Screen>
  );
}
