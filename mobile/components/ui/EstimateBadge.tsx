import { Text, View } from 'react-native';

import { useTheme } from '../../theme';
import type { EstimateSource } from '../../lib/types';

export function EstimateSourceLabel({ source }: { source?: EstimateSource }) {
  const { colors, type } = useTheme();
  if (!source) return null;

  const label = source === 'ai' ? 'Estimate: AI' : 'Estimate: local';
  return (
    <Text
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[type.caption, { color: colors.muted }]}
    >
      {label}
    </Text>
  );
}

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
