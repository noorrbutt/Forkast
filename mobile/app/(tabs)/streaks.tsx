import { useRouter } from 'expo-router';
import { RefreshControl, Text, View } from 'react-native';

import { Button, Card, ErrorState, Hero, Loading, Screen } from '../../components/ui';
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

/**
 * The one thing: the current streak, as a single figure in days.
 *
 * This screen answers one question, how long is the run, so it leads with the
 * answer and nothing else competes with it. Everything that was a card of its
 * own before is either supporting detail under the figure or gone.
 *
 * Before there is any run at all, the figure would be a zero, and a zero is a
 * measurement of nothing rather than an answer: nothing has been broken because
 * nothing has started. So an untouched account leads with the day it is about
 * to begin instead, which is the same shape of composition carrying an
 * invitation rather than a verdict. Once anything is on the board the figure is
 * the truth again, including a zero after a slip, because that is a real
 * reading of a real run and the line under it does the encouraging.
 */
export default function StreaksScreen() {
  const { colors, layout, spacing, type } = useTheme();
  const router = useRouter();
  const streaks = useStreaks();
  const data = streaks.data;

  const current = data?.current_streak ?? 0;
  const longest = data?.longest_streak ?? 0;
  // Three zeros and no slip on record means nothing has ever been logged, which
  // is a different thing from a run that has just been broken.
  const started = Boolean(data && (current > 0 || longest > 0 || data.last_junk_date));

  // The column below already puts lg between its children, so xxl on each side
  // of the hero lands its surrounding space on xxxl, which nothing else on the
  // screen is allowed to have.
  const heroSpace = { paddingTop: spacing.xxl, paddingBottom: spacing.xxl };

  /** One capped, centred column, carrying the gap the scroll used to apply. */
  const column = {
    width: '100%' as const,
    maxWidth: layout.contentWidth,
    alignSelf: 'center' as const,
    gap: spacing.lg,
  };

  return (
    <Screen
      title="Streaks"
      refreshControl={
        <RefreshControl
          refreshing={streaks.isRefetching}
          onRefresh={() => void streaks.refetch()}
          tintColor={colors.accent}
        />
      }
    >
      <View style={column}>
        {/* isPending rather than isLoading, because the query is disabled until
            the stored token has been read back from the keystore and a disabled
            query is not "loading". Reading it that way left the first paint of a
            cold start blank rather than showing a state anyone designed. */}
        {streaks.isPending ? <Loading label="Counting your days" /> : null}

        {streaks.isError && !data ? (
          <ErrorState
            title="Streaks unavailable"
            message={describeError(streaks.error)}
            onRetry={() => void streaks.refetch()}
          />
        ) : null}

        {data && !started ? (
          <>
            <View style={heroSpace}>
              <Hero
                value="Day one"
                caption="A streak counts the days in a row where nothing you log is junk."
              />
            </View>

            <Text style={[type.caption, { color: colors.muted }]}>
              Nothing is on the board yet, so nothing has been broken either.
            </Text>

            <Button label="Log a meal" icon="log" size="lg" full onPress={() => router.navigate('/log')} />
          </>
        ) : null}

        {data && started ? (
          <>
            <View style={heroSpace}>
              <Hero
                value={String(current)}
                caption={current === 1 ? 'day without junk' : 'days without junk'}
                /**
                 * Sage while the run is live, ink once it is broken.
                 *
                 * It used to be saffron, which is wrong twice over: saffron is the
                 * one action colour and a figure wearing it looks tappable, and
                 * the palette's own note on sage names "a live streak" as the
                 * example of what it is for. The same fact was being drawn in two
                 * colours depending on which file you were in.
                 *
                 * Zero stays ink, so it reads as a reading rather than as a thing
                 * to celebrate. The number still carries the meaning on its own.
                 */
                color={current > 0 ? colors.success : colors.text}
              />
            </View>

            {/* The record, which is reference rather than the answer, so it sits
                two full steps of the scale below the figure above it. The two
                values share a right edge so they read as one column. */}
            <Card>
              <View style={{ gap: spacing.lg }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.lg }}>
                  <Text style={[type.body, { color: colors.muted, flex: 1 }]}>Longest run</Text>
                  <Text style={[type.displaySm, { color: colors.text }]}>{longest}</Text>
                </View>

                <View style={{ height: layout.hairline, backgroundColor: colors.border }} />

                {/* The dish under the date. A date on its own says a run ended
                    and leaves the reader to remember which meal did it, which
                    is the only part of this row they can act on. */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.lg }}>
                  <View style={{ flex: 1, gap: spacing.xs }}>
                    <Text style={[type.body, { color: colors.muted }]}>Last slip</Text>
                    {data.last_junk_date && data.last_junk_dish ? (
                      <Text style={[type.caption, { color: colors.muted }]}>
                        {data.last_junk_dish}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[type.subtitle, { color: colors.text }]}>
                    {data.last_junk_date ? formatDate(data.last_junk_date) : 'None yet'}
                  </Text>
                </View>
              </View>
            </Card>

            <View style={{ gap: spacing.sm }}>
              <Text style={[type.body, { color: colors.text }]}>{supportiveCopy(current, longest)}</Text>
              {data.message ? (
                <Text style={[type.caption, { color: colors.muted }]}>{data.message}</Text>
              ) : null}
            </View>

            <Button label="Log a meal" icon="log" size="lg" full onPress={() => router.navigate('/log')} />
          </>
        ) : null}
      </View>
    </Screen>
  );
}
