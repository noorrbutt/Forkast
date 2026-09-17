import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { useTheme } from '../../theme';
import { Icon, type IconName } from './Icon';
import { usePressScale } from './usePressScale';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'md' | 'lg';
/** Where the button sits when it is not stretched across its container. */
type ButtonAlign = 'start' | 'center' | 'stretch';

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** Stretch to the container width. Shorthand for align="stretch". */
  full?: boolean;
  align?: ButtonAlign;
  /** Rendered before the label, from the shared icon vocabulary. */
  icon?: IconName;
  /**
   * Tighter horizontal padding, for a row that has to hold three buttons.
   *
   * 16 rather than 24 a side, which is the value Chip already uses for the same
   * idea. Horizontal only: the vertical padding is what keeps a button over the
   * 48pt minimum target, and Button has no minHeight to catch it if that were
   * reduced.
   *
   * Intended for `size="md"`. Combining it with `size="lg"` is untested and
   * there is no caller for it.
   */
  compact?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  full = false,
  align,
  icon,
  compact = false,
  accessibilityHint,
  style,
}: ButtonProps) {
  const { colors, radius, spacing, type } = useTheme();
  const inactive = disabled || loading;
  // Reanimated has to inspect the style object in order to animate it, so an
  // animated component silently drops the ({ pressed }) => style callback form
  // that plain Pressable supports. On web that meant Button and Chip rendered
  // with no fill, no border and no padding at all: bare text on the page, which
  // is exactly what the welcome screen looked like. The pressed flag is tracked
  // here instead so the style stays a plain array.
  const [pressed, setPressed] = useState(false);
  // No tick on a primary action: the meaningful haptic is the success one that
  // fires when the work completes, and two in a row reads as a stutter.
  const { animatedStyle, onPressIn, onPressOut, reset } = usePressScale({
    haptic: variant !== 'primary',
    disabled: inactive,
  });

  // A button that becomes disabled while the finger is still down never gets an
  // onPressOut, because the Pressable stops being the responder. Without this
  // it stays visibly squashed for the whole request: press "Sign in", the
  // mutation starts, loading flips true, and the control sits at 0.965 until
  // the network answers.
  useEffect(() => {
    if (inactive) reset();
  }, [inactive, reset]);

  // Disabled is a different fill, never a faded copy of the enabled one.
  // Fading the whole subtree to 50% took the label down with it, which is how
  // a primary action ended up invisible until the user had already done the
  // thing the button was there to invite.
  const fills: Record<ButtonVariant, string> = {
    primary: colors.accentFill,
    secondary: 'transparent',
    ghost: 'transparent',
    danger: colors.dangerSoft,
  };
  const inks: Record<ButtonVariant, string> = {
    primary: colors.accentInk,
    secondary: colors.text,
    ghost: colors.accent,
    danger: colors.danger,
  };
  // Every variant that is not a solid fill gets a visible edge, because a
  // control with neither is text. Ghost had transparent fill AND transparent
  // border, which measures 1.00:1 of shape contrast, so the Remove button on a
  // photo and the Clear button on the burn card read as floating words next to
  // the outlined buttons beside them. Quiet means a lighter fill, never no
  // shape. Primary and danger still skip it: drawing a border in the same
  // colour as the fill costs a pixel of layout and buys nothing.
  const borders: Record<ButtonVariant, string | null> = {
    primary: null,
    secondary: colors.outline,
    ghost: colors.outline,
    danger: colors.danger,
  };

  const fill = inactive ? colors.disabledFill : fills[variant];
  const ink = inactive ? colors.disabledInk : inks[variant];
  const borderColor = inactive ? colors.disabledFill : borders[variant];
  const showBorder = borderColor !== null;

  const verticalPad = size === 'lg' ? spacing.lg + 2 : spacing.md + 1;
  // Horizontal only. See the `compact` docblock: touching verticalPad here
  // would quietly take the control under the minimum tap target.
  const horizontalPad = compact ? spacing.lg : spacing.xl;
  const alignSelf = align ?? (full ? 'stretch' : 'start');

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => {
        setPressed(true);
        onPressIn();
      }}
      onPressOut={() => {
        setPressed(false);
        onPressOut();
      }}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={[
        {
          borderRadius: radius.pill,
          backgroundColor: fill,
          // Ghost keeps a transparent border so its height matches the others
          // in a row. Without it a ghost button sits two pixels shorter.
          borderWidth: 1.5,
          borderColor: showBorder ? borderColor : 'transparent',
          paddingVertical: verticalPad,
          paddingHorizontal: horizontalPad,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          alignSelf: alignSelf === 'start' ? 'flex-start' : alignSelf,
          // Back to the pre-motion value. The press scale was supposed to pay
          // for a softer dim and on a small control it does not, so a tap had
          // stopped reading as a tap.
          opacity: pressed ? 0.82 : 1,
        },
        animatedStyle,
        style,
      ]}
    >
      {loading ? (
        <View style={{ height: size === 'lg' ? 22 : 20, justifyContent: 'center' }}>
          <ActivityIndicator color={ink} />
        </View>
      ) : (
        <>
          {icon ? <Icon name={icon} size={size === 'lg' ? 19 : 17} color={ink} /> : null}
          <Text style={[size === 'lg' ? type.subtitle : type.body, { color: ink, fontWeight: '600' }]}>
            {label}
          </Text>
        </>
      )}
    </AnimatedPressable>
  );
}
