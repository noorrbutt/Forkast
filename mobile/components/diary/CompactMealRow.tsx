import { Pressable, Text, View } from 'react-native';

import { EstimateBadge, Icon } from '../ui';
import { displayDish, formatNumber } from '../../lib/format';
import type { FoodLog } from '../../lib/types';
import { useTheme } from '../../theme';
import { MealActions } from './MealActions';
import { PendingBadge, RefinedTag, useJustRefined } from './MealBadges';
import { mealMeta, THUMB, type MealRowProps } from './rowProps';
import { SwipeToDelete } from './SwipeToDelete';

/**
 * The width the calorie figures share.
 *
 * A minimum rather than a fixed width. The point of the column is that 820 and
 * 1,240 line up on their right edges and can be read down the page, and this is
 * wide enough for every figure the server will store; a pinned width would make
 * an outlier wrap onto two lines at large system text sizes instead.
 */
const CALORIES = 64;

/**
 * The tile's fill and ink for a meal's category: a tint of the same danger
 * or success tokens the rest of the app already uses for junk versus clean,
 * not a one-off colour invented for this row, and a neutral tile when a log
 * (rare, but possible) carries no category at all.
 */
function categoryTileTone(
  colors: ReturnType<typeof useTheme>['colors'],
  category: FoodLog['category'],
): { fill: string; ink: string } {
  if (!category) return { fill: colors.surfaceAlt, ink: colors.muted };
  return category.is_junk
    ? { fill: colors.dangerSoft, ink: colors.danger }
    : { fill: colors.successSoft, ink: colors.success };
}

/**
 * A meal with no photo. Compact: a category icon, the dish, the figure to
 * compare, the way in.
 *
 * The calorie figure is `body` in ink, right aligned in a shared column: it
 * is there to be compared down the page rather than read as a headline, and
 * alignment does that job better than size would.
 */
export function CompactMealRow({ log, last, onOpen, onRepeat, onDelete, onAskDelete, onLongPress, sending, confirmed, error }: MealRowProps) {
  const { colors, radius, spacing, type } = useTheme();
  const justRefined = useJustRefined(log);
  const meta = mealMeta(log);

  return (
    <SwipeToDelete
      disabled={log.pending ?? false}
      dishName={displayDish(log.dish_name)}
      onDelete={() => onDelete(log.id)}
    >
      {/* The footer below is a SIBLING of this Pressable, not a child of it:
          nesting it would mean a tap on Log again or Delete has to fall
          through this row's own touch responder first, and the day that
          either button needs a disabled state (the never-disabled comment
          on Log again's own Pressable explains why that is not hypothetical)
          a disabled inner Pressable stops claiming the touch and the row
          underneath opens the meal instead. Siblings inside one container
          can never have that failure mode. */}
      <View style={{ borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
        <Pressable
          // No real id to open yet -- this row is the client_id, and the meal
          // it names does not exist on the server until the save settles.
          onPress={() => !log.pending && onOpen(log.id)}
          onLongPress={() => !log.pending && onLongPress(log.id)}
          disabled={log.pending}
          accessibilityRole="button"
          accessibilityLabel={
            log.pending
              ? `${log.dish_name}, saving`
              : `${log.dish_name}, ${formatNumber(log.estimated_calories)} kcal`
          }
          accessibilityHint={log.pending ? undefined : 'Opens this meal'}
          // The long press this row answers to is a shortcut; the custom action
          // is the same menu reached without a gesture at all, the way VoiceOver's
          // rotor and TalkBack's local context menu already expect one.
          accessibilityActions={log.pending ? undefined : [{ name: 'longpress', label: 'Show actions' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'longpress') onLongPress(log.id);
          }}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.lg,
            padding: spacing.lg,
            backgroundColor: pressed && !log.pending ? colors.surfaceAlt : 'transparent',
            opacity: log.pending ? 0.7 : 1,
          })}
        >
          <View
            style={{
              width: THUMB,
              height: THUMB,
              borderRadius: radius.tile,
              backgroundColor: categoryTileTone(colors, log.category).fill,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            <Icon name="meal" size={26} color={categoryTileTone(colors, log.category).ink} />
          </View>

          <View style={{ flex: 1, gap: spacing.xs }}>
            {/* Up to two lines now that kcal and the chevron no longer share
                this line fighting it for width -- a dish nobody can read is
                worse than a row two lines tall, and a third line was never
                the point, just what was left once two other things crowded
                onto the same row. */}
            <Text style={[type.subtitle, { color: colors.text }]} numberOfLines={2}>
              {displayDish(log.dish_name)}
            </Text>

            {log.pending ? <PendingBadge /> : justRefined ? <RefinedTag /> : null}

            {/* `text`, not `muted`: a caption that names the category, the
                restaurant and the serving is read as often as the dish name
                itself, and muted-on-surface was the quietest thing on the row
                for content someone actually relies on. One line, truncated --
                a row's height should not depend on how long a restaurant's
                name happens to be. */}
            {meta ? (
              <Text numberOfLines={1} ellipsizeMode="tail" style={[type.caption, { color: colors.text }]}>
                {meta}
              </Text>
            ) : null}
          </View>

          <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
            <Text
              style={[
                type.body,
                {
                  color: colors.text,
                  minWidth: CALORIES,
                  textAlign: 'right',
                  // Lining figures, so a column of digits stays a column. This
                  // lives here rather than on the token because `body` is the
                  // reading text token and sets prose everywhere else.
                  fontVariant: ['tabular-nums'],
                },
              ]}
            >
              {`${formatNumber(log.estimated_calories)} kcal`}
            </Text>
            {/* Under the figure it qualifies, not beside it fighting the
                dish name for room -- the whole reason this used to crowd
                onto one line in the first place. */}
            {!log.pending && log.estimate_source === 'local' ? <EstimateBadge /> : null}
          </View>

          {/* The row is the way in to the meal, which nothing else here says
              out loud -- except while pending, when there is nowhere to go
              yet. Off the title line and onto its own column so it stops
              fighting the dish name and the kcal figure for width. */}
          {log.pending ? null : <Icon name="forward" size={18} color={colors.muted} />}
        </Pressable>

        {/* Repeating or acting on a meal that does not exist on the server
            yet has nothing to act on. */}
        {log.pending ? null : (
          <View
            style={{
              paddingHorizontal: spacing.lg,
              paddingBottom: spacing.md,
              paddingTop: spacing.xs,
            }}
          >
            <MealActions
              log={log}
              onRepeat={onRepeat}
              onAskDelete={onAskDelete}
              sending={sending}
              confirmed={confirmed}
              error={error}
            />
          </View>
        )}
      </View>
    </SwipeToDelete>
  );
}
