import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { MealPhoto } from '../MealPhoto';
import { StarRating } from '../StarRating';
import { Button, Chip, ControlLabel, ErrorState, Field, FormError, Loading, Select } from '../ui';
import { slotOf } from '../home/todayMeals';
import { useRamadan } from '../../hooks/useRamadan';
import { describeError } from '../../lib/api';
import { FUN_LEVELS, formatNumber } from '../../lib/format';
import { fastingWindow, rankForRamadanSlot } from '../../lib/ramadan';
import { FRIEND_SCALES } from '../../lib/types';
import { useTheme } from '../../theme';
import { useLogFormStyles } from './formStyles';
import { LogItButton } from './LogItButton';
import { PortionMultiplierControl } from './PortionMultiplierControl';
import type { LogForm } from './useLogForm';

/** A plain "s" plural is close enough for every unit the desi dish table
 * actually uses (roti, piece, katori, plate, cup, glass, serving). */
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
  const { t } = useTranslation();
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

  // Ramadan mode never changes the /dishes request itself -- only the order
  // the chips it returns are shown in, and only while the current slot is
  // actually sehri or iftar (not "late", and not outside Ramadan mode).
  const ramadan = useRamadan();
  const ramadanWindow = ramadan.enabled
    ? fastingWindow(new Date(), ramadan.city, ramadan.offsetMin)
    : null;
  const ramadanSlot = ramadanWindow ? slotOf(new Date(), ramadanWindow) : null;
  const rankedDishHints = rankForRamadanSlot(
    dishHints.data ?? [],
    ramadanSlot === 'sehri' || ramadanSlot === 'iftar' ? ramadanSlot : null,
  );
  const noMatches =
    Boolean(results) &&
    results?.dishes.length === 0 &&
    results?.categories.length === 0 &&
    !hasDesiHints;
  const unitKey: Record<string, string> = {
    roti: 'roti',
    piece: 'piece',
    katori: 'katori',
    plate: 'plate',
    cup: 'cup',
    glass: 'glass',
    serving: 'serving',
  };
  const portionUnit = dishHint
    ? unitKey[dishHint.unit.toLowerCase()]
      ? t(`log.servingUnits.${unitKey[dishHint.unit.toLowerCase()]}`)
      : dishHint.unit
    : '';

  return (
    <>
      {/* The largest type on the form, with a full step more space beneath
          it than between anything else. */}
      <View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
        <Text style={[type.display, { color: colors.text }]}>{t('log.whatDidYouEat')}</Text>
        <Text style={[type.body, { color: colors.muted }]}>
          {t('log.manualIntro')}
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
          label={t('log.dishName')}
          hint={t('log.dishHint')}
          value={dishName}
          onChangeText={setDishName}
          placeholder={t('log.dishPlaceholder')}
        />

        {search.isFetching ? <Loading label={t('log.searching')} /> : null}

        {noMatches ? (
          <Text style={[type.caption, { color: colors.muted }]}>
            {t('log.noMatchesYet')}
          </Text>
        ) : null}

        {/* Chips from the desi dish table, shown first: a dish this app
            already knows the typical range and unit for is a better match
            than a dish someone else merely happened to type the same way. */}
        {dishHints.data && dishHints.data.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <ControlLabel>{t('log.commonDesiDishes')}</ControlLabel>
            <View style={optionRow}>
              {rankedDishHints.slice(0, 8).map((hint) => (
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
            <ControlLabel>{t('log.portion')}</ControlLabel>
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
                {portionQty}{' '}
                {portionQty === 1
                  ? portionUnit
                  : t('log.servingUnits.plural', { unit: portionUnit, count: portionQty })}
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
            <ControlLabel>{t('log.dishesPeopleLogged')}</ControlLabel>
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
            <ControlLabel>{t('log.categories')}</ControlLabel>
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
            title={t('log.cuisinesUnavailable')}
            message={describeError(cuisines.error)}
            onRetry={() => void cuisines.refetch()}
          />
        ) : (
          <Select
            label={t('log.cuisine')}
            value={cuisineId === null ? null : String(cuisineId)}
            options={cuisineOptions}
            onChange={chooseCuisine}
            placeholder={cuisines.isLoading ? t('log.loadingCuisines') : t('log.anyCuisine')}
            hint={t('log.cuisineOptional')}
            disabled={!cuisines.data}
            emptyText={t('log.noCuisine')}
            copy={{
              closeLabel: t('log.close'),
              searchPlaceholder: t('log.search'),
              clearSearchLabel: t('log.clearSearch'),
              opensSearchableListHint: t('log.opensSearchableList'),
            }}
          />
        )}

        {categories.isError ? (
          <ErrorState
            title={t('log.categoriesUnavailable')}
            message={describeError(categories.error)}
            onRetry={() => void categories.refetch()}
          />
        ) : (
          <Select
            label={t('log.category')}
            value={categoryId === null ? null : String(categoryId)}
            options={categoryOptions}
            onChange={chooseCategory}
            placeholder={
              categories.isLoading
                ? t('log.loadingCategories')
                : t('log.searchCategories', { count: categoryOptions.length })
            }
            hint={
              selectedCategory
                ? t('log.categoryHintSelected', {
                    minimum: formatNumber(selectedCategory.base_calorie_min),
                    maximum: formatNumber(selectedCategory.base_calorie_max),
                    junk: selectedCategory.is_junk ? t('log.countsAsJunk') : '',
                  })
                : t('log.categoryHintDefault')
            }
            disabled={categoryOptions.length === 0}
            emptyText={t('log.categoryEmptyDefault')}
            copy={{
              closeLabel: t('log.close'),
              searchPlaceholder: t('log.search'),
              clearSearchLabel: t('log.clearSearch'),
              opensSearchableListHint: t('log.opensSearchableList'),
            }}
          />
        )}

        {/* A cuisine with nothing filed under it is a designed state, not a
            card: one sentence and the single button that gets out of it. */}
        {categories.data && visibleCategories.length === 0 ? (
          <View style={{ gap: spacing.md, alignItems: 'flex-start' }}>
            <Text style={[type.caption, { color: colors.muted }]}>
              {t('log.noCategoryForCuisine')}
            </Text>
            <Button
              label={t('log.searchEveryCategory')}
              variant="secondary"
              onPress={() => pickCuisine(null)}
            />
          </View>
        ) : null}

        {servingSizeQuestion}
        <PortionMultiplierControl
          value={form.portionMultiplier}
          onChange={form.setPortionMultiplier}
        />
      </View>

      <View style={group}>
        <Text style={[type.title, { color: colors.text }]}>{t('log.whereYouAte')}</Text>

        <View style={{ gap: spacing.md }}>
          <Field
            label={t('log.restaurant')}
            value={restaurantName}
            onChangeText={(value) => {
              setRestaurantName(value);
              setRestaurantId(null);
            }}
            placeholder={t('log.cookedPlaceholder')}
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
          label={t('log.area')}
          value={area}
          onChangeText={setArea}
          placeholder={t('log.neighbourhoodPlaceholder')}
        />
      </View>

      <View style={group}>
        <Text style={[type.title, { color: colors.text }]}>{t('log.howItWas')}</Text>

        <View style={{ gap: spacing.sm }}>
          <ControlLabel>{t('log.rating')}</ControlLabel>
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
            <Text style={[type.caption, { color: colors.muted }]}>
              {t('log.ratingValue', { rating })}
            </Text>
          </View>
        </View>

        <View style={{ gap: spacing.sm }}>
          <ControlLabel>{t('log.funScale')}</ControlLabel>
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
          <Text style={[type.caption, { color: colors.muted }]}>{t('log.funHint')}</Text>
        </View>

        <View style={{ gap: spacing.sm }}>
          <ControlLabel>{t('log.whoWasThere')}</ControlLabel>
          <View style={optionRow}>
            {FRIEND_SCALES.map((scale) => (
              <Chip
                key={scale}
                label={t(
                  scale === 'solo'
                    ? 'log.friendSolo'
                    : scale === 'small_group'
                      ? 'log.friendSmallGroup'
                      : 'log.friendSquad',
                )}
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
      <MealPhoto
        photo={photo}
        onPhotoChange={setPhoto}
        copy={{
          label: t('log.photo'),
          mealPhotoLabel: t('log.mealPhoto'),
          removePhotoHint: t('log.removePhotoHint'),
          pendingHint: t('log.photoOptional'),
          removeTitle: t('log.photoRemoveTitle'),
          removeMessage: t('log.photoRemoveMessage'),
          removeAction: t('log.remove'),
          keepAction: t('log.keepPhoto'),
          actions: {
            takePhoto: t('log.takePhotoAction'),
            retake: t('log.retake'),
            choose: t('log.choose'),
            remove: t('log.remove'),
          },
        }}
      />

      {createLog.isError ? (
        <FormError>{describeError(createLog.error)}</FormError>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        <LogItButton form={form} />
      </View>
    </>
  );
}
