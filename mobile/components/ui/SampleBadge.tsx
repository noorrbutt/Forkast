import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../../theme';

/**
 * Marks a panel whose numbers came back with a `_source` field, which the
 * backend sets while it is still serving the seeded snapshot rather than
 * analytics computed from real logs.
 */
export function SampleBadge({ source, style }: { source?: string | null; style?: StyleProp<ViewStyle> }) {
  const { colors, radius, spacing, type } = useTheme();

  if (!source) return null;

  return (
    <View
      style={[
        {
          alignSelf: 'flex-start',
          borderRadius: radius.pill,
          backgroundColor: colors.accentSoft,
          borderWidth: 1,
          borderColor: colors.accentSoft,
          paddingVertical: 4,
          paddingHorizontal: spacing.md,
        },
        style,
      ]}
    >
      <Text style={[type.labelSoft, { color: colors.accent }]}>Sample data</Text>
    </View>
  );
}
