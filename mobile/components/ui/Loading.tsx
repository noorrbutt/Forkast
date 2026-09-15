import { ActivityIndicator, Text, View } from 'react-native';

import { useTheme } from '../../theme';

type LoadingProps = {
  label?: string;
  /** Fills the available space and centres, rather than sitting inline. */
  fill?: boolean;
};

export function Loading({ label = 'Loading', fill = true }: LoadingProps) {
  const { colors, spacing, type } = useTheme();

  return (
    <View
      style={{
        flex: fill ? 1 : undefined,
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.md,
        paddingVertical: spacing.xxl,
      }}
    >
      <ActivityIndicator color={colors.accent} />
      <Text style={[type.label, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}
