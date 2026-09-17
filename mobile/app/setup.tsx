import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Chip, Field, Screen } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useUpdateProfile } from '../hooks/useProfile';
import { describeError } from '../lib/api';
import { GOAL_BLURBS, GOAL_LABELS, formatNumber, suggestedTarget } from '../lib/format';
import { GOALS, type Goal } from '../lib/types';
import { useTheme } from '../theme';

/** Matches ck_users_calorie_target_plausible, so a typo is caught before a round trip. */
const MIN_TARGET = 0;
const MAX_TARGET = 10_000;

/** The goal this screen opens on, and therefore the target it opens with. */
const FIRST_GOAL: Goal = 'maintain';

/**
 * The form measure, the same one the log form uses.
 *
 * A form is a column of short controls, so on a tablet, a foldable or the web
 * build it has to stop somewhere. This screen previously had no cap at all and
 * ran a three chip row and a five digit number field across the full width of
 * whatever it was opened on.
 */
const COLUMN_WIDTH = 420;

/** What the device thinks it is, which is almost always what the user wants. */
function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    // Some Android builds ship an ICU without a resolvable zone. Falling back
    // to the server default is fine; the Profile tab can still fix it later.
    return null;
  }
}

/**
 * The one time setup, shown once immediately after an account is created.
 *
 * THE ONE THING: the question it asks, "What are you after?", at `display` over
 * the three answers. Nothing else on the screen is above 16, which is more than
 * the one full step of the type scale the guide asks for.
 *
 * No `hero` here, and that is deliberate rather than an omission. A hero is a
 * number or a short headline on one line, and the component holds it to one
 * line so it can never truncate. This screen leads with a question that wraps
 * to two lines on a phone, so forcing it into `hero` would risk exactly the
 * truncation the guide bans. `display` at 48/300 wraps, and the next largest
 * thing on the screen is 16, so it is dominant without it.
 *
 * It still asks for the two things that are expensive to get wrong and free to
 * get right at the start. Timezone decides which calendar day every meal and
 * every streak is filed under, and a day cannot be re-bucketed after the fact,
 * so a user who never opens Profile would quietly accumulate a run of wrong
 * days. The goal proposes the daily target, which is the number the dashboard
 * reports every day against, and then leaves that number alone for the user
 * to set.
 *
 * Everything here is skippable. Nothing on this screen is worth blocking
 * someone from logging their first meal.
 *
 * Section 13 critique of what this replaced.
 *
 * 1. What it was. An 11px uppercase eyebrow over a 48pt two line headline,
 *    then three cards of identical radius, padding and border stacked at one
 *    gap of 24, each carrying an icon, a heading and either one paragraph or
 *    one control, then two buttons.
 *
 * 2. Which rules it broke.
 *    - Section 4: `type.label`, the 11px uppercase letterspaced style, used as
 *      "One quick thing" above the headline. That style is restricted to the
 *      tab bar and to chart axis and legend text, and a tracked out eyebrow
 *      above a block is one of the named tells this guide exists to remove.
 *    - Section 10: an icon beside all three section headings, clock, trophy
 *      and chart.
 *    - Section 6 and Section 7: three same size cards on a screen that asks one
 *      question. The first held no control at all, just a sentence about the
 *      detected timezone, given the same surface and the same weight as the
 *      goal picker. Equal weight everywhere, which is the failure mode the
 *      guide exists to prevent.
 *    - Section 2 hierarchy: the largest thing on the screen said "Set your
 *      pace", which names nothing the screen does, while the question it
 *      actually asks sat inside card two at `subtitle`, 16. The dominant
 *      element and the point of the screen disagreed, so a stranger could not
 *      have named the one thing correctly.
 *    - Section 5: the content column was uncapped, which the guide calls out by
 *      name. A form running the full width of a tablet or a browser is not a
 *      design.
 *    - Section 3 accessibility: the goal chips carried selection as a border, a
 *      fill and an ink colour, with no tick. Selection has to change the border
 *      and add a tick so that it is never carried by colour alone.
 *
 * 3. What the one thing is now. "What are you after?" at 48, with one body line
 *    under it and the three answers immediately below that, 32 of space beneath
 *    the question against 24 between the groups under it.
 *
 * 4. What was demoted, and why that is correct.
 *    The timezone card is now one caption line near the bottom. It is not a
 *    decision: it is detected from the device, it is sent whether the user
 *    finishes or skips, and there is no control in it. A box around a sentence
 *    that asks nothing was the clearest case in the app of a card used as a
 *    container rather than as a surface.
 *    The daily target keeps its field and loses its card and its heading. The
 *    field already prints "Calories per day" above itself, so a heading saying
 *    "Daily target" directly over it was the same words twice, and the target
 *    belongs in the same group as the goal that proposes it rather than in a
 *    box of its own.
 *    All three cards are gone and space does the grouping: 8 inside a question,
 *    16 between questions in a group, 24 between groups.
 */
export default function SetupScreen() {
  const { colors, spacing, type } = useTheme();
  const { completeSetup } = useAuth();
  const updateProfile = useUpdateProfile();

  const zone = deviceTimezone();
  const [goal, setGoal] = useState<Goal>(FIRST_GOAL);
  const [target, setTarget] = useState(String(suggestedTarget(FIRST_GOAL)));
  // Whether the number below is theirs or ours. Once it is theirs, the goal
  // stops touching it, see pickGoal.
  const [typedTarget, setTypedTarget] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const trimmed = target.trim();
  const parsed = Number(trimmed);
  const targetGiven = trimmed.length > 0;
  const targetValid =
    !targetGiven ||
    (Number.isInteger(parsed) && parsed >= MIN_TARGET && parsed <= MAX_TARGET);

  /**
   * The goal proposes a target, then gets out of the way.
   *
   * It proposes only while the number is still ours. A figure someone typed is
   * the most considered thing on this screen, and silently replacing it while
   * they look at a different control would be the app overruling them, which
   * is worse than a goal that does nothing.
   */
  const pickGoal = (next: Goal) => {
    setGoal(next);
    if (typedTarget) return;
    setProblem(null);
    setTarget(String(suggestedTarget(next)));
  };

  const finish = (withTarget: boolean) => {
    if (updateProfile.isPending) return;
    if (withTarget && !targetValid) {
      setProblem(
        `A daily target is a whole number, up to ${formatNumber(MAX_TARGET)} kcal.`,
      );
      return;
    }
    setProblem(null);

    updateProfile.mutate(
      {
        goal,
        // Only send a timezone we actually detected. Sending null would ask the
        // server to overwrite a sensible default with nothing.
        ...(zone ? { timezone: zone } : {}),
        ...(withTarget && targetGiven ? { daily_calorie_target: parsed } : {}),
      },
      {
        onSuccess: completeSetup,
        /**
         * Setup is a convenience, not a gate. This is where that was written
         * down and then not done: on a failure both buttons spun, printed an
         * error and left the user exactly where they were, while the router
         * gate sent them straight back here from anywhere else. With the API
         * unreachable, which is the ordinary case of a stale LAN address or a
         * phone on another network, a new account had no way into the app at
         * all short of relaunching it.
         *
         * So skipping skips, whatever the server said. The account already
         * exists, the answers here all have defaults, and every one of them is
         * editable on the Profile tab. Saving still reports its failure and
         * stays put, because someone who filled the form in wants it kept and
         * the skip button beside it is the way out.
         */
        onError: () => {
          if (!withTarget) completeSetup();
        },
      },
    );
  };

  return (
    <Screen scroll bottomInset={spacing.xxl}>
      <View
        style={{
          width: '100%',
          maxWidth: COLUMN_WIDTH,
          alignSelf: 'center',
          gap: spacing.xl,
          paddingTop: spacing.lg,
        }}
      >
        {/* The one thing, and the only element on the screen above 16. */}
        <View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
          <Text style={[type.display, { color: colors.text }]}>What are you after?</Text>
          <Text style={[type.body, { color: colors.muted }]}>
            Your answer proposes a daily calorie target. Both are yours to change later.
          </Text>
        </View>

        {/* The goal and the number it proposes are one group, because that is
            the actual relationship between them. No heading over either: the
            question above is the heading for the chips, and the field prints
            its own label. */}
        <View style={{ gap: spacing.lg }}>
          <View style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {GOALS.map((option) => (
                <Chip
                  key={option}
                  label={GOAL_LABELS[option]}
                  selected={goal === option}
                  // The tick, so which one is chosen is never carried by the
                  // border and the fill colour alone.
                  showCheck
                  style={{ flexGrow: 1 }}
                  onPress={() => pickGoal(option)}
                />
              ))}
            </View>
            <Text style={[type.caption, { color: colors.muted }]}>{GOAL_BLURBS[goal]}</Text>
          </View>

          <Field
            label="Calories per day"
            value={target}
            onChangeText={(next) => {
              setProblem(null);
              setTypedTarget(true);
              setTarget(next.replace(/[^0-9]/g, ''));
            }}
            placeholder="e.g. 2000"
            keyboardType="number-pad"
            maxLength={5}
            editable={!updateProfile.isPending}
            // The one place the target explains itself, attached to the number
            // rather than said again in the paragraph at the top.
            hint="Filled in from your goal, and yours to change. The dashboard measures every day against this number."
          />
        </View>

        {/* Demoted from a card to a line. Nothing here is a decision: the zone
            is read off the device and sent whichever button is pressed. It is
            on screen because a user should never find out afterwards which
            clock their streaks were filed under. */}
        <Text style={[type.caption, { color: colors.muted }]}>
          {zone
            ? `Your days follow this device's clock, ${zone}, so a late evening meal counts for that evening.`
            : 'This device did not report a timezone, so your days follow the default clock. You can set it on the Profile tab.'}
        </Text>

        {problem ? <Text style={[type.caption, { color: colors.danger }]}>{problem}</Text> : null}
        {updateProfile.isError ? (
          <Text style={[type.caption, { color: colors.danger }]}>
            {describeError(updateProfile.error)}
          </Text>
        ) : null}

        <View style={{ gap: spacing.md }}>
          {/* Never disabled to hide it. An out of range number is caught on
              press and answered in words above these buttons. */}
          <Button
            label="Start logging"
            size="lg"
            full
            loading={updateProfile.isPending}
            onPress={() => finish(true)}
          />
          <Button
            label="Skip for now"
            variant="secondary"
            size="lg"
            full
            disabled={updateProfile.isPending}
            // Skipping still saves the detected timezone, because that is the
            // part they cannot easily repair later and it needs no decision
            // from them anyway.
            onPress={() => finish(false)}
          />
        </View>
      </View>
    </Screen>
  );
}
