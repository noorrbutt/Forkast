import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { StarRating } from '../../components/StarRating';
import {
  Button,
  Card,
  Chip,
  ErrorState,
  Field,
  Loading,
  Screen,
  SectionLabel,
} from '../../components/ui';
import { useCategories } from '../../hooks/useCatalog';
import { useDeleteLog, useLog, useUpdateLog } from '../../hooks/useLogs';
import { describeError } from '../../lib/api';
import { FRIEND_LABELS, SERVING_LABELS, formatNumber } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import {
  FRIEND_SCALES,
  SERVING_SIZES,
  type FriendScale,
  type LogPatch,
  type RefId,
  type ServingSize,
} from '../../lib/types';
import { useTheme } from '../../theme';

const FUN_LEVELS = [1, 2, 3, 4, 5];

export default function EditLogScreen() {
  const { colors, spacing, type } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const log = useLog(id ?? null);
  const updateLog = useUpdateLog();
  const deleteLog = useDeleteLog();

  // All categories, not the ones for a chosen cuisine: an edit starts from a
  // category that is already set, and re-picking the cuisine first would be a
  // step the user did not ask for.
  const categories = useCategories(null);

  const [dishName, setDishName] = useState('');
  const [categoryId, setCategoryId] = useState<RefId | null>(null);
  const [area, setArea] = useState('');
  const [rating, setRating] = useState(4);
  const [funScale, setFunScale] = useState<number | null>(null);
  const [friendScale, setFriendScale] = useState<FriendScale | null>(null);
  const [servingSize, setServingSize] = useState<ServingSize>('medium');

  // Seeded once the log arrives. Keyed on the id so it does not overwrite an
  // edit in progress every time the query refetches in the background.
  useEffect(() => {
    if (!log.data) return;
    setDishName(log.data.dish_name);
    setCategoryId(log.data.category_id);
    setArea(log.data.area ?? '');
    setRating(log.data.rating);
    setFunScale(log.data.fun_scale);
    setFriendScale(log.data.friend_scale);
    setServingSize(log.data.serving_size);
  }, [log.data?.id]);

  const selectedCategory = useMemo(
    () => (categories.data ?? []).find((c) => String(c.id) === String(categoryId)) ?? null,
    [categories.data, categoryId],
  );

  const save = () => {
    if (!id || categoryId === null) return;

    // Only what actually changed. Sending the whole form would make the server
    // recompute the calorie estimate on every save, including saves that
    // touched nothing it depends on.
    const original = log.data;
    const patch: LogPatch = {};
    if (original) {
      if (dishName.trim() !== original.dish_name) patch.dish_name = dishName.trim();
      if (categoryId !== original.category_id) patch.category_id = categoryId;
      if (rating !== original.rating) patch.rating = rating;
      if (servingSize !== original.serving_size) patch.serving_size = servingSize;
      if (funScale !== original.fun_scale) patch.fun_scale = funScale;
      if (friendScale !== original.friend_scale) patch.friend_scale = friendScale;

      const nextArea = area.trim();
      if (nextArea !== (original.area ?? '')) patch.area = nextArea.length > 0 ? nextArea : null;
    }

    if (Object.keys(patch).length === 0) {
      router.back();
      return;
    }

    updateLog.mutate(
      { id, patch },
      {
        onSuccess: () => {
          haptics.success();
          router.back();
        },
        onError: () => haptics.error(),
      },
    );
  };

  const confirmDelete = () => {
    if (!id) return;
    Alert.alert('Delete this log?', 'It will come off your dashboard and your streak.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteLog.mutate(id, {
            onSuccess: () => {
              haptics.success();
              router.back();
            },
            onError: () => haptics.error(),
          }),
      },
    ]);
  };

  if (log.isLoading) {
    return (
      <Screen title="Edit" onBack={() => router.back()}>
        <Loading label="Loading the log" />
      </Screen>
    );
  }

  if (log.isError || !log.data) {
    return (
      <Screen title="Edit" onBack={() => router.back()}>
        <ErrorState
          title="Log unavailable"
          message={describeError(log.error)}
          onRetry={() => void log.refetch()}
        />
      </Screen>
    );
  }

  const busy = updateLog.isPending || deleteLog.isPending;

  return (
    <Screen title="Edit log" eyebrow="Fix anything" onBack={() => router.back()}>
      <Card>
        <View style={{ gap: spacing.xs }}>
          <SectionLabel>Current estimate</SectionLabel>
          <Text style={[type.display, { color: colors.accent }]}>
            {formatNumber(log.data.estimated_calories)}
          </Text>
          <Text style={[type.caption, { color: colors.muted }]}>
            kcal. Changing the dish, category or serving size re-estimates it.
          </Text>
        </View>
      </Card>

      <Field label="Dish" value={dishName} onChangeText={setDishName} placeholder="Chicken karahi" />

      <View style={{ gap: spacing.md }}>
        <SectionLabel>Category</SectionLabel>
        {categories.isLoading ? <Loading label="Loading categories" fill={false} /> : null}
        {categories.data ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {categories.data.map((category) => (
              <Chip
                key={String(category.id)}
                label={category.name}
                selected={String(categoryId) === String(category.id)}
                onPress={() => setCategoryId(category.id)}
              />
            ))}
          </View>
        ) : null}
        {selectedCategory ? (
          <Text style={[type.caption, { color: colors.muted }]}>
            Usually {formatNumber(selectedCategory.base_calorie_min)} to{' '}
            {formatNumber(selectedCategory.base_calorie_max)} kcal
            {selectedCategory.is_junk ? ', counts as junk' : ''}.
          </Text>
        ) : null}
      </View>

      <Field label="Area" value={area} onChangeText={setArea} placeholder="Optional neighbourhood" />

      <View style={{ gap: spacing.md }}>
        <SectionLabel>Rating</SectionLabel>
        <StarRating value={rating} onChange={setRating} />
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionLabel>Fun scale</SectionLabel>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {FUN_LEVELS.map((level) => (
            <Chip
              key={level}
              label={String(level)}
              selected={funScale === level}
              onPress={() => setFunScale(funScale === level ? null : level)}
              style={{ flex: 1, alignItems: 'center' }}
            />
          ))}
        </View>
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionLabel>Who was there</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {FRIEND_SCALES.map((scale) => (
            <Chip
              key={scale}
              label={FRIEND_LABELS[scale]}
              selected={friendScale === scale}
              onPress={() => setFriendScale(friendScale === scale ? null : scale)}
            />
          ))}
        </View>
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionLabel>Serving size</SectionLabel>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {SERVING_SIZES.map((size) => (
            <Chip
              key={size}
              label={SERVING_LABELS[size]}
              selected={servingSize === size}
              onPress={() => setServingSize(size)}
              style={{ flex: 1, alignItems: 'center' }}
            />
          ))}
        </View>
      </View>

      {updateLog.isError ? (
        <Text style={[type.caption, { color: colors.danger }]}>
          {describeError(updateLog.error)}
        </Text>
      ) : null}
      {deleteLog.isError ? (
        <Text style={[type.caption, { color: colors.danger }]}>
          {describeError(deleteLog.error)}
        </Text>
      ) : null}

      <Button
        label={updateLog.isPending ? 'Saving' : 'Save changes'}
        size="lg"
        full
        onPress={save}
        loading={updateLog.isPending}
        disabled={busy || dishName.trim().length === 0 || categoryId === null}
      />

      <Button
        label="Delete this log"
        variant="secondary"
        size="lg"
        full
        onPress={confirmDelete}
        loading={deleteLog.isPending}
        disabled={busy}
      />
    </Screen>
  );
}
