import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Chip, Field, FormError, Screen } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useUpdateProfile } from '../hooks/useProfile';
import { describeError } from '../lib/api';
import { GOAL_BLURBS, GOAL_LABELS, MAX_TARGET, MIN_TARGET, formatNumber, suggestedTarget } from '../lib/format';
import { deviceTimezone } from '../lib/deviceTimezone';
import { GOALS, type Goal } from '../lib/types';
import { useTheme } from '../theme';

/** Matches ck_users_calorie_target_plausible, so a typo is caught before a round trip. */

/** The goal this screen opens on, and therefore the target it opens with. */
const FIRST_GOAL: Goal = 'maintain';


/**
 * The one time setup, shown once immediately after an account is created.
 *
 * It leads with the question "What are you after?" at `display` over the
 * three answers. Not `hero`: Hero holds its text to one line so it can never
 * truncate, and this question wraps to two lines on a phone. `display` wraps,
 * and with nothing else on the screen above 16 it is dominant without it.
 *
 * It still asks for the two things that are expensive to get wrong and free to
 * get right at the start. Timezone decides which calendar day every meal and
 * every streak is filed under, and a day cannot be re-bucketed after the fact,
 * so a user who never opens Profile would quietly accumulate a run of wrong
 * days. The goal proposes the daily target, which is the number the dashboard
 * reports every day against, and then leaves that number alone for the user
 * to set.
 *
 * The timezone is a caption line rather than a control: it is detected from
 * the device and sent whether the user finishes or skips, so there is nothing
 * to decide. The target field sits in the same group as the goal that
 * proposes it. There are no cards; space does the grouping -- 8 inside a
 * question, 16 between questions in a group, 24 between groups.
 *
 * Everything here is skippable. Nothing on this screen is worth blocking
 * someone from logging their first meal.
 */
export default function SetupScreen() {
  const { colors, layout, spacing, type } = useTheme();
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
          maxWidth: layout.formWidth,
          alignSelf: 'center',
          gap: spacing.xl,
          paddingTop: spacing.lg,
        }}
      >
        {/* The question, and the only element on the screen above 16. */}
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

        {problem ? <FormError>{problem}</FormError> : null}
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
