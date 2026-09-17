import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { MealPhoto } from '../../components/MealPhoto';
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
  Select,
  type IconName,
  type SelectOption,
} from '../../components/ui';
import { useCategories, useCuisines, useSearch } from '../../hooks/useCatalog';
import { useCreateLog } from '../../hooks/useLogs';
import { useSetPhoto, type PickedPhoto } from '../../hooks/usePhoto';
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
import { cuisineColors } from '../../theme/tokens';

const FUN_LEVELS = [1, 2, 3, 4, 5];

/** Stands for "no cuisine filter". Never collides with an id, which is numeric. */
const ANY_CUISINE = 'any';

/**
 * How wide the form is allowed to get, and what centring it actually means.
 *
 * Centring every element would be worse than leaving it ragged: headings,
 * fields and chip rows would each find their own axis and nothing would line up
 * with anything. So the column is what gets centred, capped here at a
 * comfortable reading measure. On a phone the cap never binds and the column is
 * simply the screen; on a tablet, a foldable or the web build it stops a form
 * of short controls being stretched across 900pt.
 *
 * Inside the column every row then fills it edge to edge: fields already do,
 * and the chip rows below use flexGrow so the pills keep their natural width,
 * share the leftover space and finish flush with the right hand edge instead of
 * trailing off wherever the labels happened to end.
 */
const FORM_WIDTH = 420;

/** The whole form in three lines, for someone opening it for the first time. */
const STEPS: { icon: IconName; text: string }[] = [
  { icon: 'search', text: 'Search for what you ate, or pick a cuisine and a category.' },
  { icon: 'meal', text: 'Name the dish, say where you ate it and how big the serving was.' },
  { icon: 'chart', text: 'Log it. Forkast estimates the calories and your week updates.' },
];

/** Where the photo has got to, given it can only be sent once the log exists. */
type PhotoStatus = 'none' | 'uploading' | 'attached' | 'failed';

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
  const { colors, spacing, type, name: themeName } = useTheme();
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
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [photoStatus, setPhotoStatus] = useState<PhotoStatus>('none');
  const [saved, setSaved] = useState<FoodLog | null>(null);

  const cuisines = useCuisines();
  // Every category, once, rather than a fetch per cuisine. Choosing a category
  // sets the cuisine it belongs to, and refetching at that exact moment would
  // empty the list under the field that had just been filled in.
  const categories = useCategories(null);
  const search = useSearch(query);
  const restaurants = useRestaurants(restaurantName);
  const createLog = useCreateLog();
  const uploadPhoto = useSetPhoto();

  const selectedCategory = useMemo(
    () => (categories.data ?? []).find((category) => String(category.id) === String(categoryId)) ?? null,
    [categories.data, categoryId],
  );

  const cuisineOptions = useMemo<SelectOption[]>(
    () => [
      { value: ANY_CUISINE, label: 'Any cuisine', hint: 'Search every category' },
      ...(cuisines.data ?? []).map((cuisine) => ({
        value: String(cuisine.id),
        label: cuisine.name,
        emoji: cuisine.emoji ?? undefined,
        color: cuisineColors[themeName][cuisine.slug],
      })),
    ],
    [cuisines.data, themeName],
  );

  const cuisineById = useMemo(
    () => new Map((cuisines.data ?? []).map((cuisine) => [String(cuisine.id), cuisine])),
    [cuisines.data],
  );

  const visibleCategories = useMemo(
    () =>
      (categories.data ?? []).filter(
        (category) => cuisineId === null || String(category.cuisine_id) === String(cuisineId),
      ),
    [categories.data, cuisineId],
  );

  const categoryOptions = useMemo<SelectOption[]>(
    () =>
      visibleCategories.map((category) => {
        const cuisine = cuisineById.get(String(category.cuisine_id));
        return {
          value: String(category.id),
          // The cuisine rides along as the hint, so typing "Italian" finds every
          // Italian category. Someone logging dinner knows the cuisine long
          // before they know which of our 38 buckets we filed it under.
          label: category.name,
          hint: cuisine?.name,
          color: cuisine ? cuisineColors[themeName][cuisine.slug] : undefined,
        };
      }),
    [visibleCategories, cuisineById, themeName],
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
    setPhoto(null);
    setPhotoStatus('none');
    createLog.reset();
    uploadPhoto.reset();
  };

  const pickCuisine = (next: RefId | null) => {
    setCuisineId(next);
    setCategoryId(null);
  };

  const chooseCuisine = (value: string) => {
    const cuisine = (cuisines.data ?? []).find((item) => String(item.id) === value);
    pickCuisine(cuisine?.id ?? null);
  };

  const chooseCategory = (value: string) => {
    const category = (categories.data ?? []).find((item) => String(item.id) === value);
    if (!category) return;
    setCategoryId(category.id);
    // Answering the category answers the cuisine too, so the field above says
    // so rather than sitting empty next to a category that contradicts it.
    setCuisineId(category.cuisine_id);
  };

  const canSubmit = dishName.trim().length > 0 && categoryId !== null && !createLog.isPending;

  // Nothing typed and nothing picked, so the form is still a blank page and can
  // afford to explain itself. It gets out of the way at the first tap.
  const pristine = query.trim().length === 0 && dishName.trim().length === 0 && categoryId === null;

  /**
   * Send the held photo, now that the meal has an id to hang it on.
   *
   * Deliberately after the log is saved and deliberately not part of it: the
   * photo API is addressed by log id, so there is nothing to upload to until
   * the log exists, and a picture is the optional half of this form. A refused
   * upload therefore leaves a saved meal and a line saying the photo did not
   * attach, never a lost meal.
   */
  const attachPhoto = async (logId: Uuid, picked: PickedPhoto) => {
    setPhotoStatus('uploading');
    try {
      await uploadPhoto.mutateAsync({ logId, uri: picked.uri, mimeType: picked.mimeType });
      setPhotoStatus('attached');
    } catch {
      setPhotoStatus('failed');
    }
  };

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
        if (photo) void attachPhoto(log.id, photo);
      },
      onError: () => haptics.error(),
    });
  };

  /** The centred, capped column every screen state lays itself out in. */
  const column = {
    width: '100%' as const,
    maxWidth: FORM_WIDTH,
    alignSelf: 'center' as const,
    gap: spacing.xl,
  };

  /** One shape for every row of pills on this screen, so no two rows differ. */
  const optionRow = {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: spacing.sm,
  };
  const optionChip = { flexGrow: 1 };

  if (saved) {
    return (
      <Screen title="Logged" eyebrow="Nice one">
        <View style={column}>
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

          {photoStatus === 'uploading' ? <Loading label="Attaching your photo" fill={false} /> : null}

          {photoStatus === 'attached' ? (
            <Text style={[type.caption, { color: colors.muted }]}>Your photo went up with it.</Text>
          ) : null}

          {photoStatus === 'failed' ? (
            <Card>
              <View style={{ gap: spacing.md }}>
                <IconLabel icon="warning">Photo</IconLabel>
                <Text style={[type.body, { color: colors.text }]}>
                  The meal is saved. The photo did not attach, so it is not on it yet.
                </Text>
                <Text style={[type.caption, { color: colors.muted }]}>
                  Send it again from here, or add it later from the meal in your diary.
                </Text>
                <Button
                  label="Try the photo again"
                  icon="meal"
                  variant="secondary"
                  onPress={() => {
                    if (photo) void attachPhoto(saved.id, photo);
                  }}
                />
              </View>
            </Card>
          ) : null}

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
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="Log a meal" eyebrow="What did you eat">
      <View style={column}>
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
                <View style={optionRow}>
                  {search.data.dishes.slice(0, 8).map((dish, index) => (
                    <Chip
                      key={`${dish.dish_name}-${index}`}
                      label={dish.dish_name}
                      selected={dishName === dish.dish_name}
                      showCheck
                      style={optionChip}
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
                <View style={optionRow}>
                  {search.data.categories.slice(0, 8).map((category) => (
                    <Chip
                      key={String(category.id)}
                      label={category.name}
                      selected={String(categoryId) === String(category.id)}
                      showCheck
                      style={optionChip}
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

        {/* Ten cuisines and thirty eight categories. As chips that is a wall of
            tiny text with no way to search it, which is what made this screen
            unreadable, so both are fields that open a searchable list. */}
        <View style={{ gap: spacing.lg }}>
          {cuisines.isError ? (
            <ErrorState
              title="Cuisines unavailable"
              message={describeError(cuisines.error)}
              onRetry={() => void cuisines.refetch()}
            />
          ) : (
            <Select
              label="Cuisine"
              value={cuisineId === null ? null : String(cuisineId)}
              options={cuisineOptions}
              onChange={chooseCuisine}
              placeholder={cuisines.isLoading ? 'Loading cuisines' : 'Any cuisine'}
              hint="Optional. It narrows the categories below."
              disabled={!cuisines.data}
              emptyText="No cuisine by that name."
            />
          )}

          {categories.isError ? (
            <ErrorState
              title="Categories unavailable"
              message={describeError(categories.error)}
              onRetry={() => void categories.refetch()}
            />
          ) : (
            <Select
              label="Category"
              value={categoryId === null ? null : String(categoryId)}
              options={categoryOptions}
              onChange={chooseCategory}
              placeholder={
                categories.isLoading
                  ? 'Loading categories'
                  : `Search ${categoryOptions.length} categories`
              }
              hint={
                selectedCategory
                  ? `Usually ${formatNumber(selectedCategory.base_calorie_min)} to ${formatNumber(
                      selectedCategory.base_calorie_max,
                    )} kcal${selectedCategory.is_junk ? ', counts as junk' : ''}.`
                  : 'The calorie estimate comes from this. Type a cuisine to see its categories.'
              }
              disabled={categoryOptions.length === 0}
              emptyText="Nothing matches that. Try the cuisine, for example Italian."
            />
          )}

          {categories.data && visibleCategories.length === 0 ? (
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
            <View style={optionRow}>
              {restaurants.data.slice(0, 6).map((restaurant) => (
                <Chip
                  key={String(restaurant.id)}
                  label={restaurant.name}
                  style={optionChip}
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
          {/* The stars keep the left edge every heading and field uses, and the
              count takes the right, so the row ends where the column does
              rather than stopping halfway across it. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: spacing.md,
            }}
          >
            <StarRating value={rating} onChange={setRating} />
            <Text style={[type.caption, { color: colors.muted }]}>{rating} of 5</Text>
          </View>
        </View>

        <View style={{ gap: spacing.md }}>
          <IconLabel icon="fun">Fun scale</IconLabel>
          <View style={optionRow}>
            {FUN_LEVELS.map((level) => (
              <Chip
                key={level}
                label={String(level)}
                selected={funScale === level}
                showCheck
                style={optionChip}
                onPress={() => setFunScale(funScale === level ? null : level)}
              />
            ))}
          </View>
        </View>

        <View style={{ gap: spacing.md }}>
          <IconLabel icon="friends">Who was there</IconLabel>
          <View style={optionRow}>
            {FRIEND_SCALES.map((scale) => (
              <Chip
                key={scale}
                label={FRIEND_LABELS[scale]}
                selected={friendScale === scale}
                showCheck
                style={optionChip}
                onPress={() => setFriendScale(friendScale === scale ? null : scale)}
              />
            ))}
          </View>
        </View>

        <View style={{ gap: spacing.md }}>
          <IconLabel icon="meal">Serving size</IconLabel>
          <View style={optionRow}>
            {SERVING_SIZES.map((size) => (
              <Chip
                key={size}
                label={SERVING_LABELS[size]}
                selected={servingSize === size}
                showCheck
                style={optionChip}
                onPress={() => setServingSize(size)}
              />
            ))}
          </View>
        </View>

        {/* No log id yet, so the picked file waits here and goes up the moment
            the meal is created. */}
        <MealPhoto photo={photo} onPhotoChange={setPhoto} />

        {createLog.isError ? (
          <Text style={[type.caption, { color: colors.danger }]}>{describeError(createLog.error)}</Text>
        ) : null}

        <View style={{ gap: spacing.sm }}>
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
            <Text style={[type.caption, { color: colors.muted, textAlign: 'center' }]}>
              Pick a category so Forkast can estimate the calories.
            </Text>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}
