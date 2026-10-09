import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { FormError, Icon } from '../ui';
import { useTheme } from '../../theme';
import type { MealRowProps } from './rowProps';

/** The pills' own height. Short of the 44dp target on its own, which is why
 * every pill below carries hitSlop rather than growing the row to meet it --
 * over a hundred rows, the extra padding that would take doubles the row
 * height for a touch target most people press within a few points of dead
 * centre anyway. */
const PILL_HEIGHT = 38;
const PILL_HIT_SLOP = 6;

/**
 * Log again and Delete, the confirmation and the error -- the card's footer,
 * a sibling of the row's own Pressable rather than a child of it (see
 * CompactMealRow/PhotoMealRow). Delete asks first, the same way Log again
 * does: both are one plain tap away on every row, which is exactly why
 * neither should act immediately. Swipe and the long-press menu are their
 * own deliberate steps already and skip the question (onDelete, not
 * onAskDelete).
 */
export function MealActions({
  log,
  onRepeat,
  onAskDelete,
  sending,
  confirmed,
  error,
}: Pick<MealRowProps, 'log' | 'onRepeat' | 'onAskDelete' | 'sending' | 'confirmed' | 'error'>) {
  const { colors, radius, spacing, type } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Pressable
          // Deliberately never disabled, however much a spinner would suit
          // it. A disabled Pressable does not claim the touch, so the row
          // underneath would take the second tap and open the meal, which is
          // the one thing this button must not do. It stays live, absorbs the
          // tap, and the guard in the screen refuses the duplicate. The
          // accessibility label carries the state instead.
          onPress={() => onRepeat(log.id)}
          accessibilityRole="button"
          accessibilityLabel={sending ? 'Logging again' : 'Log again'}
          accessibilityHint={`Adds ${log.dish_name} to today, with the time you tap it`}
          hitSlop={PILL_HIT_SLOP}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            height: PILL_HEIGHT,
            borderRadius: radius.pill,
            borderWidth: 1.5,
            borderColor: colors.outline,
            paddingHorizontal: spacing.md,
            backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
          })}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Icon name="repeat" size={16} color={colors.accent} />
          )}
          <Text style={[type.caption, { color: colors.accent, fontWeight: '600' }]}>
            {sending ? 'Logging' : 'Log again'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => onAskDelete(log.id)}
          accessibilityRole="button"
          // Plain "Delete", not "Delete {dish}" -- the swipe reveal's own
          // panel already uses that exact label (SwipeToDelete), and both
          // controls exist in the tree at once now that this footer button
          // is a standing fixture rather than hidden behind a gesture. Two
          // controls announcing the identical label in one row is the real
          // problem a repeated string would leave unsolved, not just a test
          // ambiguity. "Delete" alone matches the long-press menu's own
          // Delete action, which names the dish in its title instead.
          accessibilityLabel="Delete"
          accessibilityHint={`Removes ${log.dish_name} from your diary, with a few seconds to undo it`}
          hitSlop={PILL_HIT_SLOP}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            height: PILL_HEIGHT,
            borderRadius: radius.pill,
            paddingHorizontal: spacing.sm,
            backgroundColor: pressed ? colors.dangerSoft : 'transparent',
          })}
        >
          {/* Icon only, in muted ink. It sat beside Log again at the same
              weight, a labelled pill in red against a labelled pill in
              saffron, so the rare destructive action competed with the
              everyday one. The glyph still names it, the accessibility label
              says "Delete", and the confirmation dialog it opens is unchanged,
              so nothing about how safe it is has moved. Red is kept for that
              dialog and the press state, where the action is actually taken. */}
          <Icon name="trash" size={16} color={colors.muted} />
        </Pressable>
      </View>

      {confirmed ? (
        <Text style={[type.caption, { color: colors.success }]}>Logged again for today.</Text>
      ) : null}
      {error ? <FormError>{error}</FormError> : null}
    </View>
  );
}
