import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../../theme';

type CardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Uses surfaceAlt instead of surface, for a card nested inside another card. */
  alt?: boolean;
  padded?: boolean;
  onPress?: () => void;
};

export function Card({ children, style, alt = false, padded = true, onPress }: CardProps) {
  const { colors, radius, spacing } = useTheme();

  const base: StyleProp<ViewStyle> = [
    {
      backgroundColor: alt ? colors.surfaceAlt : colors.surface,
      borderRadius: radius.card,
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
