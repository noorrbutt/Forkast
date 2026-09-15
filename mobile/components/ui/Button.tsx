import { ActivityIndicator, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../../theme';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'md' | 'lg';

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  full?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  full = false,
  style,
}: ButtonProps) {
  const { colors, radius, spacing, type } = useTheme();
  const inactive = disabled || loading;

  const fills: Record<ButtonVariant, string> = {
    primary: colors.accent,
    secondary: colors.surfaceAlt,
    ghost: 'transparent',
    danger: colors.dangerSoft,
  };
  const inks: Record<ButtonVariant, string> = {
    primary: colors.accentInk,
    secondary: colors.text,
    ghost: colors.muted,
    danger: colors.danger,
  };
  const borders: Record<ButtonVariant, string> = {
    primary: colors.accent,
    secondary: colors.border,
    ghost: colors.border,
    danger: colors.dangerSoft,
  };

  const verticalPad = size === 'lg' ? spacing.lg + 2 : spacing.md + 1;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        {
          borderRadius: radius.pill,
          backgroundColor: fills[variant],
          borderWidth: 1,
          borderColor: borders[variant],
          paddingVertical: verticalPad,
          paddingHorizontal: spacing.xl,
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: full ? 'stretch' : 'flex-start',
          opacity: inactive ? 0.5 : pressed ? 0.82 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <View style={{ height: size === 'lg' ? 22 : 20, justifyContent: 'center' }}>
          <ActivityIndicator color={inks[variant]} />
        </View>
      ) : (
        <Text
          style={[
            size === 'lg' ? type.subtitle : type.body,
            { color: inks[variant], fontWeight: '600' },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
