import { Text, View } from 'react-native';

import { useTheme } from '../../theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

type EmptyProps = {
  title: string;
  message?: string;
  /**
   * From the shared vocabulary, and preferred over emoji: it takes its colour
   * from the theme, so it reads the same weight in both palettes.
   */
  icon?: IconName;
  emoji?: string;
  actionLabel?: string;
  actionIcon?: IconName;
  onAction?: () => void;
  /**
   * A screen with nothing on it usually has exactly one thing worth doing, so
   * the action defaults to the primary control. Pass secondary when the empty
   * state is nested inside a screen that already has a primary action.
   */
  actionVariant?: 'primary' | 'secondary';
};

/**
 * What a screen looks like before it has anything to show.
 *
 * It carries the action rather than leaving each caller to remember one,
 * because an empty state that only apologises teaches nothing: the user is
 * here first, and this is the moment to say what fills the screen and how.
 */
export function Empty({
  title,
  message,
  icon,
  emoji = '🍽️',
  actionLabel,
  actionIcon,
  onAction,
  actionVariant = 'primary',
}: EmptyProps) {
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
      {icon ? (
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.accentSoft,
            marginBottom: spacing.xs,
          }}
        >
          <Icon name={icon} size={26} color={colors.accent} />
        </View>
      ) : (
        <Text style={{ fontSize: 30 }}>{emoji}</Text>
      )}
      <Text style={[type.subtitle, { color: colors.text, textAlign: 'center' }]}>{title}</Text>
      {message ? (
        <Text style={[type.caption, { color: colors.muted, textAlign: 'center' }]}>{message}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          icon={actionIcon}
          variant={actionVariant}
          onPress={onAction}
          style={{ marginTop: spacing.md }}
        />
      ) : null}
    </View>
  );
}
