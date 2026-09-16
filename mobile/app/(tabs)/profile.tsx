import Constants from 'expo-constants';
import { Text, View } from 'react-native';

import { Button, Card, Chip, ErrorState, Loading, Screen, SectionLabel } from '../../components/ui';
import { useAuth, useMe } from '../../hooks/useAuth';
import { useUpdateProfile } from '../../hooks/useProfile';
import { useReminders } from '../../hooks/useReminders';
import { describeError } from '../../lib/api';
import { GOAL_BLURBS, GOAL_LABELS, formatDate } from '../../lib/format';
import { GOALS, type Goal } from '../../lib/types';
import { useTheme } from '../../theme';

function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

function Row({ label, value }: { label: string; value: string }) {
  const { colors, spacing, type } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[type.label, { color: colors.muted }]}>{label}</Text>
      <Text style={[type.subtitle, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { colors, spacing, type } = useTheme();
  const { signOut } = useAuth();
  const me = useMe();
  const updateProfile = useUpdateProfile();
  const reminders = useReminders();

  const user = me.data;
  const goal = user?.goal ?? null;
  const localZone = deviceTimezone();
  const zoneMismatch = Boolean(localZone && user && user.timezone !== localZone);
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  const setGoal = (next: Goal) => {
    if (next === goal || updateProfile.isPending) return;
    updateProfile.mutate({ goal: next });
  };

  return (
    <Screen title="Profile" eyebrow="Your account">
      {me.isLoading ? <Loading label="Loading your profile" /> : null}

      {me.isError && !user ? (
        <ErrorState
          title="Profile unavailable"
          message={describeError(me.error)}
          onRetry={() => void me.refetch()}
        />
      ) : null}

      {user ? (
        <>
          <Card>
            <View style={{ gap: spacing.lg }}>
              <Row label="Signed in as" value={user.email} />
              <Row label="Timezone" value={user.timezone ?? 'Not set'} />
              <Row label="Member since" value={formatDate(user.created_at) || 'Today'} />
            </View>
          </Card>

          <Card>
            <View style={{ gap: spacing.lg }}>
              <SectionLabel>Goal</SectionLabel>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {GOALS.map((option) => (
                  <Chip
                    key={option}
                    label={GOAL_LABELS[option]}
                    selected={goal === option}
                    disabled={updateProfile.isPending}
                    onPress={() => setGoal(option)}
                    style={{ flex: 1, alignItems: 'center' }}
                  />
                ))}
              </View>
              <Text style={[type.caption, { color: colors.muted }]}>
                {goal ? GOAL_BLURBS[goal] : 'Pick a goal and the meal plans will follow it.'}
              </Text>
              {updateProfile.isError ? (
                <Text style={[type.caption, { color: colors.danger }]}>
                  {describeError(updateProfile.error)}
                </Text>
              ) : null}
            </View>
          </Card>

          <Card>
            <View style={{ gap: spacing.md }}>
              <SectionLabel>Reminders</SectionLabel>
              <Text style={[type.caption, { color: colors.muted }]}>
                {reminders.enabled
                  ? 'On. A nudge if you go quiet, and an evening reminder while a streak is running.'
                  : 'Off. Turn them on for a nudge when you go quiet and a heads up before a streak breaks.'}
              </Text>
              <Button
                label={reminders.enabled ? 'Turn reminders off' : 'Turn reminders on'}
                variant="secondary"
                onPress={() => {
                  void (reminders.enabled ? reminders.disable() : reminders.enable());
                }}
              />
              {reminders.enabled === false ? (
                <Text style={[type.caption, { color: colors.muted }]}>
                  If nothing happens, notifications are blocked for Forkast in your
                  device settings.
                </Text>
              ) : null}
            </View>
          </Card>

          {zoneMismatch && localZone ? (
            <Card alt>
              <View style={{ gap: spacing.md }}>
                <SectionLabel>Timezone</SectionLabel>
                <Text style={[type.caption, { color: colors.muted }]}>
                  This device reports {localZone}. Matching it keeps your streaks lined up with your days.
                </Text>
                <Button
                  label="Use this device"
                  variant="secondary"
                  loading={updateProfile.isPending}
                  onPress={() => updateProfile.mutate({ timezone: localZone })}
                />
              </View>
            </Card>
          ) : null}
        </>
      ) : null}

      {/* Centred at its natural width rather than stretched across the screen.
          Signing out is a rare, destructive action, and a full bleed bar gave
          it more weight than anything else on a tab that has no primary
          action at all. */}
      <Button
        label="Sign out"
        icon="signOut"
        variant="danger"
        size="lg"
        align="center"
        onPress={() => void signOut()}
      />

      <Text style={[type.labelSoft, { color: colors.muted, textAlign: 'center' }]}>
        Forkast {appVersion}
      </Text>
    </Screen>
  );
}
