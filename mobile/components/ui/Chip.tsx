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
          borderColor: selected ? colors.accent : colors.border,
          backgroundColor: selected ? colors.accentSoft : colors.surfaceAlt,
          paddingVertical: compact ? spacing.sm : spacing.md - 2,
          paddingHorizontal: compact ? spacing.md : spacing.lg,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
        animatedStyle,
        style,
      ]}
    >
      <Text
        style={[
          type.caption,
          {
            color: selected ? colors.accent : colors.muted,
            fontWeight: selected ? '600' : '500',
          },
        ]}
        numberOfLines={1}
      >
        {leading ? `${leading}  ${label}` : label}
      </Text>
    </AnimatedPressable>
  );
}
