import { useRouter } from 'expo-router';
import { RefreshControl, Text, View } from 'react-native';

import {
  Button,
  Card,
  Empty,
  ErrorState,
  Icon,
  Loading,
  Screen,
  SectionLabel,
  type IconName,
} from '../../components/ui';
import { useStreaks } from '../../hooks/useInsights';
import { describeError } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useTheme } from '../../theme';

/** The three numbers this screen keeps, spelled out while there are none. */
const PREVIEW: { icon: IconName; title: string; caption: string }[] = [
  {
    icon: 'streaks',
    title: 'Current streak',
    caption: 'Days in a row where nothing you logged counted as junk.',
  },
  {
    icon: 'trophy',
    title: 'Longest',
    caption: 'Your best run so far. A slip never takes it away.',
  },
  {
    icon: 'history',
    title: 'Last slip',
    caption: 'The last day something junk went on the board.',
  },
];

/** Encouraging on every branch. A streak at zero is a starting line, not a failure. */
function supportiveCopy(current: number, longest: number): string {
  if (current === 0 && longest === 0) {
    return 'Nothing logged yet. One meal is all it takes to put the first day on the board.';
  }
  if (current === 0) {
    return `You have held ${longest} clean ${longest === 1 ? 'day' : 'days'} before, so you already know how. Today is day one again.`;
  }
  if (current < longest) {
    return `Nicely on the way back. ${longest - current} more to match your best run.`;
  }
  if (current === longest) {
    return 'This is your best run so far. Keep it rolling.';
  }
  return 'New personal best. Genuinely, that is hard to do.';
}

/**
 * A section label with its icon.
 *
 * Kept here rather than folded into SectionLabel because that component puts
 * its children straight into a Text, and an icon riding inside a line box of
 * fifteen pixels clips on Android.
 */
function IconLabel({ icon, children }: { icon: IconName; children: string }) {
  const { spacing } = useTheme();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Icon name={icon} size={14} />
      <SectionLabel>{children}</SectionLabel>
    </View>
  );
}

export default function StreaksScreen() {
  const { colors, spacing, type } = useTheme();
  const router = useRouter();
  const streaks = useStreaks();
  const data = streaks.data;

  const current = data?.current_streak ?? 0;
  const longest = data?.longest_streak ?? 0;
  // Three zeros and no slip on record means nothing has ever been logged, which
  // is a different thing from a run that has just been broken.
  const started = Boolean(data && (current > 0 || longest > 0 || data.last_junk_date));

  return (
    <Screen
      title="Streaks"
      eyebrow="Keep it going"
      refreshControl={
        <RefreshControl
          refreshing={streaks.isRefetching}
          onRefresh={() => void streaks.refetch()}
          tintColor={colors.accent}
        />
      }
    >
      {streaks.isLoading ? <Loading label="Counting your days" /> : null}

      {streaks.isError && !data ? (
        <ErrorState
          title="Streaks unavailable"
          message={describeError(streaks.error)}
          onRetry={() => void streaks.refetch()}
        />
      ) : null}

      {data && !started ? (
        <>
          <Empty
            icon="streaks"
            title="Day one is one meal away"
            message="A streak counts the days in a row where nothing you logged was junk. Nothing is on the board yet, so nothing has been broken either."
            actionLabel="Log a meal"
            actionIcon="log"
            onAction={() => router.navigate('/log')}
          />

          <Card>
            <View style={{ gap: spacing.lg }}>
              <IconLabel icon="chart">What you will see</IconLabel>
              {PREVIEW.map((row) => (
                <View
                  key={row.title}
                  style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}
                >
                  <Icon name={row.icon} size={18} />
                  <View style={{ flex: 1, gap: spacing.xs }}>
                    <Text style={[type.subtitle, { color: colors.text }]}>{row.title}</Text>
                    <Text style={[type.caption, { color: colors.muted }]}>{row.caption}</Text>
                  </View>
                </View>
              ))}
            </View>
          </Card>
        </>
      ) : null}

      {data && started ? (
        <>
          <Card>
            <View style={{ gap: spacing.xs }}>
              <IconLabel icon="streaks">Current streak</IconLabel>
              <Text style={[type.display, { color: current > 0 ? colors.accent : colors.text }]}>
                {current}
              </Text>
              <Text style={[type.caption, { color: colors.muted }]}>
                {current === 1 ? 'day without junk' : 'days without junk'}
              </Text>
            </View>
          </Card>

          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Card alt style={{ flex: 1 }}>
              <View style={{ gap: spacing.xs }}>
                <IconLabel icon="trophy">Longest</IconLabel>
                <Text style={[type.displaySm, { color: colors.text }]}>{longest}</Text>
                <Text style={[type.caption, { color: colors.muted }]}>personal best</Text>
              </View>
            </Card>
            <Card alt style={{ flex: 1 }}>
              <View style={{ gap: spacing.xs }}>
                <IconLabel icon="history">Last slip</IconLabel>
                <Text style={[type.subtitle, { color: colors.text }]} numberOfLines={1}>
                  {data.last_junk_date ? formatDate(data.last_junk_date) : 'None yet'}
                </Text>
                <Text style={[type.caption, { color: colors.muted }]}>no big deal</Text>
              </View>
            </Card>
          </View>

          <Card>
            <View style={{ gap: spacing.md }}>
              <IconLabel icon="chart">How it is going</IconLabel>
              <Text style={[type.body, { color: colors.text }]}>{supportiveCopy(current, longest)}</Text>
              {data.message ? (
                <Text style={[type.caption, { color: colors.muted }]}>{data.message}</Text>
              ) : null}
            </View>
          </Card>

          <Button label="Log a meal" icon="log" size="lg" full onPress={() => router.navigate('/log')} />
        </>
      ) : null}
    </Screen>
  );
}
