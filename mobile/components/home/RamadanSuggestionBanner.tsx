import { Pressable, Text, View } from 'react-native';

import { Icon } from '../ui';
import { useTheme } from '../../theme';

/**
 * The one-time nudge toward Ramadan mode, shown only inside its suggested
 * date range and only until dismissed or turned on (see useRamadan's
 * `suggestVisible`). Neutral wording throughout: the app has no way to know
 * whether the person reading this fasts, so it offers rather than assumes.
 */
export function RamadanSuggestionBanner({
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
        backgroundColor: colors.accentSoft,
        borderRadius: 12,
        padding: spacing.md,
        marginBottom: spacing.md,
      }}
    >
      <Pressable
        onPress={onOpenProfile}
        style={{ flex: 1 }}
        accessibilityRole="button"
        accessibilityLabel="Turn on Ramadan mode"
      >
        <Text style={[type.caption, { color: colors.text }]}>
          It&apos;s around Ramadan. Turn on Ramadan mode for sehri and iftar times instead of the usual meal slots.
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
