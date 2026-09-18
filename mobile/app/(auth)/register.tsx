import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Field, FormError, Screen, TextLink } from '../../components/ui';
import { useTheme } from '../../theme';
import { useRegister } from '../../hooks/useAuth';
import { describeError } from '../../lib/api';

/**
 * Self-critique, per the style guide section 13.
 *
 * What it was: a frosted bar titled "Sign up", a 48pt headline saying something
 * else, two fields, and two identical full width buttons.
 *
 * What it broke. The same three things as its twin, which is the point: two
 * screens with one job each were solving the same problem two ways in the
 * details. Section 3, consistency: two titles, and the 48pt one was not the
 * name of the action. Section 7: primary and escape hatch both `size="lg"` and
 * both `full`. Section 5: no cap on the column.
 *
 * What the one thing is now: "Sign up." at `display`, 48 against a next largest
 * of 16, the same words as the button that reaches it.
 *
 * What was demoted, and why that is correct: the way back to signing in is one
 * line of prose with the action tinted, "Already have an account? Sign in".
 * Someone who already has an account is the exception on this screen, and the
 * exception gets a findable control rather than an equally sized one. It was
 * briefly a full width outlined button, and that made the two read as a choice.
 *
 * It sits centred, on the same axis as the primary button above it. Its twin on
 * the sign in screen is the same component with the words swapped, which is the
 * point: these two screens have one job each and should not solve it two ways.
 */

const MIN_PASSWORD = 8;


export default function RegisterScreen() {
  const { colors, layout, spacing, type } = useTheme();
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
    // No title on the bar, for the reason given on the sign in screen.
    <Screen scroll bottomInset={spacing.xxl} onBack={() => router.back()}>
      <View
        style={{
          width: '100%',
          maxWidth: layout.formWidth,
          alignSelf: 'center',
          gap: spacing.xl,
          paddingTop: spacing.sm,
        }}
      >
        <View style={{ gap: spacing.sm }}>
          <Text style={[type.display, { color: colors.text }]}>Sign up.</Text>
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

          {message ? <FormError>{message}</FormError> : null}

          <Button label="Sign up" size="lg" full onPress={submit} loading={register.isPending} />
        </View>

        {/* The same component and the same placement as its twin on the sign
            in screen, with the words swapped. */}
        <TextLink
          prompt="Already have an account?"
          label="Sign in"
          onPress={() => router.replace('/login')}
          disabled={register.isPending}
          accessibilityHint="Sign in to an account you already have"
        />
      </View>
    </Screen>
  );
}
