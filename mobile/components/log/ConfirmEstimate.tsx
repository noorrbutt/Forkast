import type { ReactNode } from 'react';
import { Image, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Chip, ControlLabel, ErrorState, Field, FormError, Select } from '../ui';
import { describeError } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import type { PhotoEstimate } from '../../lib/types';
import { useTheme } from '../../theme';
import { elevation } from '../../theme/tokens';
import { useLogFormStyles } from './formStyles';
import { LogItButton } from './LogItButton';
import { scaledPhotoEstimate } from './photoEstimate';
import type { LogForm } from './useLogForm';

/** What the confirm screen says about how much to trust the guess. */
const CONFIDENCE_COPY: Record<PhotoEstimate['confidence'], string> = {
  high: 'photoConfidenceHigh',
  medium: 'photoConfidenceMedium',
  low: 'photoConfidenceLow',
};
const PORTION_LABEL_KEYS: Record<string, string> = {
  small: 'portionSmall',
  medium: 'portionMedium',
  large: 'portionLarge',
};

/**
 * The step after a photo is read: "Is this right?"
 *
 * Deliberately not a second copy of the manual form. It shows only what a
 * photo can answer for itself (the dish, a portion, a calorie preview) plus
 * the fastest way to a category, which a photo never carries. Saving goes
 * through the same submit() and the same POST /logs as the form, so a
 * photo-confirmed meal and a typed one are priced identically.
 */
export function ConfirmEstimate({
  form,
  estimate,
  servingSizeQuestion,
}: {
  form: LogForm;
  estimate: PhotoEstimate;
  /** Rendered by the screen so this step and the manual form share one. */
  servingSizeQuestion: ReactNode;
}) {
  const { t } = useTranslation();
  const { colors, isDark, radius, spacing, type } = useTheme();
  const { optionRow, optionChip, group } = useLogFormStyles();
  const {
    photo,
    setPhoto,
    setPhotoStatus,
    dishName,
    setDishName,
    categoryId,
    setCategoryId,
    setCuisineId,
    portionCalories,
    setPortionCalories,
    guessSearch,
    estimatePhoto,
    photoPicker,
    categories,
    categoryOptions,
    selectedCategory,
    chooseCategory,
    captureAndEstimate,
    createLog,
    setMode,
  } = form;

  // Same length gate the manual search uses, applied to the guess instead
  // of to what someone typed, so a one or two word guess with nothing
  // useful to match does not show an empty "Matches" heading over nothing.
  const guessResults = estimate.dish_guess.trim().length >= 2 ? guessSearch.data : undefined;

  const photoBusy = estimatePhoto.isPending || photoPicker.preparing;

  // The same scaling submit() sends, so what this screen shows is
  // provably what gets saved rather than two copies of the same arithmetic
  // that could quietly drift apart.
  const scaledPreview = scaledPhotoEstimate(estimate, portionCalories ?? estimate.calories);
  const previewCalories = scaledPreview.calories;
  const previewMacros = scaledPreview;

  return (
    <>
      <View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
        <Text style={[type.display, { color: colors.text }]}>{t('log.isThisRight')}</Text>
        <Text style={[type.body, { color: colors.muted }]}>
          {t(`log.${CONFIDENCE_COPY[estimate.confidence]}`)}
        </Text>
        {/* AI_PROVIDER not being "groq" is a deploy-config choice the
            server makes (a free demo with no Groq key is legitimate --
            see app.main's own startup warning), not something this
            screen can prevent. What it can do is make sure a stubbed
            guess is never mistaken for a real one: estimate_source
            travels with the response specifically so this label never
            depends on this build's own env vars agreeing with the
            server's. */}
        {estimate.estimate_source === 'local' ? (
          <Text
            accessibilityRole="text"
            accessibilityLabel={t('log.demoEstimateA11y')}
            style={[type.caption, { color: colors.muted }]}
          >
            {t('log.demoEstimate')}
          </Text>
        ) : null}
      </View>

      <View style={group}>
        {photo ? (
          <View style={{ gap: spacing.sm }}>
            {/* The one primary surface on this screen: full width, the
                large radius, and on light the same shadow Card reserves
                for a prominent surface (see Card's `prominent` prop).
                The photo just taken is the reason this screen exists, so
                it gets the same weight the diary gives a photo row
                rather than sitting as a preview beside the text. */}
            <View
              style={[
                {
                  borderRadius: radius.card,
                  overflow: 'hidden',
                  aspectRatio: 4 / 3,
                  backgroundColor: colors.surfaceAlt,
                },
                !isDark ? elevation.light : null,
              ]}
            >
              <Image
                source={{ uri: photo.uri }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
              />
            </View>
            {/* Retake and Choose replace the photo (and ask for a fresh
                estimate); Remove just drops it. Nothing else on this
                screen depends on the photo bytes once a dish and a
                category are picked, so removing it does not reset any of
                that. */}
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' }}
            >
              <Button
                label={t('log.retake')}
                variant="secondary"
                compact
                disabled={photoBusy}
                loading={photoBusy}
                onPress={() => void captureAndEstimate(true)}
              />
              <Button
                label={t('log.choose')}
                variant="secondary"
                compact
                disabled={photoBusy}
                onPress={() => void captureAndEstimate(false)}
              />
              <Button
                label={t('log.remove')}
                variant="ghost"
                compact
                disabled={photoBusy}
                onPress={() => {
                  setPhoto(null);
                  setPhotoStatus('none');
                }}
              />
            </View>
          </View>
        ) : null}

        <Field
          label={t('log.dish')}
          value={dishName}
          onChangeText={setDishName}
          placeholder={t('log.dishPlaceholder')}
        />

        {/* The fastest way to a category: the same dish search the manual
            form uses, run against the guess instead of against typing.
            Picking one of these is what actually resolves a category --
            the guess alone never does, since a photo has no category on
            it at all. */}
        {guessResults && guessResults.dishes.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <ControlLabel>{t('log.matchesThisDish')}</ControlLabel>
            <View style={optionRow}>
              {guessResults.dishes.slice(0, 4).map((dish, index) => (
                <Chip
                  key={`${dish.dish_name}-${index}`}
                  label={dish.dish_name}
                  selected={dishName === dish.dish_name && categoryId === dish.category_id}
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

        {guessResults && guessResults.categories.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <ControlLabel>{t('log.orCategory')}</ControlLabel>
            <View style={optionRow}>
              {guessResults.categories.slice(0, 4).map((category) => (
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

        {/* The chips above only ever cover what the guess happens to
            match, which is nothing for a dish this catalogue has no
            category for at all. This is the same Category field the
            manual form uses, so a category can always be picked here
            directly rather than only by bailing out to manual entry. */}
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
                ? t('log.categoryHint', {
                    minimum: formatNumber(selectedCategory.base_calorie_min),
                    maximum: formatNumber(selectedCategory.base_calorie_max),
                    junk: selectedCategory.is_junk ? t('log.countsAsJunk') : '',
                  })
                : t('log.categoryNoMatchHint')
            }
            disabled={categoryOptions.length === 0}
            emptyText={t('log.categoryEmpty')}
            copy={{
              closeLabel: t('log.close'),
              searchPlaceholder: t('log.search'),
              clearSearchLabel: t('log.clearSearch'),
              opensSearchableListHint: t('log.opensSearchableList'),
            }}
          />
        )}

        {servingSizeQuestion}

        {/* Shown instead of trusting a single guess when the photo gives
            no size reference to judge scale from -- a hand, a utensil, a
            plate edge. One tap and it is answered; nothing here opens a
            second screen or asks for a gram figure. */}
        {estimate.portion_ambiguous && estimate.portion_options.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <ControlLabel>{t('log.whichPortion')}</ControlLabel>
            <View style={optionRow}>
              {estimate.portion_options.map((option) => (
                <Chip
                  key={option.label}
                  label={t('log.portionOption', {
                    label:
                      PORTION_LABEL_KEYS[option.label.toLowerCase()] !== undefined
                        ? t(`log.${PORTION_LABEL_KEYS[option.label.toLowerCase()]}`)
                        : option.label,
                    calories: formatNumber(Math.round(option.calories)),
                  })}
                  selected={portionCalories === option.calories}
                  showCheck
                  style={optionChip}
                  onPress={() => setPortionCalories(option.calories)}
                />
              ))}
            </View>
            <Text style={[type.caption, { color: colors.muted }]}>
              {t('log.portionPhotoHint')}
            </Text>
          </View>
        ) : null}

        <View style={{ gap: spacing.xs }}>
          <Text style={[type.title, { color: colors.text }]}>
            {t('log.aboutCalories', { calories: formatNumber(Math.round(previewCalories)) })}
          </Text>
          <Text style={[type.caption, { color: colors.muted }]}>
            {t('log.macros', {
              protein: formatNumber(Math.round(previewMacros.protein_g)),
              carbs: formatNumber(Math.round(previewMacros.carbs_g)),
              fat: formatNumber(Math.round(previewMacros.fat_g)),
            })}
          </Text>
          <Text style={[type.caption, { color: colors.muted }]}>
            {t('log.estimatePreview')}
          </Text>
        </View>
      </View>

      {createLog.isError ? <FormError>{describeError(createLog.error)}</FormError> : null}

      <View style={{ gap: spacing.sm }}>
        <LogItButton form={form} />

        <Button
          label={t('log.editManually')}
          variant="ghost"
          size="lg"
          full
          onPress={() => setMode('manual')}
        />
      </View>
    </>
  );
}
