import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { formatNumber } from '../../lib/format';
import { useTheme } from '../../theme';
import { Icon } from './Icon';

type ProgressProps = {
  /**
   * What has been used so far. Free to sit above max, and free to be negative:
   * a day where the workout outran the food is a real day, not an error.
   */
  value: number;
  /**
   * The target. Null draws no bar at all, because a bar needs a denominator and
   * the only honest one here is the one the user set.
   */
  max: number | null;
  /** Printed after both numbers. */
  unit?: string;
  /**
   * Names the bar for assistive tech. The visible heading belongs to the card
   * around this component, so it is not drawn a second time here.
   */
  label?: string;
  /** One line under the bar. A bar cannot say which number it is measuring. */
  caption?: string;
  style?: StyleProp<ViewStyle>;
};

const BAR_HEIGHT = 14;
/** So the first small meal of the day still shows as a sliver rather than nothing. */
const MIN_FILL = 6;
/** The target line, left visible underneath an overshoot. */
const MARKER_WIDTH = 2;

/**
 * A value against a target.
 *
 * Going over is the state this is built around. A bar that fills up and stops
 * reads the same at one calorie over as at a thousand, so the track is scaled
 * to whichever of the two numbers is larger and the overshoot is drawn past the
 * target line. The words carry it as well as the shape: "Over by 200 kcal" is
 * printed beside a warning glyph, because a red bar says nothing at all to
 * someone who cannot pick red out from amber.
 */
export function Progress({ value, max, unit = 'kcal', label, caption, style }: ProgressProps) {
  const { colors, radius, spacing, type } = useTheme();

  // A zero target cannot be stored and dividing by one here would hand yoga a
  // NaN, so anything that is not a positive number reads as no target at all.
  const target = max !== null && Number.isFinite(max) && max > 0 ? max : null;
  const used = Number.isFinite(value) ? value : 0;

  if (target === null) {
    return (
      <View style={[{ gap: spacing.xs }, style]}>
        <Text style={[type.title, { color: colors.text }]}>{`${formatNumber(used)} ${unit}`}</Text>
        {caption ? <Text style={[type.caption, { color: colors.muted }]}>{caption}</Text> : null}
      </View>
    );
  }

  const remaining = target - used;
  const over = remaining < 0;
  const span = Math.max(target, used);
  // Both segments are given a share of the track and the two always add up to
  // one, so the split never depends on how flex distributes a total below one.
  const reached = Math.max(0, Math.min(used, target)) / span;

  const reading = `${formatNumber(used)} / ${formatNumber(target)} ${unit}`;
  const status = over
    ? `Over by ${formatNumber(-remaining)} ${unit}`
    : remaining === 0
      ? `Right on target, 0 ${unit} left`
      : `${formatNumber(remaining)} ${unit} left`;

  return (
    <View style={[{ gap: spacing.sm }, style]}>
      <Text style={[type.title, { color: colors.text }]}>{reading}</Text>

      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        // now stays the real figure rather than a clamped one. A screen reader
        // announcing 1,800 of 1,800 on a 2,000 kcal day would be describing a
        // different day from the one on screen.
        accessibilityValue={{
          min: 0,
          max: Math.round(target),
          now: Math.round(used),
          text: `${reading}. ${status}.`,
        }}
        style={{
          flexDirection: 'row',
          height: BAR_HEIGHT,
          borderRadius: radius.pill,
          backgroundColor: colors.surfaceAlt,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            flex: reached,
            minWidth: used > 0 ? MIN_FILL : 0,
            backgroundColor: colors.accentFill,
          }}
        />
        {over ? <View style={{ width: MARKER_WIDTH, backgroundColor: colors.bg }} /> : null}
        <View
          style={{
            flex: 1 - reached,
            backgroundColor: over ? colors.danger : colors.surfaceAlt,
          }}
        />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        {over ? <Icon name="warning" size={14} color={colors.danger} /> : null}
        <Text style={[type.subtitle, { color: over ? colors.danger : colors.text }]}>{status}</Text>
      </View>

      {caption ? <Text style={[type.caption, { color: colors.muted }]}>{caption}</Text> : null}
    </View>
  );
}
