import { useState } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '../../theme';
import { Icon } from './Icon';

type FieldProps = TextInputProps & {
  label: string;
  hint?: string;
  /**
   * Draw the eye that shows and hides what has been typed.
   *
   * Only meaningful alongside `secureTextEntry`, and it takes over that prop:
   * pass both, and the field starts hidden with a control to reveal it.
   *
   * Opt in rather than automatic on every secure field. The two places a
   * password is confirmed rather than chosen -- deleting an account, and
   * proving the current one before changing it -- are asking the user to
   * reproduce something they already know, so there is nothing to check their
   * typing against and a reveal there only offers a shoulder surfer a look.
   */
  reveal?: boolean;
};

/**
 * The reveal control, on the fields where it earns its place.
 *
 * Why it exists at all. A password field asks someone to type a string they
 * cannot see, on a phone keyboard, and then blames them when it is wrong. On
 * the sign up screen that is two such strings which have to match. The eye is
 * the convention for this and has been for years, so it costs no learning.
 *
 * Why it is inside the field rather than beside it. A control that acts on one
 * field has to be attached to that field, or on a screen with three password
 * rows nobody can tell which eye belongs to which. Absolutely positioned over
 * the input rather than laid out in a row with it, because the border, the
 * focus ring and the padding all live on the TextInput and wrapping it in a row
 * would put the edge around the wrong box.
 *
 * What keeps it usable: a 44 wide target the full height of the input, which
 * clears the 48pt floor on a field that is taller than that anyway, and the
 * input's right padding is opened up by exactly the width of it so a long
 * password runs under the cursor rather than under the eye.
 *
 * Its accessibility label is the ACTION, not the state. "Show password" is what
 * pressing it does; announcing "password hidden" would describe the field and
 * leave a screen reader user to work out that the button changes it.
 */
const REVEAL_WIDTH = 44;

export function Field({ label, hint, reveal = false, style, onFocus, onBlur, ...rest }: FieldProps) {
  const { colors, radius, spacing, type } = useTheme();
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);

  // The caller asked for a reveal, so this field is secure and this component
  // owns whether it is currently masked. Without the `secureTextEntry` guard a
  // caller could ask for an eye on an email field and get one that toggles
  // nothing.
  const revealable = reveal && rest.secureTextEntry === true;
  const masked = revealable ? !shown : rest.secureTextEntry;

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[type.labelSoft, { color: colors.muted }]}>{label}</Text>
      <View>
        <TextInput
          {...rest}
          secureTextEntry={masked}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          placeholderTextColor={colors.muted}
          selectionColor={colors.accent}
          style={[
            type.body,
            {
              color: colors.text,
              backgroundColor: colors.surfaceAlt,
              borderRadius: radius.input,
              // `outline`, not `border`. border is the decorative hairline
              // between surfaces and measures 1.52:1 against this fill, while the
              // guide asks 3:1 of anything proving it is a control. Chip, one
              // control away on the same screens, was already using outline at
              // 3.02:1, so a text field was the only control in the app failing a
              // rule its neighbour passed. 1.5 matches every other control edge.
              // Focus thickens the edge as well as colouring it, and the padding
              // gives back exactly what the extra width takes, so the box does not
              // move under the cursor. Colour on its own was the whole signal
              // before, which section 3 forbids: someone who cannot separate
              // saffron from grey had no way to tell which field they were in.
              borderWidth: focused ? 2.5 : 1.5,
              borderColor: focused ? colors.accent : colors.outline,
              paddingHorizontal: focused ? spacing.lg - 1 : spacing.lg,
              paddingVertical: focused ? spacing.md + 1 : spacing.md + 2,
              // Exactly the width the eye occupies, so the text stops where the
              // control starts instead of sliding underneath it.
              paddingRight: revealable ? REVEAL_WIDTH + spacing.sm : undefined,
            },
            style,
          ]}
        />
        {revealable ? (
          <Pressable
            onPress={() => setShown((was) => !was)}
            accessibilityRole="button"
            accessibilityLabel={shown ? 'Hide password' : 'Show password'}
            // Named so a screen reader says which field this belongs to when
            // there are two password rows on one screen.
            accessibilityHint={`${label} field`}
            style={({ pressed }) => ({
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: REVEAL_WIDTH,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.82 : 1,
            })}
          >
            {/* Muted rather than accent. Saffron in this app means "you can
                press this to get on with what you came for", and spending it on
                a control that only changes how the same characters are drawn
                would put it in competition with the button below. */}
            <Icon name={shown ? 'conceal' : 'reveal'} size={20} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {hint ? <Text style={[type.caption, { color: colors.muted }]}>{hint}</Text> : null}
    </View>
  );
}
