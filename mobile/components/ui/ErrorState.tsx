import { Text, View } from 'react-native';

import { useTheme } from '../../theme';
import { Button } from './Button';

type ErrorStateProps = {
  title?: string;
  message?: string;
  onRetry?: () => void;
};

export function ErrorState({
  title = 'Could not load',
  message = 'We could not reach Forkast just now. Check your connection and try again.',
  onRetry,
}: ErrorStateProps) {
  const { colors, radius, spacing, type } = useTheme();

  return (
    <View
      style={{
        gap: spacing.sm,
        padding: spacing.xl,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        alignItems: 'flex-start',
      }}
    >
      <Text style={[type.labelSoft, { color: colors.danger }]}>Offline</Text>
      <Text style={[type.subtitle, { color: colors.text }]}>{title}</Text>
      <Text style={[type.caption, { color: colors.muted }]}>{message}</Text>
      {onRetry ? (
        <Button label="Try again" variant="secondary" onPress={onRetry} style={{ marginTop: spacing.md }} />
      ) : null}
    </View>
  );
}
