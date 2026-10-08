import { useEffect } from 'react';
import { Text, View } from 'react-native';
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
          caption={`kcal for ${displayDish(saved.dish_name)}${saved.restaurant ? ` at ${saved.restaurant.name}` : ''
            }`}
          align="center"
        />
        <EstimateSourceLabel source={estimatorSource} />
      </Animated.View>

      <Text style={[type.body, { color: colors.text }]}>{saveReaction(saved.category)}</Text>

      <Text style={[type.body, { color: colors.muted }]}>
        Your dashboard and your streak have already moved.
      </Text>

      {photoStatus === 'uploading' ? <Loading label="Attaching your photo" /> : null}

      {photoStatus === 'attached' ? (
        <Text style={[type.caption, { color: colors.muted }]}>Your photo went up with it.</Text>
      ) : null}

      {photoStatus === 'failed' ? (
        // The one card on this state. A problem that needs its own surface
        // to hold it apart from the success above it is what a card is for.
        <Card>
          <View style={{ gap: spacing.md, alignItems: 'flex-start' }}>
            <Text style={[type.subtitle, { color: colors.text }]}>
              The photo did not attach
            </Text>
            <Text style={[type.caption, { color: colors.muted }]}>
              The meal itself is saved. Send the picture again, or add it later from the meal in
              your diary.
            </Text>
            <Button label="Try the photo again" variant="secondary" onPress={onRetryPhoto} />
          </View>
        </Card>
      ) : null}

      <View style={{ gap: spacing.md }}>
        <Button label="Log another" icon="log" size="lg" full onPress={onLogAnother} />
        <Button
          label="See the dashboard"
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
