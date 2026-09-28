import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../../theme';
import { elevation } from '../../theme/tokens';

type CardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Uses surfaceAlt instead of surface, for a card nested inside another card. */
  alt?: boolean;
  padded?: boolean;
  onPress?: () => void;
  /**
   * False for a secondary container: a stat tile, a supporting card, anything
   * that backs up a screen's content rather than being it. Drops to the
   * smaller `radius.tile` and skips the shadow that lifts a primary surface
   * off the page.
   *
   * Every card defaulted to the same radius and the same elevation regardless
   * of what it held, which is what made a settings-adjacent stat block read
   * with the same weight as the screen's actual content. Importance has to
   * come from the chrome, not from every surface asking for the same amount
   * of attention. Default true so every call site that has not made this
   * decision keeps rendering exactly as it did before this prop existed.
   */
  prominent?: boolean;
};

export function Card({
  children,
  style,
  alt = false,
  padded = true,
  onPress,
  prominent = true,
}: CardProps) {
  const { colors, radius, spacing, isDark } = useTheme();

  const base: StyleProp<ViewStyle> = [
    // On light, a white card on a near white page tops out around 1.08:1, so
    // luminance alone cannot lift it and a shadow does the work instead. On
    // dark the grey ramp already separates them and a shadow would be invisible
    // anyway, so this is empty there. Never applied to a secondary card either
    // way: the shadow is what makes a primary surface read as lifted, and a
    // secondary one is not meant to.
    prominent && !isDark ? elevation.light : null,
    {
      backgroundColor: alt ? colors.surfaceAlt : colors.surface,
      borderRadius: prominent ? radius.card : radius.tile,
      borderWidth: 1,
      borderColor: colors.border,
      padding: padded ? spacing.xl : 0,
      overflow: 'hidden',
    },
    style,
  ];

  if (!onPress) {
    return <View style={base}>{children}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [base, pressed && { opacity: 0.75 }]}
      accessibilityRole="button"
    >
      {children}
    </Pressable>
  );
}
