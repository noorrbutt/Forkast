import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { StarRating } from '../../components/StarRating';
import { Button, Card, Chip, ErrorState, Field, Loading, Screen, SectionLabel } from '../../components/ui';
import { useCategories, useCuisines, useSearch } from '../../hooks/useCatalog';
import { useCreateLog } from '../../hooks/useLogs';
import { useRestaurants } from '../../hooks/useRestaurants';
import { describeError } from '../../lib/api';
import { FRIEND_LABELS, SERVING_LABELS, formatNumber } from '../../lib/format';
import {
  FRIEND_SCALES,
  SERVING_SIZES,
  type FoodLog,
  type FriendScale,
  type RefId,
  type Uuid,
  type LogInput,
  type ServingSize,
} from '../../lib/types';
import { useTheme } from '../../theme';

const FUN_LEVELS = [1, 2, 3, 4, 5];

export default function LogScreen() {
  const { colors, spacing, type } = useTheme();
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [cuisineId, setCuisineId] = useState<RefId | null>(null);
  const [categoryId, setCategoryId] = useState<RefId | null>(null);
  const [dishName, setDishName] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [restaurantId, setRestaurantId] = useState<Uuid | null>(null);
  const [area, setArea] = useState('');
  const [rating, setRating] = useState(4);
  const [funScale, setFunScale] = useState<number | null>(null);
  const [friendScale, setFriendScale] = useState<FriendScale | null>(null);
  const [servingSize, setServingSize] = useState<ServingSize>('medium');
  const [saved, setSaved] = useState<FoodLog | null>(null);

  const cuisines = useCuisines();
  const categories = useCategories(cuisineId);
  const search = useSearch(query);
  const restaurants = useRestaurants(restaurantName);
  const createLog = useCreateLog();

  const selectedCategory = useMemo(
    () => (categories.data ?? []).find((category) => String(category.id) === String(categoryId)) ?? null,
    [categories.data, categoryId],
  );

  const resetForm = () => {
    setQuery('');
    setCuisineId(null);
    setCategoryId(null);
    setDishName('');
    setRestaurantName('');
    setRestaurantId(null);
    setArea('');
    setRating(4);
    setFunScale(null);
    setFriendScale(null);
    setServingSize('medium');
    createLog.reset();
  };

  const pickCuisine = (next: RefId | null) => {
    setCuisineId(next);
    setCategoryId(null);
  };

  const canSubmit = dishName.trim().length > 0 && categoryId !== null && !createLog.isPending;

  const submit = () => {
    if (!canSubmit || categoryId === null) return;

    const input: LogInput = {
      dish_name: dishName.trim(),
      category_id: categoryId,
      rating,
      serving_size: servingSize,
    };
    if (funScale !== null) input.fun_scale = funScale;
    if (friendScale !== null) input.friend_scale = friendScale;
    if (restaurantId !== null) input.restaurant_id = restaurantId;
    else if (restaurantName.trim().length > 0) input.restaurant_name = restaurantName.trim();
    if (area.trim().length > 0) input.area = area.trim();

    createLog.mutate(input, {
      onSuccess: (log) => setSaved(log),
    });
  };

  if (saved) {
    return (
      <Screen title="Logged" eyebrow="Nice one">
        <Card>
          <View style={{ gap: spacing.xs }}>
            <SectionLabel>Estimated</SectionLabel>
            <Text style={[type.display, { color: colors.accent }]}>
              {formatNumber(saved.estimated_calories)}
            </Text>
            <Text style={[type.caption, { color: colors.muted }]}>
              kcal for {saved.dish_name}
              {saved.restaurant ? ` at ${saved.restaurant.name}` : ''}.
            </Text>
          </View>
        </Card>

        <Text style={[type.body, { color: colors.muted }]}>
          That is on the board. Your streak and dashboard have already caught up.
        </Text>

        <View style={{ gap: spacing.md }}>
          <Button
            label="Log another"
            size="lg"
            full
            onPress={() => {
              setSaved(null);
              resetForm();
            }}
          />
          <Button
            label="See the dashboard"
            variant="secondary"
            size="lg"
            full
            onPress={() => {
              setSaved(null);
              resetForm();
              router.navigate('/');
            }}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="Log a meal" eyebrow="What did you eat">
      <Field
        label="Search"
        value={query}
        onChangeText={setQuery}
        placeholder="Biryani, ramen, burger"
        autoCapitalize="none"
        autoCorrect={false}
      />

      {search.isFetching ? <Loading label="Searching" fill={false} /> : null}

      {search.data && query.trim().length >= 2 ? (
        <Card>
          <View style={{ gap: spacing.lg }}>
            <SectionLabel>Matches</SectionLabel>
            {search.data.dishes.length === 0 && search.data.categories.length === 0 ? (
              <Text style={[type.caption, { color: colors.muted }]}>
                Nothing matched. Type the dish name below and pick a category.
              </Text>
            ) : null}

            {search.data.dishes.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {search.data.dishes.slice(0, 8).map((dish, index) => (
                  <Chip
                    key={`${dish.dish_name}-${index}`}
                    label={dish.dish_name}
                    compact
                    selected={dishName === dish.dish_name}
                    onPress={() => {
                      setDishName(dish.dish_name);
                      setCategoryId(dish.category_id);
                      setQuery('');
                    }}
                  />
                ))}
              </View>
            ) : null}

            {search.data.categories.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {search.data.categories.slice(0, 8).map((category) => (
                  <Chip
                    key={String(category.id)}
                    label={category.name}
                    compact
                    selected={String(categoryId) === String(category.id)}
                    onPress={() => {
                      setCuisineId(category.cuisine_id);
                      setCategoryId(category.id);
                      setQuery('');
                    }}
                  />
                ))}
              </View>
            ) : null}
          </View>
        </Card>
      ) : null}

      <View style={{ gap: spacing.md }}>
        <SectionLabel>Cuisine</SectionLabel>
        {cuisines.isLoading ? <Loading label="Loading cuisines" fill={false} /> : null}
        {cuisines.isError ? (
          <ErrorState
            title="Cuisines unavailable"
            message={describeError(cuisines.error)}
            onRetry={() => void cuisines.refetch()}
          />
        ) : null}
        {cuisines.data ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.lg }}
          >
            <Chip label="All" selected={cuisineId === null} onPress={() => pickCuisine(null)} />
            {cuisines.data.map((cuisine) => (
              <Chip
                key={String(cuisine.id)}
                label={cuisine.name}
                leading={cuisine.emoji ?? undefined}
                selected={String(cuisineId) === String(cuisine.id)}
                onPress={() => pickCuisine(cuisine.id)}
              />
            ))}
          </ScrollView>
        ) : null}
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionLabel>Category</SectionLabel>
        {categories.isLoading ? <Loading label="Loading categories" fill={false} /> : null}
        {categories.isError ? (
          <ErrorState
            title="Categories unavailable"
            message={describeError(categories.error)}
            onRetry={() => void categories.refetch()}
          />
        ) : null}
        {categories.data && categories.data.length === 0 ? (
          <Text style={[type.caption, { color: colors.muted }]}>
            No categories for this cuisine yet.
          </Text>
        ) : null}
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

      <Field label="Dish" value={dishName} onChangeText={setDishName} placeholder="Chicken karahi" />

      <View style={{ gap: spacing.md }}>
        <Field
          label="Restaurant"
          value={restaurantName}
          onChangeText={(value) => {
            setRestaurantName(value);
            setRestaurantId(null);
          }}
          placeholder="Leave blank if you cooked"
        />
        {restaurants.data && restaurantName.trim().length > 0 && restaurantId === null ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {restaurants.data.slice(0, 6).map((restaurant) => (
              <Chip
                key={String(restaurant.id)}
                label={restaurant.name}
                compact
                onPress={() => {
                  setRestaurantId(restaurant.id);
                  setRestaurantName(restaurant.name);
                  if (restaurant.area) setArea(restaurant.area);
                }}
              />
            ))}
          </View>
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

      {createLog.isError ? (
        <Text style={[type.caption, { color: colors.danger }]}>{describeError(createLog.error)}</Text>
      ) : null}

      <Button
        label={createLog.isPending ? 'Saving' : 'Log it'}
        size="lg"
        full
        onPress={submit}
        loading={createLog.isPending}
        disabled={!canSubmit}
      />

      {categoryId === null ? (
        <Text style={[type.caption, { color: colors.muted }]}>
          Pick a category so Forkast can estimate the calories.
        </Text>
      ) : null}
    </Screen>
  );
}
