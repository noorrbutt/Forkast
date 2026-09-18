import { useEffect } from 'react';
import { AccessibilityInfo, Text, type StyleProp, type TextStyle } from 'react-native';

import { useTheme } from '../../theme';

type FormErrorProps = {
  /** Null or empty renders nothing, so callers can pass a value straight in. */
  children: string | null | undefined;
  style?: StyleProp<TextStyle>;
};

/**
 * The line that tells someone why the thing they just did did not work.
 *
 * Written out by hand in about twenty places as a danger-coloured caption, and
 * in every one of them it was invisible to a screen reader. Nothing moves focus
 * to a message that simply appears below a button, so the reader was left with
 * a form that had apparently done nothing: no error, no success, no reason. The
 * most common case is the worst one, because "Incorrect email or password" is
 * on the screen a new user meets first.
 *
 * Announcing is not the same as being readable. accessibilityLiveRegion covers
 * Android when this is already mounted and the text changes, and the explicit
 * announcement covers iOS and the case where it mounts for the first time. Both
 * are needed; either alone leaves one of the two platforms silent.
 *
 * The colour and size live here too, which is the other half of why this
 * exists: twenty copies of the same style is twenty chances for one of them to
 * drift into a shade that fails contrast.
 */
export function FormError({ children, style }: FormErrorProps) {
  const { colors, type } = useTheme();
  const message = children?.trim() ? children : null;

  useEffect(() => {
    if (message) AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  if (!message) return null;

  return (
    <Text
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[type.caption, { color: colors.danger }, style]}
    >
      {message}
    </Text>
  );
}
