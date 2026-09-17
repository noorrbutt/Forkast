import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Card, Chip, ErrorState, Hero, Loading, Screen } from '../../components/ui';
import { useMe } from '../../hooks/useAuth';
import { useGeneratePlan, usePlans } from '../../hooks/usePlans';
import { describeError } from '../../lib/api';
import { GOAL_BLURBS, GOAL_LABELS, formatDate, formatNumber, titleCase } from '../../lib/format';
import { GOALS, type Goal, type Plan } from '../../lib/types';
import { useTheme } from '../../theme';

/**
 * The goal, as a control rather than as a section of its own.
 *
 * Three options is the one case where chips beat a list: all three fit on a
 * line and the choice is a mood rather than a lookup. The lead in line is
 * sentence case caption text, not a tracked out uppercase eyebrow, because a
 * control needs a name and not a badge.
 */
function GoalPicker({
  goal,
  onPick,
  blurb,
  disabled,
}: {
  goal: Goal;
  onPick: (goal: Goal) => void;
  /** The detail under the chips. Only worth the room before a plan exists. */
  blurb?: boolean;
  disabled?: boolean;
}) {
  const { colors, spacing, type } = useTheme();

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={[type.caption, { color: colors.muted }]}>Planning for</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {GOALS.map((option) => (
          <Chip
            key={option}
            label={GOAL_LABELS[option]}
            selected={goal === option}
            disabled={disabled}
            showCheck
            onPress={() => onPick(option)}
          />
        ))}
      </View>
      {blurb ? (
        <Text style={[type.caption, { color: colors.muted }]}>{GOAL_BLURBS[goal]}</Text>
      ) : null}
    </View>
  );
}

/**
 * The one thing: what this plan comes to in calories a day, as a single figure.
 *
 * The screen answers "what should I eat", so the plan is the content and the
 * goal picker is a control that sits above it and stays small. The figure is
 * the only number here that is not one of nine meal estimates, and it is the
 * one that makes the plan comparable to the target on the dashboard, so it can
 * lead without competing with the list under it.
 *
 * The three days themselves are genuinely repetitive, equal weight content.
 * Tuesday is not more important than Monday and nothing in the data says
 * otherwise, which is exactly the case the style guide reserves a list for, so
 * they are a list rather than a promoted card each. They share one surface so
 * the plan reads as one object, and so a plan that ever comes back longer than
 * three days cannot turn the screen back into a stack of cards.
 *
 * With no plan yet, the screen leads with the question it exists to answer and
 * puts the one action that answers it directly underneath.
 */
export default function PlanRoute() {
  const { colors, layout, radius, spacing, type } = useTheme();
  const me = useMe();
  const plans = usePlans();
  const generate = useGeneratePlan();

  const [picked, setPicked] = useState<Goal | null>(null);
  const goal: Goal = picked ?? me.data?.goal ?? 'maintain';

  // The freshly generated plan wins, otherwise fall back to the newest stored one.
  const plan: Plan | null = generate.data ?? plans.data?.[0] ?? null;
  const generated = plan?.generated_plan ?? null;
  const days = generated?.days ?? [];
  const nudges = generated?.nudges ?? [];

  const dayTotals = days.map((day) =>
    (day.meals ?? []).reduce((sum, meal) => sum + (meal.approx_calories ?? 0), 0),
  );
  // A plan whose meals carry no estimates would put a zero at the top of the
  // screen, and a zero measures nothing, so in that case the summary leads
  // instead and the screen has no hero at all.
  const perDay =
    dayTotals.length > 0 ? Math.round(dayTotals.reduce((a, b) => a + b, 0) / dayTotals.length) : 0;

  // The column below already puts lg between its children, so xxl on each side
  // of the hero lands its surrounding space on xxxl, which nothing else may
  // have.
  const heroSpace = { paddingTop: spacing.xxl, paddingBottom: spacing.xxl };

  const hasPlan = Boolean(plan && generated);
  // isPending rather than isLoading, because the query is disabled until the
  // stored token has been read back from the keystore and a disabled query is
  // not "loading". Reading it that way flashed the empty screen's headline for
  // a frame before the request had even been sent.
  const looking = plans.isPending && !hasPlan;

  /**
   * One capped, centred column.
   *
   * The gap matches what Screen's scroll container was applying before this
   * wrapper existed, so the rhythm between blocks is unchanged and the hero's
   * xxl padding still lands on xxxl of surrounding space.
   */
  const column = {
    width: '100%' as const,
    maxWidth: layout.contentWidth,
    alignSelf: 'center' as const,
    gap: spacing.lg,
  };

  return (
    <Screen title="AI meal plan">
      <View style={column}>
        {looking ? <Loading label="Looking for past plans" /> : null}

        {!hasPlan && !looking ? (
          <>
            {/* Whether the last plan could be fetched or not, the action that
                makes a new one stays on the screen underneath. A failure to read
                the history is not a reason to take away the only thing this
                screen is for. */}
            {plans.isError ? (
              <ErrorState
                title="Plans unavailable"
                message={describeError(plans.error)}
                onRetry={() => void plans.refetch()}
              />
            ) : (
              <View style={{ gap: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.xl }}>
                <Text style={[type.display, { color: colors.text }]}>What should I eat?</Text>
                <Text style={[type.body, { color: colors.muted }]}>
                  Forkast reads what you have been logging and writes three days of breakfast, lunch
                  and dinner around your goal.
                </Text>
              </View>
            )}

            <GoalPicker goal={goal} onPick={setPicked} blurb disabled={generate.isPending} />

            <Button
              label="Generate a plan"
              size="lg"
              full
              loading={generate.isPending}
              onPress={() => generate.mutate(goal)}
            />

            {generate.isError ? (
              <Text style={[type.caption, { color: colors.danger }]}>
                {describeError(generate.error)}
              </Text>
            ) : null}
          </>
        ) : null}

        {plan && generated ? (
          <>
            {perDay > 0 ? (
              <View style={heroSpace}>
                <Hero
                  value={formatNumber(perDay)}
                  caption={`kcal a day, across ${days.length} ${days.length === 1 ? 'day' : 'days'}`}
                />
              </View>
            ) : null}

            <View style={{ gap: spacing.sm }}>
              <Text style={[perDay > 0 ? type.body : type.title, { color: colors.text }]}>
                {generated.summary || 'Three days shaped around your goal.'}
              </Text>
              <Text style={[type.caption, { color: colors.muted }]}>
                {GOAL_LABELS[plan.goal] ?? titleCase(String(plan.goal))} plan
                {plan.created_at ? `, made ${formatDate(plan.created_at)}` : ''}.
              </Text>
            </View>

            <Card>
              <View style={{ gap: spacing.xl }}>
                {days.map((day, dayIndex) => (
                  <View key={`${day.day}-${dayIndex}`} style={{ gap: spacing.lg }}>
                    {dayIndex > 0 ? (
                      <View style={{ height: layout.hairline, backgroundColor: colors.border }} />
                    ) : null}

                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md }}>
                      <Text style={[type.title, { color: colors.text, flex: 1 }]}>{day.day}</Text>
                      {/* The unit sits once at the top of the column the meal
                          numbers align into, the way a table does it, rather than
                          being repeated on all nine rows. */}
                      <Text style={[type.caption, { color: colors.muted }]}>
                        {formatNumber(dayTotals[dayIndex])} kcal
                      </Text>
                    </View>

                    <View style={{ gap: spacing.lg }}>
                      {(day.meals ?? []).map((meal, mealIndex) => (
                        <View
                          key={`${meal.slot}-${mealIndex}`}
                          style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg }}
                        >
                          <View style={{ flex: 1, gap: spacing.xs }}>
                            <Text style={[type.caption, { color: colors.muted }]}>
                              {titleCase(meal.slot)}
                            </Text>
                            <Text style={[type.body, { color: colors.text }]}>{meal.suggestion}</Text>
                          </View>
                          <Text
                            style={[type.subtitle, { color: colors.muted }]}
                            // The column carries the unit visually. A screen
                            // reader has no column, so it gets the unit said.
                            accessibilityLabel={`${formatNumber(meal.approx_calories)} kcal`}
                          >
                            {formatNumber(meal.approx_calories)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            </Card>

            {nudges.length > 0 ? (
              <Card>
                <View style={{ gap: spacing.md }}>
                  <Text style={[type.title, { color: colors.text }]}>Worth knowing</Text>
                  {nudges.map((nudge, index) => (
                    <View
                      key={`${index}-${nudge.slice(0, 12)}`}
                      style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}
                    >
                      <View
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: radius.pill,
                          backgroundColor: colors.accent,
                          marginTop: spacing.sm,
                        }}
                      />
                      <Text style={[type.body, { color: colors.text, flex: 1 }]}>{nudge}</Text>
                    </View>
                  ))}
                </View>
              </Card>
            ) : null}
            {/* Below the plan, not above it. Section 6 asks for the dominant
                object in the top third, and a chip row with a button under it
                was taking that slot from the figure. Making another plan is also
                a decision taken after reading this one, so it belongs at the end
                of the reading rather than in front of it. The words on the button
                match the empty screen's, because it is the same action. */}
            <View style={{ gap: spacing.lg, paddingTop: spacing.xl }}>
              <GoalPicker goal={goal} onPick={setPicked} disabled={generate.isPending} />
              <Button
                label="Generate a plan"
                variant="secondary"
                align="start"
                loading={generate.isPending}
                onPress={() => generate.mutate(goal)}
              />
              {generate.isError ? (
                <Text style={[type.caption, { color: colors.danger }]}>
                  {describeError(generate.error)}
                </Text>
              ) : null}
            </View>
          </>
        ) : null}
      </View>
    </Screen>
  );
}
