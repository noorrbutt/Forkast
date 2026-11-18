import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
        accessibilityLabel={t('home.turnOnRamadan')}
      >
        <Text style={[type.caption, { color: colors.text }]}>
          {t('home.ramadanSuggestion')}
        </Text>
      </Pressable>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={t('home.dismiss')}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Icon name="close" size={18} color={colors.muted} />
      </Pressable>
    </View>
  );
}
