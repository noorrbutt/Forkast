import { Pressable, Text, View } from 'react-native';

import { Icon } from '../ui';
import { useTheme } from '../../theme';
import type { TileSize } from './MealTile';
import { SLOT_LABELS, type Slot } from './todayMeals';

/**
 * A slot nothing has been logged in yet, as a tile you can tap to fill.
 *
 * This is what makes the strip the way in to Log on Home, so the raised log
 * button can step aside here, and it is also the empty state: a new day is
 * three of these, which says what will appear and offers the action that
 * puts it there in the same place.
 *
 * Dashed in `outline`, which clears 3:1 against the page, because a control
 * with neither a fill nor a visible boundary reads as text (section 3).
 */
export function GhostSlotTile({
  slot,
  size,
  onPress,
}: {
  /** Null once every slot is filled or past: a plain "another meal" tile, so
   * Home never loses its way in to Log while the raised button is hidden. */
  slot: Slot | null;
  size: TileSize;
  onPress: (slot: Slot | null) => void;
}) {
  const { colors, radius, spacing, type } = useTheme();
  const label = slot ? SLOT_LABELS[slot] : 'Another meal';

  return (
    <Pressable
      testID={`today-ghost-${slot ?? 'any'}`}
      onPress={() => onPress(slot)}
      accessibilityRole="button"
      accessibilityLabel={slot ? `Log ${label.toLowerCase()}` : 'Log a meal'}
      accessibilityHint="Opens Log"
      style={({ pressed }) => ({
        width: size.width,
        height: size.height,
        borderRadius: radius.input,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: colors.outline,
        padding: spacing.md,
        justifyContent: 'space-between',
        backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
      })}
    >
      <View style={{ alignSelf: 'flex-start' }}>
        <Icon name="log" size={20} color={colors.accent} />
      </View>
      <Text style={[type.subtitle, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}
