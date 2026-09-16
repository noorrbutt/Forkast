import { Pressable, Text, View } from 'react-native';

import { useTheme } from '../theme';

type StarRatingProps = {
  value: number;
  onChange: (value: number) => void;
  max?: number;
};

export function StarRating({ value, onChange, max = 5 }: StarRatingProps) {
  const { colors, spacing, isDark, type } = useTheme();

  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }} accessibilityRole="radiogroup">
      {Array.from({ length: max }, (_, index) => index + 1).map((star) => {
        const filled = star <= value;
        return (
          <Pressable
            key={star}
            onPress={() => onChange(star)}
            hitSlop={6}
            accessibilityRole="radio"
            accessibilityState={{ selected: filled }}
            accessibilityLabel={`${star} of ${max}`}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Text
              style={[
                type.star,
                { color: filled ? colors.accent : isDark ? colors.border : colors.muted },
              ]}
            >
              {filled ? '★' : '☆'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
