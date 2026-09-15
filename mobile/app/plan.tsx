import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Card, Chip, Empty, ErrorState, Loading, Screen, SectionLabel } from '../components/ui';
import { useMe } from '../hooks/useAuth';
import { useGeneratePlan, usePlans } from '../hooks/usePlans';
import { describeError } from '../lib/api';
import { GOAL_BLURBS, GOAL_LABELS, formatDate, formatNumber, titleCase } from '../lib/format';
import { GOALS, type Goal, type Plan } from '../lib/types';
import { useTheme } from '../theme';

export default function PlanRoute() {
  const { colors, radius, spacing, type } = useTheme();
  const router = useRouter();
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

  return (
    <Screen title="AI meal plan" eyebrow="Ask Forkast" onBack={() => router.back()} bottomInset={48}>
      <Card>
        <View style={{ gap: spacing.lg }}>
          <SectionLabel>Goal</SectionLabel>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {GOALS.map((option) => (
              <Chip
                key={option}
                label={GOAL_LABELS[option]}
                selected={goal === option}
                onPress={() => setPicked(option)}
                style={{ flex: 1, alignItems: 'center' }}
              />
            ))}
          </View>
          <Text style={[type.caption, { color: colors.muted }]}>{GOAL_BLURBS[goal]}</Text>
          <Button
            label={generate.isPending ? 'Thinking' : 'Generate a plan'}
            size="lg"
            full
            loading={generate.isPending}
            onPress={() => generate.mutate(goal)}
          />
          {generate.isError ? (
            <Text style={[type.caption, { color: colors.danger }]}>{describeError(generate.error)}</Text>
          ) : null}
        </View>
      </Card>

      {plans.isLoading && !plan ? <Loading label="Looking for past plans" /> : null}

      {plans.isError && !plan && !generate.isError ? (
        <ErrorState
          title="Plans unavailable"
          message={describeError(plans.error)}
          onRetry={() => void plans.refetch()}
        />
      ) : null}

      {!plan && !plans.isLoading && !plans.isError ? (
        <Empty
          emoji="🧠"
          title="No plan yet"
          message="Pick a goal and generate one. It takes a moment and you can regenerate any time."
        />
      ) : null}

      {plan && generated ? (
        <>
          <Card>
            <View style={{ gap: spacing.xs }}>
              <SectionLabel>Summary</SectionLabel>
              <Text style={[type.body, { color: colors.text }]}>
                {generated.summary || 'A week shaped around your goal.'}
              </Text>
              <Text style={[type.caption, { color: colors.muted }]}>
                {GOAL_LABELS[plan.goal] ?? titleCase(String(plan.goal))} plan
                {plan.created_at ? `, made ${formatDate(plan.created_at)}` : ''}.
              </Text>
            </View>
          </Card>

          {days.map((day, dayIndex) => (
            <Card key={`${day.day}-${dayIndex}`}>
              <View style={{ gap: spacing.lg }}>
                <SectionLabel>{day.day}</SectionLabel>
                <View style={{ gap: spacing.md }}>
                  {(day.meals ?? []).map((meal, mealIndex) => (
                    <View
                      key={`${meal.slot}-${mealIndex}`}
                      style={{
                        gap: spacing.xs,
                        padding: spacing.lg,
                        borderRadius: radius.sheet,
                        backgroundColor: colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: colors.border,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: spacing.md,
                        }}
                      >
                        <Text style={[type.label, { color: colors.muted }]}>{titleCase(meal.slot)}</Text>
                        <Text style={[type.label, { color: colors.accent }]}>
                          {formatNumber(meal.approx_calories)} kcal
                        </Text>
                      </View>
                      <Text style={[type.body, { color: colors.text }]}>{meal.suggestion}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </Card>
          ))}

          {nudges.length > 0 ? (
            <Card>
              <View style={{ gap: spacing.md }}>
                <SectionLabel>Nudges</SectionLabel>
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
                        marginTop: 8,
                      }}
                    />
                    <Text style={[type.body, { color: colors.text, flex: 1 }]}>{nudge}</Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
