import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { useTheme } from '../../theme';
import { Icon } from './Icon';
import { usePressScale } from './usePressScale';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** Rendered before the label, typically a cuisine emoji. */
  leading?: string;
  /** A colour dot before the label, used to carry a cuisine's colour through. */
  dotColor?: string;
  disabled?: boolean;
  /** Tighter padding for dense rows. Never below the minimum tap target. */
  compact?: boolean;
  /** Draws a tick on the selected chip, so selection is not carried by colour alone. */
  showCheck?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * A pill you can actually see.
 *
 * Three things were wrong and all three are fixed here.
 *
 * The edge was invisible. An unselected chip used `border`, which measured
 * 1.09:1 against the card beneath it, so a row of eight chips had no
 * boundaries at all and read as one grey slab with words on it. That is what
 * "horribly merged" meant. It now uses `outline`, the token that exists for
 * exactly this and that Button already used, held at 3:1 or better.
 *
 * The label changed width when picked. Selecting flipped fontWeight from 500 to
 * 600, which widens the text inside a fixed flex:1 box with numberOfLines={1},
 * so at larger font scales "Medium" truncated to "Medi..." the moment it was
 * chosen. The weight is now constant and selection is carried by the border,
 * the fill and a tick instead.
 *
 * It was too small to hit. 41pt and 37pt are both under the 44pt iOS and 48dp
 * Android minimums, so a control that looked heavy was still hard to tap.
 */
export function Chip({
  label,
  selected = false,
  onPress,
  leading,
  dotColor,
  disabled = false,
  compact = false,
  showCheck = false,
  style,
}: ChipProps) {
  const { colors, radius, spacing, type } = useTheme();
  const { animatedStyle, onPressIn, onPressOut } = usePressScale({ disabled });

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      // Whatever the padding works out to, the touchable area clears the
      // platform minimum.
      hitSlop={8}
      style={({ pressed }: { pressed: boolean }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          minHeight: 48,
          borderRadius: radius.pill,
          // Constant, so selecting never nudges the layout and never moves a
          // wrapping row's break point under the finger.
          borderWidth: 1.5,
          borderColor: selected ? colors.accent : colors.outline,
          backgroundColor: selected ? colors.accentSoft : colors.surfaceAlt,
          paddingVertical: compact ? spacing.sm : spacing.md - 2,
          paddingHorizontal: compact ? spacing.md : spacing.lg,
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
        },
        animatedStyle,
        style,
      ]}
    >
      {dotColor ? (
        <View
          style={{ width: 9, height: 9, borderRadius: radius.pill, backgroundColor: dotColor }}
        />
      ) : null}
      {leading ? <Text style={{ fontSize: 17 }}>{leading}</Text> : null}
      <Text
        style={[
          // Body rather than caption. 13px was small enough that the options on
          // this screen were genuinely hard to read.
          type.body,
          {
            color: selected ? colors.text : colors.muted,
            // Never changes between states, see the note above.
            fontWeight: '600',
          },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {selected && showCheck ? <Icon name="check" size={16} color={colors.accent} /> : null}
    </AnimatedPressable>
  );
}
