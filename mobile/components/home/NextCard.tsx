import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  const { colors, spacing, type } = useTheme();

  const copy = (() => {
    switch (step.kind) {
      case 'over':
        return {
          eyebrow: null,
          title: t('home.nextOverTitle', { amount: formatNumber(step.by) }),
          body: t('home.nextOverBody'),
          action: null,
        };
      case 'log':
        return {
          eyebrow: null,
          title: t('home.nothingLogged'),
          body: t('home.quickEntry'),
          action: {
            label: t('home.logSlot', { slot: t(`home.slots.${step.slot}`).toLowerCase() }),
            primary: true,
            onPress: () => onLogSlot(step.slot),
          },
        };
      case 'plan': {
        const { dish, note } = planSummary(step);
        const slot = Object.entries(SLOT_LABELS).find(([, label]) => label === step.slotLabel)?.[0];
        return {
          eyebrow: t('home.planEyebrow', {
            slot: slot ? t(`home.slots.${slot}`) : step.slotLabel,
            calories: formatNumber(step.meal.approx_calories),
          }),
          title: dish,
          body: note,
          action: { label: t('home.seePlan'), primary: false, onPress: onOpenPlan },
        };
      }
      case 'plan-done':
        return {
          eyebrow: null,
          title: t('home.todayPlan'),
          body: t('home.planDone'),
          action: { label: t('home.seePlan'), primary: false, onPress: onOpenPlan },
        };
      case 'make-plan':
        return {
          eyebrow: null,
          title: step.expired ? t('home.expiredPlan') : t('home.goalPlan'),
          // Three, because that is what the plan prompt asks for and what the
          // plan screen draws.
          body: t('home.threeDaysPlan'),
          action: {
            label: step.expired ? t('home.makeNewPlan') : t('home.makeMealPlan'),
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
