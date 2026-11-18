import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Chip, Screen } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useUpdateProfile } from '../hooks/useProfile';
import type { BiggestStruggle, EatingOutFrequency } from '../lib/types';
import { useTheme } from '../theme';

const FREQUENCY_OPTIONS: { value: EatingOutFrequency; label: string }[] = [
  { value: 'rarely', label: 'rarely' },
  { value: 'sometimes', label: 'sometimes' },
  { value: 'often', label: 'often' },
];

const STRUGGLE_OPTIONS: { value: BiggestStruggle; label: string }[] = [
  { value: 'cravings', label: 'cravings' },
  { value: 'portion_size', label: 'portionSizes' },
  { value: 'eating_out', label: 'eatingOut' },
  { value: 'consistency', label: 'consistency' },
  { value: 'knowledge', label: 'knowledge' },
];

/**
 * A short quiz shown once, ahead of setup, right after an account is created.
 *
 * Two questions, one per step, the same "one thing per screen" shape as the
 * rest of onboarding: a question at `display`, the answers immediately below
 * it, nothing else competing for attention. Neither question calculates
 * anything -- both are self-reported and both only ever steer the tone of
 * the AI meal plan, so unlike setup's timezone and target this genuinely has
 * no wrong answer to get right early, and skipping either one is always one
 * tap away.
 *
 * Runs before setup.tsx rather than folded into it, because a new account's
 * very first screen being an empty dashboard is the thing this exists to
 * avoid: answering two questions about how you actually eat, before the app
 * has any logs to go on, is what gives the plan generator something to say
 * from day one.
 */
export default function OnboardingScreen() {
  const { t } = useTranslation();
  const { colors, layout, spacing, type } = useTheme();
  const { completeOnboarding } = useAuth();
  const updateProfile = useUpdateProfile();

  const [step, setStep] = useState<0 | 1>(0);
  const [frequency, setFrequency] = useState<EatingOutFrequency | null>(null);
  const [struggle, setStruggle] = useState<BiggestStruggle | null>(null);

  const finish = (answers: {
    eating_out_frequency?: EatingOutFrequency;
    biggest_struggle?: BiggestStruggle;
  }) => {
    if (updateProfile.isPending) return;
    if (Object.keys(answers).length === 0) {
      completeOnboarding();
      return;
    }
    updateProfile.mutate(answers, {
      onSuccess: completeOnboarding,
      // Same reasoning as setup: this is a convenience, not a gate. An
      // account that cannot reach the server should not be stuck unable to
      // start logging over two questions with no wrong answer.
      onError: completeOnboarding,
    });
  };

  // Skipping the second question still keeps an answer already given to the
  // first -- "skip" means "stop asking", not "forget what I already said".
  const skipRest = () => finish(frequency ? { eating_out_frequency: frequency } : {});

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
        {step === 0 ? (
          <>
            <View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
              <Text style={[type.display, { color: colors.text }]}>
                {t('onboarding.frequencyTitle')}
              </Text>
              <Text style={[type.body, { color: colors.muted }]}>
                {t('onboarding.frequencyBody')}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {FREQUENCY_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  label={t(`onboarding.${option.label}`)}
                  selected={frequency === option.value}
                  showCheck
                  style={{ flexGrow: 1 }}
                  onPress={() => {
                    setFrequency(option.value);
                    setStep(1);
                  }}
                />
              ))}
            </View>

            <Button
              label={t('onboarding.skip')}
              variant="secondary"
              size="lg"
              full
              onPress={() => setStep(1)}
            />
          </>
        ) : (
          <>
            <View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
              <Text style={[type.display, { color: colors.text }]}>
                {t('onboarding.struggleTitle')}
              </Text>
              <Text style={[type.body, { color: colors.muted }]}>
                {t('onboarding.struggleBody')}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {STRUGGLE_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  label={t(`onboarding.${option.label}`)}
                  selected={struggle === option.value}
                  showCheck
                  style={{ flexGrow: 1 }}
                  onPress={() => setStruggle(option.value)}
                />
              ))}
            </View>

            <View style={{ gap: spacing.md }}>
              <Button
                label={t('onboarding.continue')}
                size="lg"
                full
                loading={updateProfile.isPending}
                onPress={() =>
                  finish({
                    ...(frequency ? { eating_out_frequency: frequency } : {}),
                    ...(struggle ? { biggest_struggle: struggle } : {}),
                  })
                }
              />
              <Button
                label={t('onboarding.skip')}
                variant="secondary"
                size="lg"
                full
                disabled={updateProfile.isPending}
                onPress={() => skipRest()}
              />
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}
