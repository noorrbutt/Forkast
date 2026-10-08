import { LinearGradient } from 'expo-linear-gradient';
import { Image, Pressable, Text, View } from 'react-native';

import { EstimateBadge } from '../ui';
import { usePhotoSource } from '../../hooks/usePhoto';
import { displayDish, formatNumber } from '../../lib/format';
import { useTheme } from '../../theme';
import { elevation, photoScrim } from '../../theme/tokens';
import { MealActions } from './MealActions';
import { RefinedTag, useJustRefined } from './MealBadges';
import { mealMeta, type MealRowProps } from './rowProps';
import { SwipeToDelete } from './SwipeToDelete';

/** Inlined so the photo card does not pull in StyleSheet for one constant;
 * `absoluteFill` exists as a style id but not as a typed plain object on
 * this RN version, so this is the literal it resolves to. */
const ABSOLUTE_FILL = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

const PHOTO_HEIGHT = 240;

/**
 * A meal WITH a photo. Full width, taller, the picture doing the work a
 * 64pt square never could: dish name, figure and meta sit over the bottom of
 * the image itself rather than beside a thumbnail of it.
 *
 * The gradient is `photoScrim` from tokens, fixed across themes, because what
 * sits under it is a photograph rather than a screen. It used to borrow the
 * modal `scrim`, which on light is only 42% black and left white text near 2:1
 * over a white plate. The white text on top is a fixed value for the same
 * reason -- a photo carries its own colours and `colors.text`, tuned to sit on
 * this app's own two backgrounds, has no reason to be legible against
 * someone's dinner.
 */
export function PhotoMealRow({ log, last, onOpen, onRepeat, onDelete, onAskDelete, onLongPress, sending, confirmed, error }: MealRowProps) {
  const { colors, isDark, radius, spacing, type } = useTheme();
  const photo = usePhotoSource(log.id);
  const justRefined = useJustRefined(log);
  const meta = mealMeta(log);

  return (
    <View style={{ paddingBottom: last ? 0 : spacing.lg }}>
      {/* The one rounded, elevated container for the whole card -- photo
          and footer both live inside it. A footer in a sibling View below
          the photo reads as a badge and a lone button floating under the
          card, outside its radius and its surface. overflow: hidden here is
          also what clips SwipeToDelete's reveal panel to these same rounded
          corners and lets it cover the full card height, not just the photo. */}
      <View
        style={[
          {
            borderRadius: radius.card,
            overflow: 'hidden',
            backgroundColor: colors.surfaceAlt,
          },
          // Same primary-surface treatment Card reserves for prominent
          // content: this photo is the one piece of rich content the diary
          // has, so it gets the full radius and, on light, the shadow that
          // lifts it off the page.
          !isDark ? elevation.light : null,
        ]}
      >
        {/* Same swipe and menu a photoless row answers to -- a photo is a
            different surface, not a different set of actions. Wraps the
            photo AND the footer together, so the reveal spans the whole
            card rather than just the photo portion. */}
        <SwipeToDelete disabled={false} dishName={log.dish_name} onDelete={() => onDelete(log.id)}>
          <View>
            <Pressable
              onPress={() => onOpen(log.id)}
              onLongPress={() => onLongPress(log.id)}
              accessibilityRole="button"
              accessibilityLabel={`${log.dish_name}, ${formatNumber(log.estimated_calories)} kcal`}
              accessibilityHint="Opens this meal"
              accessibilityActions={[{ name: 'longpress', label: 'Show actions' }]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'longpress') onLongPress(log.id);
              }}
              style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
            >
              {/* A fixed height rather than a 4:3 ratio capped by maxHeight.
                  The photo is here to be recognised, not to be the biggest
                  thing on the screen, so it stops at 240. But a ratio plus a
                  height cap made layout honour the ratio by shrinking the
                  WIDTH to 320 once the cap bound, which on any phone wider
                  than that left a dark strip of card down the right edge.
                  240 is what every phone already got. */}
              <View style={{ width: '100%', height: PHOTO_HEIGHT }}>
                {photo ? (
                  <Image
                    source={photo}
                    style={ABSOLUTE_FILL}
                    resizeMode="cover"
                    accessibilityIgnoresInvertColors
                  />
                ) : null}

                {/* Only over the lower part of the photo, not the whole frame: the
                    food itself should read clearly, and the gradient exists solely
                    to buy the two lines of text at the bottom their contrast. */}
                <LinearGradient
                  colors={[...photoScrim.colors]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  locations={[...photoScrim.locations]}
                  style={ABSOLUTE_FILL}
                />

                {/* Estimated and Refined never both apply at once -- one is
                    "no category priced this yet" and the other is "a category
                    already did, and the background call just adjusted it" --
                    so the same top-left spot serves either. */}
                {log.estimate_source === 'local' || justRefined ? (
                  <View style={{ position: 'absolute', top: spacing.md, left: spacing.md }}>
                    {log.estimate_source === 'local' ? (
                      <EstimateBadge variant="overlay" />
                    ) : (
                      <RefinedTag overlay />
                    )}
                  </View>
                ) : null}

                <View
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    padding: spacing.lg,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md }}>
                    <Text
                      style={[type.subtitle, { color: '#FFFFFF', flex: 1 }]}
                      numberOfLines={2}
                    >
                      {displayDish(log.dish_name)}
                    </Text>
                    <Text
                      style={[
                        type.body,
                        { color: '#FFFFFF', fontVariant: ['tabular-nums'] },
                      ]}
                    >
                      {`${formatNumber(log.estimated_calories)} kcal`}
                    </Text>
                  </View>
                </View>
              </View>
            </Pressable>

            {/* The footer: a sibling of the Pressable above, inside this
                same card, for the same reason as CompactMealRow's footer --
                nesting it inside the Pressable would be the wrong call the
                moment either button needed a disabled state. */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
              }}
            >
              {meta ? (
                <Text
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={[type.caption, { color: colors.text, flex: 1 }]}
                >
                  {meta}
                </Text>
              ) : (
                <View style={{ flex: 1 }} />
              )}
              <MealActions
                log={log}
                onRepeat={onRepeat}
                onAskDelete={onAskDelete}
                sending={sending}
                confirmed={confirmed}
                error={error}
              />
            </View>
          </View>
        </SwipeToDelete>
      </View>
    </View>
  );
}
