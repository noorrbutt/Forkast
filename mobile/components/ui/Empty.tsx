import { Text, View } from 'react-native';

import { useTheme } from '../../theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

type EmptyProps = {
  title: string;
  message?: string;
  /**
   * From the shared vocabulary. It takes its colour from the theme, so it reads
   * the same weight in both palettes, which an emoji cannot: an emoji is a
   * bitmap the platform picks, so it ignored the palette, changed shape between
   * iOS, Android and web, and was a second way of saying what the Icon map
   * already says.
   */
  icon?: IconName;
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
      {/* The glyph alone, with no disc under it. Section 10 bans a disc added
          beneath a lone icon to make it look weightier, and this was the
          clearest case of it in the app: a 56pt saffron circle carrying a 26pt
          glyph. Muted rather than accent for the same reason the welcome screen
          gave up its three coloured discs, since saffron is the colour that
          means "you can press this" and the button below is what can be
          pressed. */}
      {icon ? (
        <View style={{ marginBottom: spacing.xs }}>
          <Icon name={icon} size={32} color={colors.muted} />
        </View>
      ) : null}
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
