import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import {
  Button,
  Field,
  FormError,
  GoogleButton,
  OrRule,
  Screen,
  TextLink,
} from '../../components/ui';
import { useTheme } from '../../theme';
import { useGoogleAuth, useLogin } from '../../hooks/useAuth';
import { useContinueWithGoogle } from '../../hooks/useContinueWithGoogle';
import { describeError } from '../../lib/api';
import { demoAccount } from '../../lib/demoHint';

/**
 * Sign in.
 *
 * "Sign in." at `display` names the screen with the same words as the button
 * that reached it, and the header bar keeps its back chevron but drops its
 * title so the name is said once. The way to registration is one line of
 * prose with the action tinted, "New to Forkast? Sign up", rather than a
 * second full width button -- two controls of identical size leave someone
 * working out which one they came here for. TextLink carries the rest of
 * that reasoning.
 *
 * That line is centred on the same axis as the primary button above it, so
 * the lower block has one centre line rather than a centred caption over a
 * left aligned button.
 *
 * On why Google is here as well as on the sign up screen.
 *
 * It is not symmetry for its own sake. An account created by pressing
 * "Continue with Google" has no password and cannot be given one, so a sign in
 * screen offering only an email and a password would be a locked door for
 * everybody who took the shortcut on the previous screen. Signing up one way
 * and being unable to sign in the same way is not a trap anybody walks into
 * knowingly.
 *
 * The words are identical on both screens, and again not for symmetry: the
 * phone holds a token and genuinely does not know whether an account exists
 * behind it, so promising "Sign in" here would be a promise it cannot keep for
 * somebody who has never registered. The server decides, and it is one route.
 */


export default function LoginScreen() {
  const { colors, layout, spacing, type } = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const login = useLogin();
  const googleAuth = useGoogleAuth();
  const google = useContinueWithGoogle(googleAuth.mutateAsync);

  const busy = login.isPending || google.busy;
  const demo = demoAccount();

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
    if (busy) return;
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

  // One line for the form's complaints, Google's and the server's.
  const message =
    problem ?? google.problem ?? (login.isError ? describeError(login.error) : null);

  return (
    // No title on the bar. The headline below is the title, and saying it twice
    // is what put two competing sizes on a screen with one job.
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
          <Text style={[type.display, { color: colors.text }]}>Sign in.</Text>
          <Text style={[type.body, { color: colors.muted }]}>
            Pick up where your last meal left off.
          </Text>
          {/* Only in a demo build, see lib/demoHint.ts. Inside the headline's
              own block and in its muted body text, so a build without it lays
              out exactly as it always did rather than around an empty box. */}
          {demo ? (
            <Text style={[type.body, { color: colors.muted }]}>
              Demo account: {demo.email} / {demo.password}
            </Text>
          ) : null}
        </View>

        <View style={{ gap: spacing.lg }}>
          <Field
            label="Email"
            value={email}
            onChangeText={(next) => {
              setProblem(null);
              google.clearProblem();
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
              google.clearProblem();
              setPassword(next);
            }}
            placeholder="Your password"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            reveal
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
          />

          {message ? <FormError>{message}</FormError> : null}

          <Button
            label="Sign in"
            size="lg"
            full
            onPress={submit}
            loading={login.isPending}
            disabled={google.busy}
          />

          <TextLink
            prompt="Need access?"
            label="Forgot password?"
            onPress={() => router.push('/forgot-password')}
            disabled={busy}
            accessibilityHint="Request a password reset link"
          />

          {/* Hidden, not disabled, in a build with no Google client id. The
              sign up screen carries the reasoning. */}
          {google.ready ? (
            <>
              <OrRule />
              <GoogleButton
                onPress={() => void google.start()}
                loading={login.isPending}
                disabled={login.isPending}
              />
            </>
          ) : null}
        </View>

        {/* One sentence, centred under the primary button, with "Sign up"
            tinted. Section 7 asks for boldness in one place per screen, and on
            a screen called "Sign in." that place is the sign in button.

            The label is the word people actually look for: "Create an account"
            was the old one, and it is not the phrase anyone scans a screen
            hunting for. */}
        <TextLink
          prompt="New to Forkast?"
          label="Sign up"
          onPress={() => router.replace('/register')}
          disabled={busy}
          accessibilityHint="Create a new Forkast account"
        />
      </View>
    </Screen>
  );
}
