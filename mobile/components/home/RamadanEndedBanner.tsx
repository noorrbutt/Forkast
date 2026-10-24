import { Pressable, Text, View } from 'react-native';

import { Icon } from '../ui';
import { useTheme } from '../../theme';

/**
 * Offered once the suggested Ramadan date range has passed while the mode is
 * still on (see useRamadan's `endedBannerVisible`). Turning the mode off is
 * never automatic -- see RamadanSuggestionBanner's own note on why turning
 * it on isn't either -- so this only offers the switch to Profile; it never
 * flips it.
 */
export function RamadanEndedBanner({
  onDismiss,
  onOpenProfile,
}: {
  onDismiss: () => void;
  onOpenProfile: () => void;
}) {
  const { colors, spacing, type } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        backgroundColor: colors.surfaceAlt,
        borderRadius: 12,
        padding: spacing.md,
        marginBottom: spacing.md,
      }}
    >
      <Pressable
        onPress={onOpenProfile}
        style={{ flex: 1 }}
        accessibilityRole="button"
        accessibilityLabel="Turn off Ramadan mode"
      >
        <Text style={[type.caption, { color: colors.text }]}>
          Ramadan has ended. Turn Ramadan mode off in Profile to go back to the usual meal slots.
        </Text>
      </Pressable>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Icon name="close" size={18} color={colors.muted} />
      </Pressable>
    </View>
  );
}
