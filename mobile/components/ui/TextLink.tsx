import { useState } from 'react';
import { Pressable, Text, type StyleProp, type ViewStyle } from 'react-native';

import { fonts, useTheme } from '../../theme';

type TextLinkProps = {
  /** The sentence that sets the link up, e.g. "Already have an account?" */
  prompt: string;
  /** The words that do the work, e.g. "Sign in". */
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * "Already have an account? Sign in", as one sentence with the last two words
 * coloured.
 *
 * Why this is not a Button. The escape hatch on the three auth screens was a
 * full width outlined button under a caption, which put two controls of the
 * same size on a screen with one job and read as a choice between two equal
 * things. The convention every sign in screen already uses is a line of prose
 * with the action tinted at the end of it, and a convention people have met a
 * thousand times needs less shape to be legible than a novel arrangement does.
 *
 * On the objection this answers. The welcome screen's note used to argue that
 * an inline link "reads as a sentence", citing a version of this app that
 * shipped with bare text where buttons should have been. That was a rendering
 * bug, not a design: Button passed Reanimated a style callback it silently
 * dropped, so the fill, the border and the padding all vanished. Unstyled text
 * that was meant to be a button is a different thing from text deliberately
 * tinted, weighted and set on its own line. The affordance here is saffron plus
 * semibold plus position, which is three signals, not none.
 *
 * What keeps it pressable rather than merely visible:
 *
 * - The whole line is the target, not just the tinted words, because two words
 *   at 15pt are about 50pt wide and nobody aims at prose precisely.
 * - `minHeight: 48` with the text centred in it, which is section 3's floor.
 *   The line itself is 22pt, so without this the target would be less than half
 *   the minimum on every screen that uses it.
 * - An underline on press. Opacity alone is what a whole button gets, and on a
 *   short run of text inside a longer muted line it is too small a change to
 *   register as "that responded".
 *
 * `fontFamily` and `fontWeight` are both set on the tinted run. Per the note on
 * FAMILY in tokens, React Native picks among registered cuts rather than
 * synthesising them, so weight without the family is a silent no-op on device,
 * and family without the weight is one on web.
 *
 * `textDecorationColor` is iOS only, and that is deliberate rather than
 * overlooked. It is set to the same value the run is already drawn in, so the
 * platforms that drop it underline in that colour anyway and the three agree.
 * Naming it keeps the next person from reading its absence on Android as a bug.
 */
export function TextLink({
  prompt,
  label,
  onPress,
  disabled = false,
  accessibilityHint,
  style,
}: TextLinkProps) {
  const { colors, spacing, type } = useTheme();
  const [pressed, setPressed] = useState(false);

  // Disabled is its own ink, never a faded copy, for the reason Button gives at
  // length: fading the subtree takes the one coloured word down with it and
  // leaves a sentence that no longer looks like it ever did anything.
  const ink = disabled ? colors.disabledInk : colors.accent;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      // Navigational, so it takes no haptic. The tick is for controls that
      // change something in place; a route change announces itself.
      accessibilityRole="link"
      // The name is the action, not the whole line. A screen reader saying
      // "Already have an account? Sign in, link" buries the verb in the middle.
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      style={[
        {
          minHeight: 48,
          justifyContent: 'center',
          paddingHorizontal: spacing.md,
          alignSelf: 'center',
          opacity: pressed ? 0.82 : 1,
        },
        style,
      ]}
    >
      <Text style={[type.body, { color: colors.muted, textAlign: 'center' }]}>
        {prompt}{' '}
        <Text
          style={{
            fontFamily: fonts.semibold,
            fontWeight: '600',
            color: ink,
            textDecorationLine: pressed ? 'underline' : 'none',
            textDecorationColor: ink,
          }}
        >
          {label}
        </Text>
      </Text>
    </Pressable>
  );
}
