import { useRouter } from 'expo-router';
import { RefreshControl, Text, View } from 'react-native';

import { Button, Card, ErrorState, Loading, SampleBadge, Screen, SectionLabel } from '../../components/ui';
import { useStreaks } from '../../hooks/useInsights';
import { describeError } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useTheme } from '../../theme';

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

export default function StreaksScreen() {
  const { colors, spacing, type } = useTheme();
  const router = useRouter();
  const streaks = useStreaks();
  const data = streaks.data;

  const current = data?.current_streak ?? 0;
  const longest = data?.longest_streak ?? 0;

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

      {data ? (
        <>
          <Card>
            <View style={{ gap: spacing.xs }}>
              <SectionLabel right={<SampleBadge source={data._source} />}>Current streak</SectionLabel>
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
                <SectionLabel>Longest</SectionLabel>
                <Text style={[type.displaySm, { color: colors.text }]}>{longest}</Text>
                <Text style={[type.caption, { color: colors.muted }]}>personal best</Text>
              </View>
            </Card>
            <Card alt style={{ flex: 1 }}>
              <View style={{ gap: spacing.xs }}>
                <SectionLabel>Last slip</SectionLabel>
                <Text style={[type.subtitle, { color: colors.text }]} numberOfLines={1}>
                  {data.last_junk_date ? formatDate(data.last_junk_date) : 'None yet'}
                </Text>
                <Text style={[type.caption, { color: colors.muted }]}>no big deal</Text>
              </View>
            </Card>
          </View>

          <Card>
            <View style={{ gap: spacing.md }}>
              <SectionLabel>How it is going</SectionLabel>
              <Text style={[type.body, { color: colors.text }]}>{supportiveCopy(current, longest)}</Text>
              {data.message ? (
                <Text style={[type.caption, { color: colors.muted }]}>{data.message}</Text>
              ) : null}
            </View>
          </Card>

          <Button label="Log a meal" size="lg" full onPress={() => router.navigate('/log')} />
        </>
      ) : null}
    </Screen>
  );
}
