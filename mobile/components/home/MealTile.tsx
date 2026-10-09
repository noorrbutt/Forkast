import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { Image, Pressable, Text, View, useWindowDimensions } from 'react-native';

import { categoryTileTone } from '../diary/CompactMealRow';
import { Icon } from '../ui';
import { TILE_PHOTO_EDGE, usePhotoSource } from '../../hooks/usePhoto';
import { displayDish, formatNumber } from '../../lib/format';
import type { FoodLog, Uuid } from '../../lib/types';
import { useTheme } from '../../theme';
import { photoScrim } from '../../theme/tokens';
import { slotLabelOf } from './todayMeals';

/**
 * One meal in Home's Today strip, as a tile.
 *
 * The no-photo tile is the first-class case, not the fallback: most meals are
 * typed rather than photographed, and a strip of grey boxes waiting for a
 * picture would make the front door look empty in everyday use. So it gets
 * its own composition, a solid surfaceAlt fill with the dish name set large
 * and the same category glyph chip the diary's compact row draws, rather
 * than a photo tile with the photo missing.
 */

export type TileSize = { width: number; height: number };

/** Portrait, 4:5, which is what 112 x 140 is. */
const ASPECT = 1.25;
/** How much of the next tile shows at the right edge, so the row reads as scrollable. */
const VISIBLE_TILES = 3.4;
const MIN_WIDTH = 96;
const MAX_WIDTH = 132;

/**
 * The tile size for this window: three whole tiles and part of a fourth.
 *
 * Worked out from the width rather than fixed at 112, so the fourth tile
 * peeks in on an SE and on a Pro Max alike instead of only on the phone the
 * number was chosen on. The strip starts at the content column's left edge
 * and runs on through the right-hand gutter, so that is the width it has;
 * on a wide window the column's cap binds and the tile stops growing.
 */
export function useTileSize(gap: number): TileSize {
  const { width } = useWindowDimensions();
  const { layout } = useTheme();
  const available =
    Math.min(width, layout.contentWidth + layout.screenPadding * 2) - layout.screenPadding;
  const raw = (available - gap * Math.floor(VISIBLE_TILES)) / VISIBLE_TILES;
  const tileWidth = Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, raw)));
  return { width: tileWidth, height: Math.round(tileWidth * ASPECT) };
}

/** What a screen reader hears for a tile: "Lunch, Chicken Biryani, 640 kcal". */
export function tileLabel(log: FoodLog): string {
  return `${slotLabelOf(log)}, ${displayDish(log.dish_name)}, ${formatNumber(log.estimated_calories)} kcal`;
}

type TileProps = {
  log: FoodLog;
  size: TileSize;
  onOpen: (id: Uuid) => void;
};

/** The pressable frame both kinds of tile share, so they open and announce alike. */
export function TileFrame({
  log,
  size,
  onOpen,
  testID,
  children,
}: TileProps & { testID: string; children: ReactNode }) {
  const { colors, radius } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={() => onOpen(log.id)}
      accessibilityRole="button"
      accessibilityLabel={tileLabel(log)}
      accessibilityHint="Opens this meal"
      style={({ pressed }) => ({
        width: size.width,
        height: size.height,
        // radius.input is 20, the tile radius the redesign asked for; a
        // 24 tile radius on a 112 wide tile read as a pill.
        borderRadius: radius.input,
        overflow: 'hidden',
        backgroundColor: colors.surfaceAlt,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}

/** The calorie figure as a small pill, the same place on both kinds of tile. */
export function KcalPill({ calories, overPhoto }: { calories: number; overPhoto: boolean }) {
  const { colors, radius, spacing, type } = useTheme();
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        borderRadius: radius.pill,
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        // Over a photo the pill is a dark chip with white ink, fixed across
        // themes for the same reason the diary's photo scrim is: what is
        // under it is someone's dinner, not one of this app's surfaces.
        backgroundColor: overPhoto ? 'rgba(0, 0, 0, 0.62)' : colors.surface,
      }}
    >
      <Text
        style={[
          type.labelSoft,
          { color: overPhoto ? '#FFFFFF' : colors.text, fontVariant: ['tabular-nums'] },
        ]}
      >
        {`${formatNumber(calories)} kcal`}
      </Text>
    </View>
  );
}

/**
 * A meal with no photo: the dish name is the picture.
 *
 * `subtitle` rather than anything larger, because the hero above owns the
 * big type and a column of 21pt dish names would compete with it; at tile
 * width 16/600 is already the largest thing inside the tile by a full step.
 */
export function NoPhotoMealTile({ log, size, onOpen }: TileProps) {
  const { colors, spacing, type } = useTheme();
  const tone = categoryTileTone(colors, log.category);

  return (
    <TileFrame log={log} size={size} onOpen={onOpen} testID={`today-tile-${log.id}`}>
      <View style={{ flex: 1, padding: spacing.md, justifyContent: 'space-between' }}>
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}
        >
          <KcalPill calories={log.estimated_calories} overPhoto={false} />
          <View
            testID="today-tile-glyph"
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: tone.fill,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="meal" size={16} color={tone.ink} />
          </View>
        </View>

        <Text style={[type.subtitle, { color: colors.text }]} numberOfLines={4}>
          {displayDish(log.dish_name)}
        </Text>
      </View>
    </TileFrame>
  );
}

/** Inlined, as in PhotoMealRow: the literal StyleSheet.absoluteFill resolves to. */
const ABSOLUTE_FILL = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

/**
 * A meal with a photo: the picture fills the tile, the name sits on a scrim.
 *
 * Requests the server's tile-sized copy (TILE_PHOTO_EDGE) rather than the
 * full stored photo. If the picture cannot be had at all, the tile falls back
 * to the no-photo composition rather than an empty frame with white text on
 * grey.
 */
export function PhotoMealTile({ log, size, onOpen }: TileProps) {
  const { spacing, type } = useTheme();
  const source = usePhotoSource(log.id, TILE_PHOTO_EDGE);
  const [failed, setFailed] = useState(false);

  if (failed) return <NoPhotoMealTile log={log} size={size} onOpen={onOpen} />;

  return (
    <TileFrame log={log} size={size} onOpen={onOpen} testID={`today-tile-${log.id}`}>
      {source ? (
        <Image
          testID="today-tile-photo"
          source={source}
          style={ABSOLUTE_FILL}
          resizeMode="cover"
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <LinearGradient
        colors={[...photoScrim.colors]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        locations={[...photoScrim.locations]}
        style={ABSOLUTE_FILL}
      />
      <View style={{ flex: 1, padding: spacing.md, justifyContent: 'space-between' }}>
        <KcalPill calories={log.estimated_calories} overPhoto />
        {/* Fixed white over the scrim, the diary photo card's own rule. */}
        <Text style={[type.subtitle, { color: '#FFFFFF' }]} numberOfLines={3}>
          {displayDish(log.dish_name)}
        </Text>
      </View>
    </TileFrame>
  );
}

/** The right tile for a meal, by whether it has a picture. */
export function MealTile(props: TileProps) {
  return props.log.has_photo ? <PhotoMealTile {...props} /> : <NoPhotoMealTile {...props} />;
}
