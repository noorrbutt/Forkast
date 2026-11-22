import { AccessibilityInfo, Text, View } from 'react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme';
import { Button } from './Button';

type ErrorStateProps = {
  title?: string;
  message?: string;
  onRetry?: () => void;
};

export function ErrorState({
  title,
  message,
  onRetry,
}: ErrorStateProps) {
  const { t } = useTranslation();
  const { colors, radius, spacing, type } = useTheme();
  const visibleTitle = title ?? t('common.couldNotLoad');
  // Every caller passes describeError, which says what actually went wrong.
  // This is only the fallback, so it does not guess at a cause either.
  const visibleMessage = message ?? t('common.requestFailed');

  // Say it out loud, once, when it appears.
  //
  // A failure that only exists as text somewhere on the screen is a failure a
  // screen reader user does not know about: focus does not move here, so
  // nothing reads it until they happen to swipe onto it, and by then they have
  // been waiting on a request that already failed. announceForAccessibility is
  // what interrupts with it on both platforms. accessibilityLiveRegion below
  // covers the Android case where this re-renders with a different message
  // while it is already on screen.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`${visibleTitle}. ${visibleMessage}`);
  }, [visibleTitle, visibleMessage]);

  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={`${visibleTitle}. ${visibleMessage}`}
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
          What happened is in the title and the message. */}
      <Text style={[type.subtitle, { color: colors.text }]}>{visibleTitle}</Text>
      <Text style={[type.caption, { color: colors.muted }]}>{visibleMessage}</Text>
      {onRetry ? (
        <Button label={t('common.tryAgain')} variant="secondary" onPress={onRetry} style={{ marginTop: spacing.md }} />
      ) : null}
    </View>
  );
}
