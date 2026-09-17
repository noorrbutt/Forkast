import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Card, Chip, Field, Icon, Screen, SectionLabel } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useUpdateProfile } from '../hooks/useProfile';
import { describeError } from '../lib/api';
import { GOAL_BLURBS, GOAL_LABELS, formatNumber } from '../lib/format';
import { GOALS, type Goal } from '../lib/types';
import { useTheme } from '../theme';

/** Matches ck_users_calorie_target_plausible, so a typo is caught before a round trip. */
const MIN_TARGET = 800;
const MAX_TARGET = 10_000;

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
 * It asks for the two things that are expensive to get wrong and free to get
 * right at the start. Timezone decides which calendar day every meal and every
 * streak is filed under, and a day cannot be re-bucketed after the fact, so a
 * user who never opens Profile would quietly accumulate a run of wrong days.
 * The goal was previously a label that measured nothing; paired with a target
 * it becomes the number the dashboard reports against.
 *
 * Everything here is skippable. Nothing on this screen is worth blocking
 * someone from logging their first meal.
 */
export default function SetupScreen() {
  const { colors, spacing, type } = useTheme();
  const { completeSetup } = useAuth();
  const updateProfile = useUpdateProfile();

  const zone = deviceTimezone();
  const [goal, setGoal] = useState<Goal>('maintain');
  const [target, setTarget] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const trimmed = target.trim();
  const parsed = Number(trimmed);
  const targetGiven = trimmed.length > 0;
  const targetValid =
    !targetGiven ||
    (Number.isInteger(parsed) && parsed >= MIN_TARGET && parsed <= MAX_TARGET);

  const finish = (withTarget: boolean) => {
    if (updateProfile.isPending) return;
    if (withTarget && !targetValid) {
      setProblem(
        `A daily target is between ${formatNumber(MIN_TARGET)} and ${formatNumber(MAX_TARGET)} kcal.`,
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
        // Setup is a convenience, not a gate. If the network is down the account
        // already exists, so let them in and leave the Profile tab to fix it.
        onSuccess: completeSetup,
        onError: () => undefined,
      },
    );
  };

  return (
    <Screen scroll bottomInset={spacing.xxl}>
      <View style={{ gap: spacing.xl, paddingTop: spacing.lg }}>
        <View style={{ gap: spacing.sm }}>
          <Text style={[type.label, { color: colors.accent }]}>One quick thing</Text>
          <Text style={[type.display, { color: colors.text }]}>Set{'\n'}your pace.</Text>
          <Text style={[type.body, { color: colors.muted }]}>
            Two answers now so your days and your numbers line up from the start.
          </Text>
        </View>

        <Card>
          <View style={{ gap: spacing.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Icon name="clock" size={18} />
              <SectionLabel>Your days</SectionLabel>
            </View>
            <Text style={[type.caption, { color: colors.muted }]}>
              {zone
                ? `This device says ${zone}. Streaks and daily totals will follow that clock, so a late evening meal counts for that evening.`
                : 'This device did not report a timezone, so we will keep the default. You can set it on the Profile tab.'}
            </Text>
          </View>
        </Card>

        <Card>
          <View style={{ gap: spacing.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Icon name="trophy" size={18} />
              <SectionLabel>What are you after</SectionLabel>
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
              {GOALS.map((option) => (
                <Chip
                  key={option}
                  label={GOAL_LABELS[option]}
                  selected={goal === option}
                  onPress={() => setGoal(option)}
                />
              ))}
            </View>
            <Text style={[type.caption, { color: colors.muted }]}>{GOAL_BLURBS[goal]}</Text>
          </View>
        </Card>

        <Card>
          <View style={{ gap: spacing.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Icon name="chart" size={18} />
              <SectionLabel>Daily target</SectionLabel>
            </View>
            <Field
              label="Calories per day"
              value={target}
              onChangeText={(next) => {
                setProblem(null);
                setTarget(next.replace(/[^0-9]/g, ''));
              }}
              placeholder="e.g. 2000"
              keyboardType="number-pad"
              maxLength={5}
              editable={!updateProfile.isPending}
              hint="Optional. The dashboard will show each day against this."
            />
          </View>
        </Card>

        {problem ? <Text style={[type.caption, { color: colors.danger }]}>{problem}</Text> : null}
        {updateProfile.isError ? (
          <Text style={[type.caption, { color: colors.danger }]}>
            {describeError(updateProfile.error)}
          </Text>
        ) : null}

        <View style={{ gap: spacing.md }}>
          <Button
            label="Start logging"
            icon="check"
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
