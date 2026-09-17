import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../../theme';

type StatTileProps = {
  label: string;
  value: string;
  hint?: string;
  /** Tints the numeral, for example success on a good junk ratio. */
  tone?: 'default' | 'accent' | 'success' | 'danger';
  style?: StyleProp<ViewStyle>;
};

export function StatTile({ label, value, hint, tone = 'default', style }: StatTileProps) {
  const { colors, radius, spacing, type } = useTheme();

  const tones = {
    default: colors.text,
    accent: colors.accent,
    success: colors.success,
    danger: colors.danger,
  } as const;

  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: colors.surface,
          borderRadius: radius.tile,
          borderWidth: 1,
          borderColor: colors.border,
          paddingVertical: spacing.lg,
          paddingHorizontal: spacing.lg,
          gap: spacing.xs,
        },
        style,
      ]}
    >
      <Text style={[type.labelSoft, { color: colors.muted }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[type.numeral, { color: tones[tone] }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {hint ? (
        <Text style={[type.caption, { color: colors.muted }]} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
