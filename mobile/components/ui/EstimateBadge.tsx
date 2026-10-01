import { Text, View } from 'react-native';

import { useTheme } from '../../theme';
import type { EstimateSource } from '../../lib/types';
import { Icon } from './Icon';

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

export function EstimateBadge({ variant = 'default' }: { variant?: 'default' | 'overlay' } = {}) {
  const { colors, radius, spacing, type } = useTheme();

  if (variant === 'overlay') {
    return (
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel="Estimated locally"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          alignSelf: 'flex-start',
          borderRadius: radius.pill,
          // A fixed value, not a theme token, same reasoning as the dish name
          // and calorie figure drawn over this same photo elsewhere in this
          // file: this sits on a photograph, not on either of the app's own
          // two backgrounds, so it has to carry enough of its own contrast to
          // read regardless of what is under it rather than trust a token
          // tuned for the page. 0.6 opacity black clears 4.5:1 for white text
          // even composited over a plain white worst case.
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
        }}
      >
        <Icon name="info" size={12} color="#FFFFFF" />
        <Text style={[type.caption, { color: '#FFFFFF' }]}>Estimated</Text>
      </View>
    );
  }

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
