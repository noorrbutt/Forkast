import { useRouter } from 'expo-router';
import { RefreshControl, Text, View } from 'react-native';

import { CalorieBars } from '../../components/CalorieBars';
import {
  Card,
  Empty,
  ErrorState,
  Loading,
  Screen,
  SectionLabel,
  StatTile,
} from '../../components/ui';
import { useDashboard } from '../../hooks/useInsights';
import { describeError } from '../../lib/api';
import { formatMinutes, formatNumber, formatRatio, labelOf } from '../../lib/format';
import { Appear } from '../../components/ui/Appear';
import { BurnCard } from '../../components/BurnCard';
import { CountUp } from '../../components/ui/CountUp';
import { useTheme } from '../../theme';

export default function DashboardScreen() {
  const { colors, radius, spacing, type } = useTheme();
  const router = useRouter();
  const dashboard = useDashboard();

  const data = dashboard.data;

  const burn = data?.burn_equivalents ?? null;
  const burnRows = burn
    ? [
        { label: 'Walk', value: formatMinutes(burn.walking_minutes) },
        { label: 'Run', value: formatMinutes(burn.running_minutes) },
        { label: 'Cycle', value: formatMinutes(burn.cycling_minutes) },
      ]
    : [];

  return (
    <Screen
      scroll
      refreshControl={
        <RefreshControl
          refreshing={dashboard.isRefetching}
          onRefresh={() => void dashboard.refetch()}
          tintColor={colors.accent}
        />
      }
    >
      <View style={{ gap: spacing.xs, paddingTop: spacing.lg }}>
        <SectionLabel>Forkast</SectionLabel>
        <Text style={[type.title, { color: colors.text }]}>Your week, plated.</Text>
      </View>

      {dashboard.isLoading ? <Loading label="Reading your week" /> : null}

      {dashboard.isError && !data ? (
        <ErrorState
          title="Dashboard unavailable"
          message={describeError(dashboard.error)}
          onRetry={() => void dashboard.refetch()}
        />
      ) : null}

      {data ? (
        <>
          <Appear index={0}>
            <Card>
              <View style={{ gap: spacing.xs }}>
                <SectionLabel>{data.total_burned > 0 ? 'Net calories' : 'Total calories'}</SectionLabel>
                <CountUp
                  value={data.total_burned > 0 ? data.net_calories : data.total_calories}
                  style={[type.display, { color: colors.text }]}
                />
                <Text style={[type.caption, { color: colors.muted }]}>
                  {data.total_burned > 0
                    ? `${formatNumber(data.total_calories)} eaten, ${formatNumber(data.total_burned)} burned.`
                    : `Across ${formatNumber(data.logs_count)} logged ${data.logs_count === 1 ? 'meal' : 'meals'}.`}
                </Text>
              </View>
            </Card>
          </Appear>

          <Appear index={1} style={{ flexDirection: 'row', gap: spacing.md }}>
            <StatTile
              label="Junk ratio"
              value={formatRatio(data.junk_ratio)}
              hint="of your meals"
              tone={(data.junk_ratio ?? 0) > 0.5 ? 'danger' : 'success'}
            />
            {data.total_burned > 0 ? (
              <StatTile
                label="Burned"
                value={formatNumber(data.total_burned)}
                hint="kcal, by you"
                tone="success"
              />
            ) : (
              <StatTile label="Meals logged" value={formatNumber(data.logs_count)} hint="this period" />
            )}
          </Appear>

          <Appear index={2} style={{ flexDirection: 'row', gap: spacing.md }}>
            <StatTile label="Top category" value={labelOf(data.top_category, 'None yet')} tone="accent" />
            <StatTile label="Top spot" value={labelOf(data.top_restaurant, 'None yet')} />
          </Appear>

          <Appear index={3}>
            <BurnCard />
          </Appear>

          <Appear index={4}>
            <Card>
              <View style={{ gap: spacing.lg }}>
                <SectionLabel>Calories by day</SectionLabel>
                <CalorieBars data={data.calories_by_day ?? []} />
              </View>
            </Card>
          </Appear>

          {burnRows.length > 0 ? (
            <Card>
              <View style={{ gap: spacing.lg }}>
                <SectionLabel>How long it would take</SectionLabel>
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  {burnRows.map((row) => (
                    <View
                      key={row.label}
                      style={{
                        flex: 1,
                        alignItems: 'center',
                        gap: spacing.xs,
                        paddingVertical: spacing.md,
                        borderRadius: radius.tile,
                        backgroundColor: colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: colors.border,
                      }}
                    >
                      <Text style={[type.numeral, { color: colors.text }]} adjustsFontSizeToFit numberOfLines={1}>
                        {row.value}
                      </Text>
                      <Text style={[type.label, { color: colors.muted }]}>{row.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </Card>
          ) : null}

          <Card>
            <View style={{ gap: spacing.lg }}>
              <SectionLabel>Most fun meals</SectionLabel>
              {(data.best_fun_meals ?? []).length === 0 ? (
                <Empty
                  emoji="🎉"
                  title="Nothing rated yet"
                  message="Rate the fun of a meal when you log it and the best ones land here."
                />
              ) : (
                <View style={{ gap: spacing.md }}>
                  {(data.best_fun_meals ?? []).slice(0, 4).map((meal, index) => (
                    <View
                      key={`${meal.dish_name}-${index}`}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[type.subtitle, { color: colors.text }]} numberOfLines={1}>
                          {meal.dish_name}
                        </Text>
                        <Text style={[type.caption, { color: colors.muted }]} numberOfLines={1}>
                          {meal.restaurant_name ?? 'Home cooked'}
                        </Text>
                      </View>
                      <Text style={[type.subtitle, { color: colors.accent }]}>
                        {`${meal.fun_scale}/5`}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </Card>
        </>
      ) : null}

      <View style={{ gap: spacing.md }}>
        <Card onPress={() => router.push('/history')}>
          <View style={{ gap: spacing.xs }}>
            <SectionLabel>Everything you logged</SectionLabel>
            <Text style={[type.title, { color: colors.text }]}>Your diary</Text>
            <Text style={[type.caption, { color: colors.muted }]}>
              Browse past meals, fix a typo, or delete one you logged twice.
            </Text>
          </View>
        </Card>

        <Card onPress={() => router.push('/map')}>
          <View style={{ gap: spacing.xs }}>
            <SectionLabel>Where you eat</SectionLabel>
            <Text style={[type.title, { color: colors.text }]}>Map</Text>
            <Text style={[type.caption, { color: colors.muted }]}>
              Your spots grouped by area, with how often each one shows up.
            </Text>
          </View>
        </Card>

        <Card onPress={() => router.push('/plan')}>
          <View style={{ gap: spacing.xs }}>
            <SectionLabel>Ask Forkast</SectionLabel>
            <Text style={[type.title, { color: colors.text }]}>AI meal plan</Text>
            <Text style={[type.caption, { color: colors.muted }]}>
              A week of suggestions shaped around your goal.
            </Text>
          </View>
        </Card>
      </View>
    </Screen>
  );
}
