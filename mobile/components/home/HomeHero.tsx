import { Pressable, Text, View } from 'react-native';

import { Button, Hero, HeroWash, Ring } from '../ui';
import { formatNumber } from '../../lib/format';
import type { Today } from '../../lib/types';
import { useTheme } from '../../theme';

/**
 * Home's first answer: how much is left today.
 *
 * What is left is the hero numeral, on the left, with one quiet line under it
 * saying what it is left of. The ring stays as a small meter beside it rather
 * than as a 240pt frame around the number: at that size its empty track was
 * the loudest thing on the screen, louder than the figure it was there to
 * support. Eaten and burned follow as one inline pair rather than two
 * displaySm figures, because they explain the hero rather than compete with
 * it.
 */

/** Small enough to sit beside the numeral, large enough to read as a meter. */
export const HERO_RING_SIZE = 96;

/**
 * Everything the hero says, worked out in one place, so the figure, the line
 * under it and the ring's spoken label can never disagree.
 */
export function readToday(today: Today) {
  // A non-positive target is no target: there is nothing to be a fraction of.
  const target =
    today.target !== null && Number.isFinite(today.target) && today.target > 0
      ? today.target
      : null;

  const remaining = target === null ? null : target - today.net;
  const over = remaining !== null && remaining < 0;

  // Section 9: the meter says which number it measures. With nothing burned
  // net and eaten are the same number, so the plain "150 of 2,200" is true;
  // once something is burned it says "net", because that is what moved.
  const measured = today.burned > 0 ? `${formatNumber(today.net)} net` : formatNumber(today.net);
  const measures =
    target === null
      ? 'No daily target yet, so there is nothing to measure this against.'
      : `${measured} of ${formatNumber(target)} kcal`;

  const accessibilityLabel =
    target === null
      ? `${formatNumber(today.net)} kcal today. No daily target set.`
      : over
        ? `Over by ${formatNumber(Math.abs(remaining ?? 0))} kcal. ${formatNumber(today.net)} net of ${formatNumber(target)} kcal target.`
        : `${formatNumber(remaining)} kcal left. ${formatNumber(today.net)} net of ${formatNumber(target)} kcal target.`;

  return {
    target,
    over,
    measures,
    accessibilityLabel,
    figure: remaining === null ? formatNumber(today.net) : formatNumber(Math.abs(remaining)),
    caption: remaining === null ? 'kcal today' : over ? 'kcal over' : 'kcal left',
  };
}

export function HomeHero({
  today,
  onSetTarget,
  onEditBurn,
}: {
  today: Today;
  onSetTarget: () => void;
  onEditBurn: () => void;
}) {
  const { colors, spacing, type } = useTheme();
  const reading = readToday(today);
  const burnedNothing = today.burned === 0;

  return (
    // pullUp off: Home has no header, so pulling up would put the figure
    // under the status bar on a notched phone.
    <HeroWash pullUp={false}>
      {/* HeroWash already pays spacing.xxl of its own paddingBottom, so this
          only needs to separate the eaten/burned line from the hero above it,
          not open a second gap before the Today strip starts. It used to add
          xxxl on top of that, which read as 80pt of dead air under the ring. */}
      <View style={{ gap: spacing.lg, paddingBottom: spacing.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Hero
              value={reading.figure}
              caption={reading.caption}
              color={reading.over ? colors.danger : undefined}
            />
            <Text style={[type.caption, { color: colors.muted }]}>{reading.measures}</Text>
          </View>

          {/* No target, no ring: a meter with no limit has nothing to fill. */}
          {reading.target === null ? null : (
            <Ring
              value={today.net}
              max={reading.target}
              size={HERO_RING_SIZE}
              accessibilityLabel={reading.accessibilityLabel}
            />
          )}
        </View>

        {reading.target === null ? (
          <View style={{ alignSelf: 'flex-start' }}>
            <Button label="Set a daily target" variant="secondary" onPress={onSetTarget} />
          </View>
        ) : null}

        {/* One inline pair. Burned is the control for changing it, and reads
            muted at zero so an untouched "0 burned" does not claim attention
            it has not earned; it stays legible, since it is still the way in. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Text style={[type.body, { color: colors.text, fontVariant: ['tabular-nums'] }]}>
            {`${formatNumber(today.consumed)} eaten`}
          </Text>
          <Text style={[type.body, { color: colors.muted }]} importantForAccessibility="no">
            ·
          </Text>
          <Pressable
            onPress={onEditBurn}
            accessibilityRole="button"
            accessibilityLabel={`${formatNumber(today.burned)} kcal burned`}
            accessibilityHint="Opens a box to change what you burned today"
            hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <Text
              testID="hero-burned"
              style={[
                type.body,
                {
                  color: burnedNothing ? colors.muted : colors.text,
                  fontVariant: ['tabular-nums'],
                  textDecorationLine: 'underline',
                },
              ]}
            >
              {`${formatNumber(today.burned)} burned`}
            </Text>
          </Pressable>
        </View>
      </View>
    </HeroWash>
  );
}
