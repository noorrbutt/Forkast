import { Text, View } from 'react-native';

import { Button, Card } from '../ui';
import { formatNumber } from '../../lib/format';
import { useTheme } from '../../theme';
import { planSummary, type NextStep } from './nextStep';
import { SLOT_LABELS, type Slot } from './todayMeals';

/**
 * The one "next" card under the Today strip.
 *
 * A single card whose words change with the day (see nextStep.ts for how the
 * state is chosen), rather than a list of every way onward. Over target is a
 * note, not a warning: no danger colour, nothing to press, because there is
 * nothing to fix tonight and a red card would only punish.
 */
export function NextCard({
  step,
  onLogSlot,
  onOpenPlan,
}: {
  step: NextStep;
  onLogSlot: (slot: Slot) => void;
  onOpenPlan: () => void;
}) {
  const { colors, spacing, type } = useTheme();

  const copy = (() => {
    switch (step.kind) {
      case 'over':
        return {
          eyebrow: null,
          title: `${formatNumber(step.by)} kcal over today`,
          body: 'One day does not make a trend. Tomorrow starts at your full target again.',
          action: null,
        };
      case 'log':
        return {
          eyebrow: null,
          title: 'Nothing logged yet today',
          body: 'A quick entry now keeps the number above honest.',
          action: {
            label: `Log ${SLOT_LABELS[step.slot].toLowerCase()}`,
            primary: true,
            onPress: () => onLogSlot(step.slot),
          },
        };
      case 'plan': {
        const { eyebrow, dish, note } = planSummary(step);
        return {
          eyebrow,
          title: dish,
          body: note,
          action: { label: 'See the plan', primary: false, onPress: onOpenPlan },
        };
      }
      case 'plan-done':
        return {
          eyebrow: null,
          title: "Today's plan",
          body: 'Nothing left on it for the rest of today.',
          action: { label: 'See the plan', primary: false, onPress: onOpenPlan },
        };
      case 'make-plan':
        return {
          eyebrow: null,
          title: step.expired ? 'Your plan has run its three days' : 'A plan for your goal',
          // Three, because that is what the plan prompt asks for and what the
          // plan screen draws.
          body: 'Three days of meals shaped around your goal.',
          action: {
            label: step.expired ? 'Make a new plan' : 'Make a meal plan',
            primary: false,
            onPress: onOpenPlan,
          },
        };
    }
  })();

  return (
    <Card>
      <View testID={`next-card-${step.kind}`} style={{ gap: spacing.md }}>
        <View style={{ gap: spacing.xs }}>
          {copy.eyebrow ? (
            <Text style={[type.labelSoft, { color: colors.muted }]}>{copy.eyebrow}</Text>
          ) : null}
          <Text style={[type.subtitle, { color: colors.text }]}>{copy.title}</Text>
          {copy.body ? (
            <Text style={[step.kind === 'plan' ? type.caption : type.body, { color: colors.muted }]}>
              {copy.body}
            </Text>
          ) : null}
        </View>
        {copy.action ? (
          <View style={{ alignSelf: 'flex-start', paddingTop: spacing.xs }}>
            <Button
              label={copy.action.label}
              variant={copy.action.primary ? 'primary' : 'secondary'}
              onPress={copy.action.onPress}
            />
          </View>
        ) : null}
      </View>
    </Card>
  );
}
