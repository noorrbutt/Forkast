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
    // No gap: each star now carries its own 44pt box, and the glyph sits
    // centred in it, so the space between them is the padding rather than a
    // gap between two targets that are only as big as the character.
    <View style={{ flexDirection: 'row' }} accessibilityRole="radiogroup">
      {Array.from({ length: max }, (_, index) => index + 1).map((star) => {
        const filled = star <= value;
        return (
          <Pressable
            key={star}
            onPress={() => onChange(star)}
            accessibilityRole="radio"
            accessibilityState={{ selected: filled }}
            accessibilityLabel={`${star} of ${max}`}
            /**
             * A real 44pt box rather than hitSlop.
             *
             * hitSlop is not implemented in react-native-web at all, so in a
             * browser every one of these shrank to the size of the glyph. The
             * box works on all three platforms and needs no fallback.
             */
            style={({ pressed }) => ({
              opacity: pressed ? 0.6 : 1,
              minWidth: 44,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
            })}
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
