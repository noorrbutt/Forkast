import { Pressable, Text, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { useTheme } from '../../theme';
import { usePressScale } from './usePressScale';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** Rendered before the label, typically a cuisine emoji. */
  leading?: string;
  disabled?: boolean;
  /** Smaller padding, for dense rows such as a star or serving size row. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * The single selection control in Forkast. There are no dropdowns and no
 * pickers anywhere in the app, every choice is a row of pills.
 */
export function Chip({
  label,
  selected = false,
  onPress,
  leading,
  disabled = false,
  compact = false,
  style,
}: ChipProps) {
  const { colors, radius, spacing, type } = useTheme();
  // Chips are the one control in the app, so this tick is most of what makes
  // choosing a category feel physical rather than like filling in a form.
  const { animatedStyle, onPressIn, onPressOut } = usePressScale({ disabled });

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={({ pressed }: { pressed: boolean }) => [
        {
          borderRadius: radius.pill,
          borderWidth: 1,
          // Selected is a solid tablet, not a tint. The old treatment put
          // saffron text on a 14 percent saffron wash, which measured 1.67:1 in
          // light theme: the chosen option was the hardest one in the row to
          // read, and selection was carried entirely by a colour change that
          // several people cannot see at all.
          borderColor: selected ? colors.accentFill : colors.border,
          backgroundColor: selected ? colors.accentFill : colors.surfaceAlt,
          paddingVertical: compact ? spacing.sm : spacing.md - 2,
          paddingHorizontal: compact ? spacing.md : spacing.lg,
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
        },
        animatedStyle,
        style,
      ]}
    >
      <Text
        style={[
          type.caption,
          {
            color: selected ? colors.accentInk : colors.muted,
            fontWeight: selected ? '600' : '500',
          },
        ]}
        numberOfLines={1}
      >
        {/* One space, not two. "All" has no emoji and the double gap made the
            shortest label in the row look the most padded. */}
        {leading ? `${leading} ${label}` : label}
      </Text>
    </AnimatedPressable>
  );
}
