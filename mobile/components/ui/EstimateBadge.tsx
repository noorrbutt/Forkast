import { Text, View } from 'react-native';

import { useTheme } from '../../theme';

export function EstimateBadge() {
  const { colors, radius, spacing, type } = useTheme();

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel="Estimated locally"
      style={{
        alignSelf: 'flex-start',
        borderRadius: radius.pill,
        backgroundColor: colors.accentSoft,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
      }}
    >
      <Text style={[type.caption, { color: colors.accent }]}>Estimated</Text>
    </View>
  );
}
