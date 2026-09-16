import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { StarRating } from '../../components/StarRating';
import {
  Button,
  Card,
  Chip,
  Empty,
  ErrorState,
  Field,
  Icon,
  Loading,
  Screen,
  SectionLabel,
  type IconName,
} from '../../components/ui';
import { useCategories, useCuisines, useSearch } from '../../hooks/useCatalog';
import { useCreateLog } from '../../hooks/useLogs';
import { useRestaurants } from '../../hooks/useRestaurants';
import { describeError } from '../../lib/api';
import { haptics } from '../../lib/haptics';
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

/** The whole form in three lines, for someone opening it for the first time. */
const STEPS: { icon: IconName; text: string }[] = [
  { icon: 'search', text: 'Search for what you ate, or pick a cuisine and a category.' },
  { icon: 'meal', text: 'Name the dish, say where you ate it and how big the serving was.' },
  { icon: 'chart', text: 'Log it. Forkast estimates the calories and your week updates.' },
];

/**
 * A section label with its icon.
 *
 * Kept here rather than folded into SectionLabel because that component puts
 * its children straight into a Text, and an icon riding inside a line box of
 * fifteen pixels clips on Android.
 */
function IconLabel({ icon, children }: { icon: IconName; children: string }) {
  const { spacing } = useTheme();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Icon name={icon} size={14} />
      <SectionLabel>{children}</SectionLabel>
    </View>
  );
}

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

  // Nothing typed and nothing picked, so the form is still a blank page and can
  // afford to explain itself. It gets out of the way at the first tap.
  const pristine = query.trim().length === 0 && dishName.trim().length === 0 && categoryId === null;

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
      // The moment worth celebrating, and the only success haptic in the app.
      onSuccess: (log) => {
        haptics.success();
        setSaved(log);
      },
      onError: () => haptics.error(),
    });
  };

  if (saved) {
    return (
      <Screen title="Logged" eyebrow="Nice one">
        <Card>
          <View style={{ gap: spacing.xs }}>
            <IconLabel icon="check">Estimated</IconLabel>
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
          That is on the board, and your dashboard and streak have already moved.
        </Text>

        <View style={{ gap: spacing.md }}>
          <Button
            label="Log another"
            icon="log"
            size="lg"
            full
            onPress={() => {
              setSaved(null);
              resetForm();
            }}
          />
          <Button
            label="See the dashboard"
            icon="dashboard"
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
      {pristine ? (
        <Card>
          <View style={{ gap: spacing.lg }}>
            <IconLabel icon="log">How a log works</IconLabel>
            {STEPS.map((step, index) => (
              <View
                key={step.icon}
                style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}
              >
                <Icon name={step.icon} size={18} />
                <Text style={[type.body, { color: colors.text, flex: 1 }]}>
                  {`${index + 1}. ${step.text}`}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

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
            <IconLabel icon="search">Matches</IconLabel>
            {search.data.dishes.length === 0 && search.data.categories.length === 0 ? (
              <Empty
                icon="search"
                title="Nothing matched"
                message="Forkast only knows the dishes people have logged so far. Clear the search, then type the dish below and pick the category it belongs to."
                actionLabel="Clear the search"
                actionIcon="close"
                actionVariant="secondary"
                onAction={() => setQuery('')}
              />
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
        <IconLabel icon="cuisine">Cuisine</IconLabel>
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
        <IconLabel icon="category">Category</IconLabel>
        {categories.isLoading ? <Loading label="Loading categories" fill={false} /> : null}
        {categories.isError ? (
          <ErrorState
            title="Categories unavailable"
            message={describeError(categories.error)}
            onRetry={() => void categories.refetch()}
          />
        ) : null}
        {categories.data && categories.data.length === 0 ? (
          <Empty
            icon="category"
            title="No categories here yet"
            message="Nothing is mapped to this cuisine. The category is what Forkast estimates calories from, so pick one from the full list instead."
            actionLabel="Show every cuisine"
            actionIcon="cuisine"
            actionVariant="secondary"
            onAction={() => pickCuisine(null)}
          />
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
        <IconLabel icon="star">Rating</IconLabel>
        <StarRating value={rating} onChange={setRating} />
      </View>

      <View style={{ gap: spacing.md }}>
        <IconLabel icon="fun">Fun scale</IconLabel>
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
        <IconLabel icon="friends">Who was there</IconLabel>
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
        <IconLabel icon="meal">Serving size</IconLabel>
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
        icon="check"
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
