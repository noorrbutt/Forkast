import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useTheme } from '../../theme';
import { GoogleMark } from './GoogleMark';

type GoogleButtonProps = {
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};

/**
 * "Continue with Google", drawn to Google's rules rather than to Forkast's.
 *
 * Why this is its own component and not `<Button variant="secondary" />` with an
 * icon. Button takes its icon from the shared vocabulary and paints it in the
 * label's ink, which is exactly right for every icon in this app and exactly
 * wrong for this one: Google's guidelines require their mark in their colours,
 * and a saffron or ink G on a sign in button is both off brand and the thing a
 * phishing page does. Teaching Button about a coloured icon would put a
 * one-caller exception into the control every screen uses.
 *
 * Why "Continue" rather than "Sign up" or "Sign in". The phone cannot know
 * which it is doing. It holds a token from Google and has no idea whether there
 * is already a Forkast account behind that address, and the server decides.
 * Promising "Sign up" to someone who already has an account would be a lie, so
 * the same words appear on both auth screens and the backend has one route.
 *
 * On weight, and section 7's one-bold-thing rule. This is quieter than the
 * primary button above it: a surface fill and an outline against that button's
 * solid saffron. That ordering is deliberate on both screens. On sign up the
 * screen is called "Sign up." and the saffron button is the thing it is for;
 * Google is the shortcut, offered plainly, not pushed. It is still far louder
 * than the text link below it, because it is a control that does something
 * rather than a route somewhere else.
 *
 * The word between them is "or", on a rule, because without it the two buttons
 * read as a sequence of two steps rather than a choice of two ways in.
 */
export function GoogleButton({ onPress, disabled = false, loading = false }: GoogleButtonProps) {
  const { colors, fonts, radius, spacing, type } = useTheme();
  const [pressed, setPressed] = useState(false);
  const inactive = disabled || loading;

  // Disabled is its own fill, never a faded copy of the enabled one. Button
  // gives the full reasoning; the short version is that fading the subtree
  // takes the label down with it and leaves something nobody reads as a
  // control. The mark is the one thing that may not be recoloured, so it is
  // dropped entirely while inactive rather than dimmed into a grey smear.
  const fill = inactive ? colors.disabledFill : colors.surface;
  const ink = inactive ? colors.disabledInk : colors.text;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      accessibilityHint="Use your Google account to sign in or create a Forkast account"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={{
        borderRadius: radius.pill,
        backgroundColor: fill,
        // The same 1.5 every other outlined control in the app uses, against
        // `outline` rather than `border`, so it clears 3:1 and reads as a
        // control rather than as a box drawn around some words.
        borderWidth: 1.5,
        borderColor: inactive ? colors.disabledFill : colors.outline,
        // Matches Button at size="lg", because this sits directly under one and
        // two stacked buttons of different heights look like a mistake.
        paddingVertical: spacing.lg + 2,
        paddingHorizontal: spacing.xl,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.md,
        alignSelf: 'stretch',
        opacity: pressed ? 0.82 : 1,
      }}
    >
      {loading ? (
        <View style={{ height: 22, justifyContent: 'center' }}>
          <ActivityIndicator color={ink} />
        </View>
      ) : (
        <>
          {inactive ? null : <GoogleMark size={19} />}
          <Text style={[type.subtitle, { color: ink, fontFamily: fonts.semibold, fontWeight: '600' }]}>
            Continue with Google
          </Text>
        </>
      )}
    </Pressable>
  );
}
