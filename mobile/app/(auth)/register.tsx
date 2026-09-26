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
import { useGoogleAuth, useRegister } from '../../hooks/useAuth';
import { useContinueWithGoogle } from '../../hooks/useContinueWithGoogle';
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
 *
 * ---
 *
 * What the form asks for now, and why each one is here.
 *
 * A name, in two fields rather than one. Forkast showed everyone the front of
 * their own email address where their name should be, on the profile header and
 * inside their own initials, so an account belonging to a person called Sara
 * greeted her as "sara.k91". Two fields rather than one "full name" because the
 * initials want the two halves separately and splitting a typed string on
 * whitespace guesses wrong on most of the world's names.
 *
 * They sit on one row. Five stacked fields is a wall, and these two are short,
 * closely related and read as one answer, which is the case where a row is
 * clearer than a column rather than merely tighter.
 *
 * A confirmation for the password. The single most expensive typo available on
 * this screen is a mistyped password in a masked field on an account that does
 * not exist yet: there is nothing to compare it against later, no email to
 * recover through, and the first the user hears of it is being unable to sign
 * in. The eye and the confirmation are two answers to the same problem and both
 * are worth having, because the eye is refused by anyone standing in a queue.
 *
 * Google, under an "or". Not above the form and not styled to outweigh it: this
 * screen is called "Sign up." and the saffron button is what it is for, with
 * Google offered plainly beside it rather than pushed. GoogleButton carries the
 * rest of that reasoning. It is hidden outright, rather than disabled, in a
 * build with no Google client id, because a control that cannot work is worse
 * than no control.
 */

const MIN_PASSWORD = 8;

export default function RegisterScreen() {
  const { colors, layout, spacing, type } = useTheme();
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const register = useRegister();
  const googleAuth = useGoogleAuth();
  const google = useContinueWithGoogle(googleAuth.mutateAsync);

  const busy = register.isPending || google.busy;

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  // Only once there is something to disagree with. Saying "these do not match"
  // against a field the user is one character into is the app correcting
  // somebody mid-word.
  const mismatched = confirm.length > 0 && confirm !== password;

  /** Clears the last complaint as soon as anything is typed at it. */
  const edit = (set: (next: string) => void) => (next: string) => {
    setProblem(null);
    google.clearProblem();
    set(next);
  };

  // Live, like the sign in button, and for the same reason: an affordance that
  // only appears once you have done the thing it invites is not an affordance.
  const submit = () => {
    if (busy) return;
    if (!firstName.trim()) {
      setProblem('Enter your first name.');
      return;
    }
    if (!lastName.trim()) {
      setProblem('Enter your last name.');
      return;
    }
    if (!email.trim()) {
      setProblem('Enter an email so you can get back in.');
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setProblem(`Pick a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (confirm !== password) {
      setProblem('Those two passwords are different. Check them and try again.');
      return;
    }
    setProblem(null);
    register.mutate(
      {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        password,
      },
      {
        onSuccess: () =>
          router.replace({ pathname: '/check-email', params: { email: email.trim() } }),
      },
    );
  };

  // One line for the form's complaints, Google's and the server's. Three
  // separate places to look would be three places to miss.
  const message =
    problem ?? google.problem ?? (register.isError ? describeError(register.error) : null);

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
          {/* One row, two fields, each taking half of whatever width there is.
              `flex: 1` on the wrappers rather than a fixed width, so the pair
              survives a narrow phone and a wide browser without a breakpoint. */}
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Field
                label="First name"
                value={firstName}
                onChangeText={edit(setFirstName)}
                placeholder="Sara"
                autoCapitalize="words"
                autoCorrect={false}
                textContentType="givenName"
                returnKeyType="next"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Last name"
                value={lastName}
                onChangeText={edit(setLastName)}
                placeholder="Khan"
                autoCapitalize="words"
                autoCorrect={false}
                textContentType="familyName"
                returnKeyType="next"
              />
            </View>
          </View>

          <Field
            label="Email"
            value={email}
            onChangeText={edit(setEmail)}
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
            onChangeText={edit(setPassword)}
            placeholder={`At least ${MIN_PASSWORD} characters`}
            hint={tooShort ? `A little longer, ${MIN_PASSWORD} characters minimum.` : undefined}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            reveal
            textContentType="newPassword"
            returnKeyType="next"
          />
          <Field
            label="Confirm password"
            value={confirm}
            onChangeText={edit(setConfirm)}
            placeholder="Type it once more"
            hint={mismatched ? 'This does not match the password above yet.' : undefined}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            reveal
            // newPassword on both, so a password manager offers to save the one
            // it generated rather than treating the second field as a login.
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={submit}
          />

          {message ? <FormError>{message}</FormError> : null}

          <Button
            label="Sign up"
            size="lg"
            full
            onPress={submit}
            loading={register.isPending}
            disabled={google.busy}
          />

          {/* Hidden rather than disabled when this build has no Google client
              id. A disabled control still says the feature exists and that the
              user has done something wrong to deserve it greyed out; absence
              says the honest thing, which is that this build cannot offer it. */}
          {google.ready ? (
            <>
              <OrRule />
              <GoogleButton
                onPress={() => void google.start()}
                loading={google.busy}
                disabled={register.isPending}
              />
            </>
          ) : null}
        </View>

        {/* The same component and the same placement as its twin on the sign
            in screen, with the words swapped. */}
        <TextLink
          prompt="Already have an account?"
          label="Sign in"
          onPress={() => router.replace('/login')}
          disabled={busy}
          accessibilityHint="Sign in to an account you already have"
        />
      </View>
    </Screen>
  );
}
