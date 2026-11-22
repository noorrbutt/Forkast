import { ActivityIndicator, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme';

type LoadingProps = {
  label?: string;
};

/**
 * The state a screen is in while it waits.
 *
 * It used to take a `fill` prop that claimed to centre it in the available
 * space, and it never did anything anywhere. The prop set flex: 1, and at every
 * one of its eleven call sites the parent is either Screen's scroll content
 * container, which has no flexGrow, or a screen owned column with none either,
 * so the flex resolved against nothing. Four call sites were passing false to
 * turn off behaviour that was already off. Removed rather than made to work: a
 * spinner that sits where it is put is what every one of those callers wanted.
 */
export function Loading({ label }: LoadingProps) {
  const { t } = useTranslation();
  const { colors, spacing, type } = useTheme();
  const visibleLabel = label ?? t('common.loading');

  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.md,
        paddingVertical: spacing.xxl,
      }}
    >
      <ActivityIndicator color={colors.accent} />
      <Text style={[type.labelSoft, { color: colors.muted }]}>{visibleLabel}</Text>
    </View>
  );
}
