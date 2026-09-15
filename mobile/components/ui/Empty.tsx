import { Text, View } from 'react-native';

import { useTheme } from '../../theme';
import { Button } from './Button';

type EmptyProps = {
  title: string;
  message?: string;
  emoji?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function Empty({ title, message, emoji = '🍽️', actionLabel, onAction }: EmptyProps) {
  const { colors, radius, spacing, type } = useTheme();

  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.xxl,
        paddingHorizontal: spacing.xl,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderStyle: 'dashed',
        backgroundColor: colors.surface,
      }}
    >
      <Text style={{ fontSize: 30 }}>{emoji}</Text>
      <Text style={[type.subtitle, { color: colors.text, textAlign: 'center' }]}>{title}</Text>
      {message ? (
        <Text style={[type.caption, { color: colors.muted, textAlign: 'center' }]}>{message}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} variant="secondary" onPress={onAction} style={{ marginTop: spacing.md }} />
      ) : null}
    </View>
  );
}
