import { useEffect } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../theme';
import { quick } from '../../theme/motion';
import { elevation } from '../../theme/tokens';

type UndoSnackbarProps = {
  /** Null hides it. Passing the message rather than a bare `visible` flag
   * means the fade-out plays on genuine dismissal, not on every re-render
   * that happens to carry the same text. */
  message: string | null;
  onUndo: () => void;
};

/**
 * The bar at the bottom of the diary, for the few seconds a swiped-away
 * meal is still one tap from coming back.
 *
 * Announced on appearance for the same reason Dialog and FormError already
 * are: nothing about a toast fading in at the bottom of the screen moves a
 * screen reader's focus there on its own, and by the time someone swiped
 * onto it by chance the undo window may already have closed.
 */
export function UndoSnackbar({ message, onUndo }: UndoSnackbarProps) {
  const { colors, layout, radius, spacing, type, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const opacity = useSharedValue(0);
  // Clears the floating tab bar, which sits at insets.bottom + tabBarInset
  // and stands layout.tabBarHeight tall. A flat spacing.xxl landed underneath
  // it on most phones, so the toast and its Undo button were invisible.
  const bottomOffset = insets.bottom + layout.tabBarInset + layout.tabBarHeight + spacing.sm;

  useEffect(() => {
    if (message) {
      AccessibilityInfo.announceForAccessibility(`${message}. Double tap to undo.`);
    }
    opacity.value = withTiming(message ? 1 : 0, quick);
  }, [message, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (!message) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        {
          position: 'absolute',
          left: spacing.lg,
          right: spacing.lg,
          bottom: bottomOffset,
        },
        animatedStyle,
      ]}
    >
      <View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.lg,
            borderRadius: radius.pill,
            backgroundColor: isDark ? colors.surfaceAlt : colors.text,
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.lg,
          },
          elevation[isDark ? 'dark' : 'light'],
        ]}
      >
        <Text
          style={[type.body, { color: isDark ? colors.text : colors.bg, flex: 1 }]}
          numberOfLines={2}
        >
          {message}
        </Text>
        <Pressable
          onPress={onUndo}
          accessibilityRole="button"
          accessibilityLabel="Undo"
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' })}
        >
          <Text style={[type.body, { color: colors.accent, fontWeight: '600' }]}>Undo</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}
