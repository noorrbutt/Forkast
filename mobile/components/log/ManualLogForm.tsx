import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { MealPhoto } from '../MealPhoto';
import { StarRating } from '../StarRating';
import { Button, Chip, ControlLabel, ErrorState, Field, FormError, Loading, Select } from '../ui';
import { describeError } from '../../lib/api';
import { FRIEND_LABELS, FUN_HINT, FUN_LEVELS, formatNumber } from '../../lib/format';
import { FRIEND_SCALES } from '../../lib/types';
import { useTheme } from '../../theme';
import { useLogFormStyles } from './formStyles';
import { LogItButton } from './LogItButton';
import type { LogForm } from './useLogForm';

/** A plain "s" plural is close enough for every unit the desi dish table
 * actually uses (roti, piece, katori, plate, cup, glass, serving). */
function pluralUnit(unit: string, qty: number): string {
  return qty === 1 ? unit : `${unit}s`;
}

/**
 * The typed-in path: "What did you eat?" as the screen's largest text, then
 * three groups -- what you ate, where you ate it, how it was -- and the photo.
 *
 * Serving size sits in the first group beside the category, because those
 * two together are the whole calorie estimate: the category gives the range
 * and the serving multiplies it.
 */
export function ManualLogForm({
  form,
  servingSizeQuestion,
}: {
  form: LogForm;
  /** Rendered by the screen so this form and the confirm step share one. */
  servingSizeQuestion: ReactNode;
}) {
  const { colors, spacing, type } = useTheme();
  const { optionRow, optionChip, group } = useLogFormStyles();
  const {
    search,
    estimateNotice,
    dishName,
    setDishName,
    categoryId,
    setCategoryId,
    cuisineId,
    setCuisineId,
    dishHints,
    dishHint,
    portionQty,
    chooseDishHint,
    changePortionQty,
    cuisines,
    cuisineOptions,
    chooseCuisine,
    categories,
    categoryOptions,
    visibleCategories,
    selectedCategory,
    chooseCategory,
    pickCuisine,
    restaurantName,
    setRestaurantName,
    restaurantId,
    setRestaurantId,
    restaurants,
    area,
    setArea,
    rating,
    setRating,
    funScale,
    setFunScale,
    friendScale,
    setFriendScale,
    photo,
    setPhoto,
    createLog,
  } = form;

  // Results only count once the dish name is long enough to have produced
  // them, so this is undefined (not merely falsy) while someone is still
  // typing the first letter -- and, defensively, while a query has resolved
  // with no data of its own to report, which `search.data` can genuinely be
  // null for. Held in one const so the blocks below narrow off it; every
  // read below goes through `results?.` or `results &&` rather than
  // assuming it is either present or exactly undefined, the same guard
  // ConfirmEstimate's own guessResults already uses for the identical shape.
  const results = dishName.trim().length >= 2 ? search.data : undefined;
  const hasDesiHints = Boolean(dishHints.data && dishHints.data.length > 0);
  const noMatches =
    Boolean(results) &&
    results?.dishes.length === 0 &&
    results?.categories.length === 0 &&
    !hasDesiHints;

  return (
    <>
      {/* The largest type on the form, with a full step more space beneath
          it than between anything else. */}
      <View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
        <Text style={[type.display, { color: colors.text }]}>What did you eat?</Text>
        <Text style={[type.body, { color: colors.muted }]}>
          Search what people have already logged, or name the dish and pick the category it
          belongs to. The category and the serving size are what Forkast estimates the calories
          from.
        </Text>
      </View>

      {/* Only ever set by a failed photo estimate landing here on its own,
          see captureAndEstimate. Cleared by resetForm, not by anything on
          this screen, so it survives exactly as long as it takes to notice
          it and does not vanish the moment a field is touched. */}
      {estimateNotice ? <FormError>{estimateNotice}</FormError> : null}

      {/* Group one: the meal, and the two answers the estimate is built out
          of. No heading, because the question above it is the heading. */}
      <View style={group}>
        {/* One field, one job: what you ate, in your own words, which is
            what gets saved. It used to be two fields -- a lookup that only
            filled in a suggestion and a separate name that was actually
            saved -- asking the same question twice. Typing here both names
            the meal and drives the suggestions below it; picking one of
            those additionally fills the category, which free text typed
            with no pick never touches. */}
        <Field
          label="Dish name"
          hint="Start typing to see dishes others have logged, or just describe this one."
          value={dishName}
          onChangeText={setDishName}
          placeholder="Chicken karahi"
        />

        {search.isFetching ? <Loading label="Searching" /> : null}

        {noMatches ? (
          <Text style={[type.caption, { color: colors.muted }]}>
            Nothing matched yet. Forkast only knows the dishes people have logged so far -- keep
            typing and pick the category it belongs to below.
          </Text>
        ) : null}

        {/* Chips from the desi dish table, shown first: a dish this app
            already knows the typical range and unit for is a better match
            than a dish someone else merely happened to type the same way. */}
        {dishHints.data && dishHints.data.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <ControlLabel>Common desi dishes</ControlLabel>
            <View style={optionRow}>
              {dishHints.data.slice(0, 8).map((hint) => (
                <Chip
                  key={hint.name}
                  label={hint.name}
                  selected={dishHint?.name === hint.name}
                  showCheck
                  style={optionChip}
                  onPress={() => chooseDishHint(hint)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {/* The portion stepper: only once a desi dish chip is selected, in
            that dish's own unit rather than small/medium/large, which the
            serving size question below still answers on its behalf. */}
        {dishHint && portionQty !== null ? (
          <View style={{ gap: spacing.sm }}>
            <ControlLabel>Portion</ControlLabel>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
              }}
            >
              <Button
                label="-"
                variant="secondary"
                onPress={() => changePortionQty(portionQty - 1)}
              />
              <Text style={[type.body, { color: colors.text }]}>
                {portionQty} {pluralUnit(dishHint.unit, portionQty)}
              </Text>
              <Button
                label="+"
                variant="secondary"
                onPress={() => changePortionQty(portionQty + 1)}
              />
            </View>
          </View>
        ) : null}

        {/* Dishes and categories from the catalog search, driven by the
            same dish name field above. Results sit directly under it with no
            heading surface of their own -- both the desi chips above and
            these would be saying the obvious. */}
        {results && results.dishes.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <ControlLabel>Dishes people logged</ControlLabel>
            <View style={optionRow}>
              {results.dishes.slice(0, 8).map((dish, index) => (
                <Chip
                  key={`${dish.dish_name}-${index}`}
                  label={dish.dish_name}
                  selected={dishName === dish.dish_name}
                  showCheck
                  style={optionChip}
                  onPress={() => {
                    setDishName(dish.dish_name);
                    setCategoryId(dish.category_id);
                  }}
                />
              ))}
            </View>
          </View>
        ) : null}

        {results && results.categories.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <ControlLabel>Categories</ControlLabel>
            <View style={optionRow}>
              {results.categories.slice(0, 8).map((category) => (
                <Chip
                  key={String(category.id)}
                  label={category.name}
                  selected={String(categoryId) === String(category.id)}
                  showCheck
                  style={optionChip}
                  onPress={() => {
                    setCuisineId(category.cuisine_id);
                    setCategoryId(category.id);
                  }}
                />
              ))}
            </View>
          </View>
        ) : null}

        {/* Ten cuisines and thirty eight categories. As chips that is a wall
            of tiny text with no way to search it, so both are fields that
            open a searchable list. */}
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

        {/* A cuisine with nothing filed under it is a designed state, not a
            card: one sentence and the single button that gets out of it. */}
        {categories.data && visibleCategories.length === 0 ? (
          <View style={{ gap: spacing.md, alignItems: 'flex-start' }}>
            <Text style={[type.caption, { color: colors.muted }]}>
              Nothing is filed under this cuisine yet, and the category is what the estimate is
              built from.
            </Text>
            <Button
              label="Search every category"
              variant="secondary"
              onPress={() => pickCuisine(null)}
            />
          </View>
        ) : null}

        {servingSizeQuestion}
      </View>

      <View style={group}>
        <Text style={[type.title, { color: colors.text }]}>Where you ate it</Text>

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

        <Field
          label="Area"
          value={area}
          onChangeText={setArea}
          placeholder="Optional neighbourhood"
        />
      </View>

      <View style={group}>
        <Text style={[type.title, { color: colors.text }]}>How it was</Text>

        <View style={{ gap: spacing.sm }}>
          <ControlLabel>Rating</ControlLabel>
          {/* The stars keep the left edge every heading and field uses, and
              the count takes the right, so the row ends where the column does
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

        <View style={{ gap: spacing.sm }}>
          <ControlLabel>Fun scale</ControlLabel>
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
          {/* The ends said in words. Five numerals on their own are a scale
              nobody has defined, and every other choice on this form says
              what it means. */}
          <Text style={[type.caption, { color: colors.muted }]}>{FUN_HINT}</Text>
        </View>

        <View style={{ gap: spacing.sm }}>
          <ControlLabel>Who was there</ControlLabel>
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
      </View>

      {/* No log id yet, so the picked file waits here and goes up the moment
          the meal is created. */}
      <MealPhoto photo={photo} onPhotoChange={setPhoto} />

      {createLog.isError ? (
        <FormError>{describeError(createLog.error)}</FormError>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        <LogItButton form={form} />
      </View>
    </>
  );
}
