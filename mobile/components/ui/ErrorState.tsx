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
  // Every caller passes describeError, which says what actually went wrong.
  // This is only the fallback, so it does not guess at a cause either.
  message = 'Something went wrong on the way to the server. Try again.',
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
      {/* No "Offline" line above this any more. It was printed over every
          failure this component has ever shown, including a 422 and a 500, so
          the one word the reader saw first was usually the wrong diagnosis.
          What happened is in the title and the message, and describeError names
          the address when the server genuinely could not be reached. */}
      <Text style={[type.subtitle, { color: colors.text }]}>{title}</Text>
      <Text style={[type.caption, { color: colors.muted }]}>{message}</Text>
      {onRetry ? (
        <Button label="Try again" variant="secondary" onPress={onRetry} style={{ marginTop: spacing.md }} />
      ) : null}
    </View>
  );
}
