import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Button, Card, EstimateSourceLabel, Hero, Loading } from '../ui';
import { displayDish, formatNumber, saveReaction } from '../../lib/format';
import type { FoodLog } from '../../lib/types';
import { useTheme } from '../../theme';
import { motion } from '../../theme/motion';
import type { LogForm, PhotoStatus } from './useLogForm';

/**
 * The state after a save: the estimate as the screen's one hero figure.
 *
 * Only here, never on the form. Before submitting, the server has not picked
 * a value inside the category's range yet, so the most the client can
 * honestly show is a range -- and a 64pt figure appearing mid-task would push
 * every remaining field down under the reader's finger. The range lives as
 * the hint under the category picker instead. Once the meal is saved the
 * number is real and the screen has nothing else to say.
 */
export function LogSaved({
  saved,
  estimatorSource,
  photoStatus,
  onRetryPhoto,
  onLogAnother,
  onSeeDashboard,
}: {
  saved: FoodLog;
  estimatorSource: LogForm['estimatorSource']['data'];
  photoStatus: PhotoStatus;
  onRetryPhoto: () => void;
  onLogAnother: () => void;
  onSeeDashboard: () => void;
}) {
  const { t } = useTranslation();
  const { colors, spacing, type } = useTheme();

  // The one entrance this screen ever plays. Keyed on the saved log rather
  // than fired from onSuccess directly, so it also plays if this state is
  // ever restored rather than only just set, and so it cannot replay on an
  // unrelated re-render while the hero is already on screen.
  const heroScale = useSharedValue(0);
  useEffect(() => {
    heroScale.value = 0;
    heroScale.value = withSpring(1, motion.celebrate);
  }, [saved, heroScale]);
  const heroAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heroScale.value }],
  }));

  return (
    <>
      <Animated.View
        style={[
          {
            alignItems: 'center',
            // The only xxxl on this screen. That reservation is what makes this
            // read as the hero before its size is even considered.
            paddingTop: spacing.xxl,
            paddingBottom: spacing.xxxl,
          },
          heroAnimatedStyle,
        ]}
      >
        <Hero
          value={formatNumber(saved.estimated_calories)}
          caption={t('log.savedCaption', {
            calories: formatNumber(saved.estimated_calories),
            dish: displayDish(saved.dish_name),
            restaurant: saved.restaurant
              ? t('log.savedAtRestaurant', { restaurant: saved.restaurant.name })
              : '',
          })}
          align="center"
        />
        <EstimateSourceLabel
          source={estimatorSource}
          labels={{ ai: t('log.estimateAI'), local: t('log.estimateLocal') }}
        />
      </Animated.View>

      <Text style={[type.body, { color: colors.text }]}>
        {saveReaction(saved.category, {
          default: t('log.savedReactionDefault'),
          light: (category) => t('log.savedReactionLight', { category }),
          junk: t('log.savedReactionJunk'),
          ordinary: (category) => t('log.savedReactionOrdinary', { category }),
        })}
      </Text>

      <Text style={[type.body, { color: colors.muted }]}>
        {t('log.savedDashboardMoved')}
      </Text>

      {photoStatus === 'uploading' ? <Loading label={t('log.attachingPhoto')} /> : null}

      {photoStatus === 'attached' ? (
        <Text style={[type.caption, { color: colors.muted }]}>{t('log.photoAttached')}</Text>
      ) : null}

      {photoStatus === 'failed' ? (
        // The one card on this state. A problem that needs its own surface
        // to hold it apart from the success above it is what a card is for.
        <Card>
          <View style={{ gap: spacing.md, alignItems: 'flex-start' }}>
            <Text style={[type.subtitle, { color: colors.text }]}>
              {t('log.photoFailedTitle')}
            </Text>
            <Text style={[type.caption, { color: colors.muted }]}>
              {t('log.photoFailedBody')}
            </Text>
            <Button label={t('log.tryPhotoAgain')} variant="secondary" onPress={onRetryPhoto} />
          </View>
        </Card>
      ) : null}

      <View style={{ gap: spacing.md }}>
        <Button label={t('log.logAnother')} icon="log" size="lg" full onPress={onLogAnother} />
        <Button
          label={t('log.seeDashboard')}
          icon="dashboard"
          variant="secondary"
          size="lg"
          full
          onPress={onSeeDashboard}
        />
      </View>
    </>
  );
}
