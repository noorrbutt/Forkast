import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Text, View } from 'react-native';

import { StarRating } from '../../components/StarRating';
import {
  Button,
  Chip,
  Dialog,
  ErrorState,
  Field,
  Hero,
  HeroWash,
  Loading,
  Screen,
  ControlLabel,
  Select,
  type SelectOption,
} from '../../components/ui';
import { useCategories, useCuisines } from '../../hooks/useCatalog';
import { useDeleteLog, useLog, useRepeatLog, useUpdateLog } from '../../hooks/useLogs';
import {
  usePhotoPicker,
  usePhotoSource,
  useRemovePhoto,
  useSetPhoto,
} from '../../hooks/usePhoto';
import { describeError } from '../../lib/api';
import {
  FRIEND_LABELS,
  FUN_HINT,
  FUN_LEVELS,
  SERVING_LABELS,
  formatNumber,
} from '../../lib/format';
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

/**
 * One meal.
 *
 * THE ONE THING: the photograph of the meal, and when there is none, the
 * calorie figure as the screen's only `hero`. The screen answers "what was
 * this meal", so the answer leads and the form that can change it follows.
 *
 * Section 13 critique of what this replaced.
 *
 * 1. What it was. A card holding a heading and a 48pt number, a second card
 *    holding the photo control, a repeat button, then six form blocks and two
 *    full width buttons: a vertical stack titled "Edit log", with the eyebrow
 *    "Fix anything" over it.
 *
 * 2. Which rules it broke.
 *    - Section 6: the screen answers a single question and so must lead with a
 *      focal element, and it led with a form instead. The photograph, which is
 *      the actual answer and the only image this app has, sat in the second
 *      card down, inside a labelled control, at the same width and radius as
 *      the estimate card above it.
 *    - Section 4: the largest thing on the screen was `display` at 48, spent on
 *      a figure introduced by the words "Current estimate". `hero` at 64 was
 *      never used, so the screen had a second level and no first one.
 *    - Section 10: an icon beside the "Photo" heading, drawn from inside the
 *      photo control.
 *    - Section 2 repetition: 38 categories rendered as a wrapping wall of
 *      chips, when the guide says a choice among few is a chip and a choice
 *      among many is a `Select`. The log form had already moved to a `Select`,
 *      so the same choice was being made two ways on two screens.
 *    - Section 3 usability: Save was disabled until the form was valid, which
 *      is the exact pattern the guide calls the worst version of the rule, and
 *      it hid the affordance behind the action that invites it.
 *    - Section 3 accessibility: selecting a chip changed its fill and its
 *      border colour and nothing else, so selection was carried by colour
 *      alone.
 *    - Section 12: "Fix anything" is filler above a screen whose title already
 *      said what it was.
 *
 * 3. What the one thing is now. The photo, at the top, at the full width of
 *    the content column and nothing else near it. A meal with no photo leads
 *    with its calorie figure at `hero` on a wash instead, which is the one
 *    place on this screen a large field of colour is allowed, because exactly
 *    one meal and therefore exactly one cuisine is ever on screen here.
 *
 * 4. What was demoted, and why that is correct. The calorie figure drops to
 *    `displaySm` whenever there is a photo: it is a fact about the meal, not
 *    the meal. The estimate loses its card, because a single figure is not a
 *    group and does not need a surface of its own. The photo controls move
 *    below the form's fields, since taking a photo again is the rarest thing
 *    anyone does here and it does not deserve the top of the screen. The edit
 *    form keeps every field it had, under one heading that says plainly that
 *    it is the secondary half of the screen.
 */



/**
 * When the meal was eaten, in words.
 *
 * Long form rather than the diary's short date, because the diary has already
 * grouped the meal under a day heading and this screen has not: here it is the
 * only thing saying when this happened.
 */
function loggedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function MealScreen() {
  const { colors, layout, radius, spacing, type } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const log = useLog(id ?? null);
  const updateLog = useUpdateLog();
  const deleteLog = useDeleteLog();
  const repeat = useRepeatLog();

  const photo = usePhotoSource(log.data?.has_photo ? log.data.id : null);
  const { pick, preparing } = usePhotoPicker();
  const upload = useSetPhoto();
  const removePhoto = useRemovePhoto();

  /**
   * The guard that actually stops this meal being logged twice.
   *
   * isPending only reaches the button on the next render, and an impatient
   * second tap lands well inside that gap, so the disabled prop is the half of
   * this the user can see and the ref is the half that holds.
   */
  const repeating = useRef(false);

  // All categories, not the ones for a chosen cuisine: an edit starts from a
  // category that is already set, and re-picking the cuisine first would be a
  // step the user did not ask for.
  const categories = useCategories(null);
  // Only so a category can carry its cuisine as a searchable hint, which is
  // how the same field behaves on the log form.
  const cuisines = useCuisines();

  const [dishName, setDishName] = useState('');
  const [categoryId, setCategoryId] = useState<RefId | null>(null);
  const [area, setArea] = useState('');
  const [rating, setRating] = useState(4);
  const [funScale, setFunScale] = useState<number | null>(null);
  const [friendScale, setFriendScale] = useState<FriendScale | null>(null);
  const [servingSize, setServingSize] = useState<ServingSize>('medium');

  /** What the form is still missing, said in words when Save is pressed. */
  const [missing, setMissing] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingPhotoRemoval, setConfirmingPhotoRemoval] = useState(false);

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
    // Keyed on the id alone, deliberately. Adding log.data would re-seed on
    // every background refetch, wiping whatever the user had half-typed. The
    // cost is that an edit made on another device is not pulled into a form
    // that is already open, which is the ordinary last-write-wins a form has
    // anyway, and far cheaper than losing the edit in front of you.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.data?.id]);

  const cuisineById = useMemo(
    () => new Map((cuisines.data ?? []).map((cuisine) => [String(cuisine.id), cuisine])),
    [cuisines.data],
  );

  const current = log.data?.category ?? null;

  const categoryOptions = useMemo<SelectOption[]>(() => {
    const options: SelectOption[] = (categories.data ?? []).map((category) => ({
      value: String(category.id),
      label: category.name,
      // The cuisine rides along as the hint, so typing "Italian" finds every
      // Italian category. No colour dot: identity here is the name, and the
      // palette cannot separate ten cuisines sitting next to each other.
      hint: cuisineById.get(String(category.cuisine_id))?.name,
    }));

    // The catalogue can be slow or unreachable, and this meal already knows
    // which category it is in. Without this the field would say nothing at all
    // about a meal whose category is sitting right there in the payload.
    if (current && !options.some((option) => option.value === String(current.id))) {
      options.unshift({ value: String(current.id), label: current.name });
    }

    return options;
  }, [categories.data, cuisineById, current]);

  const selectedCategory = useMemo(
    () => (categories.data ?? []).find((c) => String(c.id) === String(categoryId)) ?? null,
    [categories.data, categoryId],
  );

  const save = () => {
    if (!id) return;

    const name = dishName.trim();
    // Live, never disabled into invisibility. A primary action that disappears
    // until the form is already correct hides the affordance behind the action
    // it is there to invite, so this one stays pressable and says what is
    // missing when it is pressed.
    if (name.length === 0 || categoryId === null) {
      setMissing(
        name.length === 0 && categoryId === null
          ? 'This needs a dish name and a category before it can be saved.'
          : name.length === 0
            ? 'This needs a dish name before it can be saved.'
            : 'This needs a category before it can be saved.',
      );
      haptics.error();
      return;
    }

    setMissing(null);

    // Only what actually changed. Sending the whole form would make the server
    // recompute the calorie estimate on every save, including saves that
    // touched nothing it depends on.
    const original = log.data;
    const patch: LogPatch = {};
    if (original) {
      if (name !== original.dish_name) patch.dish_name = name;
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

  const destroy = () => {
    if (!id) return;
    deleteLog.mutate(id, {
      onSuccess: () => {
        haptics.success();
        setConfirmingDelete(false);
        router.back();
      },
      onError: () => haptics.error(),
    });
  };

  const logAgain = () => {
    if (!id || repeating.current) return;
    repeating.current = true;
    repeat.mutate(id, {
      onSuccess: () => haptics.success(),
      onError: () => haptics.error(),
      onSettled: () => {
        repeating.current = false;
      },
    });
  };

  const photoBusy = preparing || upload.isPending || removePhoto.isPending;

  const attachPhoto = async (fromCamera: boolean) => {
    if (!id || photoBusy) return;

    try {
      const picked = await pick(fromCamera);
      // Null means the permission or the picker was declined, which is an
      // answer rather than a failure.
      if (!picked) return;

      await upload.mutateAsync({ logId: id, uri: picked.uri, mimeType: picked.mimeType });
      haptics.success();
    } catch {
      haptics.error();
    }
  };

  const dropPhoto = () => {
    if (!id) return;
    removePhoto.mutate(id, {
      onSuccess: () => {
        haptics.tap();
        setConfirmingPhotoRemoval(false);
      },
      onError: () => haptics.error(),
    });
  };

  if (log.isLoading) {
    return (
      <Screen title="Meal" onBack={() => router.back()}>
        <Loading label="Loading this meal" />
      </Screen>
    );
  }

  if (log.isError || !log.data) {
    return (
      <Screen title="Meal" onBack={() => router.back()}>
        <ErrorState
          title="Meal unavailable"
          message={describeError(log.error)}
          onRetry={() => void log.refetch()}
        />
      </Screen>
    );
  }

  const meal = log.data;
  const busy = updateLog.isPending || deleteLog.isPending || repeat.isPending;
  const hasPhoto = Boolean(meal.has_photo);
  const calories = formatNumber(meal.estimated_calories);
  const estimate = 'kcal, estimated from the dish and how much of it you had';
  const where = meal.restaurant?.name ?? (meal.area && meal.area.length > 0 ? meal.area : null);
  const when = [`Logged ${loggedAt(meal.created_at)}`, where].filter(Boolean).join(' · ');
  const photoError = upload.isError
    ? describeError(upload.error)
    : removePhoto.isError
      ? describeError(removePhoto.error)
      : null;

  return (
    <Screen title="Meal" onBack={() => router.back()}>
      <View
        style={{ width: '100%', maxWidth: layout.contentWidth, alignSelf: 'center', gap: spacing.xl }}
      >
        {hasPhoto ? (
          <View style={{ gap: spacing.lg }}>
            {/* The lead. No heading over it: a photograph of your own dinner
                does not need to be introduced, and a heading here would put a
                line of 16pt type above the one thing this screen is for. */}
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel={`Your photo of ${meal.dish_name}`}
              style={{
                aspectRatio: 4 / 3,
                borderRadius: radius.card,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surfaceAlt,
                overflow: 'hidden',
              }}
            >
              {photo ? (
                <Image
                  source={photo}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                  accessibilityIgnoresInvertColors
                />
              ) : null}
            </View>

            <View style={{ gap: spacing.xs }}>
              <Text style={[type.title, { color: colors.text }]}>{meal.dish_name}</Text>
              {/* A full step under `hero` and a full step over `title`. The
                  picture is the answer on this screen and the figure supports
                  it, which is the other way round from a meal with no photo. */}
              <Text style={[type.displaySm, { color: colors.text }]}>{calories}</Text>
              <Text style={[type.caption, { color: colors.muted }]}>{estimate}</Text>
              <Text style={[type.caption, { color: colors.muted }]}>{when}</Text>
            </View>
          </View>
        ) : (
          /* No photo, so the figure leads instead, on the one soft field of
             colour this app allows. Exactly one meal is ever on this screen,
             so a large area of colour here is never adjacent to another one. */
          <HeroWash>
            <Text style={[type.title, { color: colors.text }]}>{meal.dish_name}</Text>
            {/* The only thing on this screen that gets `xxxl`. That reservation
                is what makes it read as the hero before its size is
                considered. */}
            <View style={{ paddingTop: spacing.xl, paddingBottom: spacing.xxxl }}>
              <Hero value={calories} caption={estimate} />
            </View>
            <Text style={[type.caption, { color: colors.muted }]}>{when}</Text>
          </HeroWash>
        )}

        {/* Above the form on purpose. Repeating is a decision made on the way
            past, and under the fields it would sit behind an edit the user
            never came here to make. */}
        <View style={{ gap: spacing.sm }}>
          <Button
            label="Log this again"
            variant="secondary"
            size="lg"
            full
            icon="log"
            onPress={logAgain}
            loading={repeat.isPending}
            disabled={busy}
            accessibilityHint="Copies this meal onto today, with the time you tap it"
          />

          {/* A tap that only refetches something offscreen reads as a tap that
              did nothing, so the screen says what happened. */}
          {repeat.isSuccess ? (
            <Text style={[type.caption, { color: colors.success }]}>
              Logged again for today. It is on your dashboard and in your diary now.
            </Text>
          ) : null}
          {repeat.isError ? (
            <Text style={[type.caption, { color: colors.danger }]}>
              {describeError(repeat.error)}
            </Text>
          ) : null}
        </View>

        {/* Everything below here is the secondary half of the screen, and it
            says so in one heading rather than in an eyebrow over every block. */}
        <View style={{ gap: spacing.xl }}>
          <Text style={[type.title, { color: colors.text }]}>Edit this meal</Text>

          <Field
            label="Dish"
            value={dishName}
            onChangeText={(value) => {
              setDishName(value);
              if (missing) setMissing(null);
            }}
            placeholder="Chicken karahi"
          />

          {categories.isError && !categories.data ? (
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
              onChange={(value) => {
                setCategoryId(Number(value));
                if (missing) setMissing(null);
              }}
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
                  : 'Changing this re-estimates the calories.'
              }
              emptyText="No category by that name."
            />
          )}

          <Field
            label="Area"
            value={area}
            onChangeText={setArea}
            placeholder="Optional neighbourhood"
          />

          <View style={{ gap: spacing.md }}>
            <ControlLabel>Rating</ControlLabel>
            <StarRating value={rating} onChange={setRating} />
          </View>

          <View style={{ gap: spacing.md }}>
            <ControlLabel>Fun scale</ControlLabel>
            {/* Wraps, like every other chip row in the app. Five pills at a
                48pt minimum in a row that cannot wrap overflow the column on a
                narrow phone, and at a raised system text size on any phone. */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {FUN_LEVELS.map((level) => (
                <Chip
                  key={level}
                  label={String(level)}
                  selected={funScale === level}
                  showCheck
                  onPress={() => setFunScale(funScale === level ? null : level)}
                />
              ))}
            </View>
            <Text style={[type.caption, { color: colors.muted }]}>{FUN_HINT}</Text>
          </View>

          <View style={{ gap: spacing.md }}>
            <ControlLabel>Who was there</ControlLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {FRIEND_SCALES.map((scale) => (
                <Chip
                  key={scale}
                  label={FRIEND_LABELS[scale]}
                  selected={friendScale === scale}
                  showCheck
                  onPress={() => setFriendScale(friendScale === scale ? null : scale)}
                />
              ))}
            </View>
          </View>

          <View style={{ gap: spacing.md }}>
            <ControlLabel>Serving size</ControlLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {SERVING_SIZES.map((size) => (
                <Chip
                  key={size}
                  label={SERVING_LABELS[size]}
                  selected={servingSize === size}
                  showCheck
                  onPress={() => setServingSize(size)}
                />
              ))}
            </View>
          </View>

          {/* Last, and not at the top where it used to be. Changing the picture
              is the rarest thing anyone does here, and these three controls at
              the top of the screen would turn the one thing into a toolbar. */}
          <View style={{ gap: spacing.md }}>
            <ControlLabel>Photo</ControlLabel>
            {hasPhoto ? null : (
              <Text style={[type.caption, { color: colors.muted }]}>
                Optional. A picture turns a list of dishes into something worth looking back at.
              </Text>
            )}
            {/* The second copy of this row. See the note in MealPhoto: this
                screen does not use that component, it reimplements the control,
                so the same three buttons overflowed the same 342pt here and the
                fix has to be applied in both places or the screen the user
                named first stays broken.

                The variant also differs from MealPhoto's, which makes the
                primary button on the log form secondary here. That is correct
                on this screen: the meal already exists, so adding a photo is
                not the main action. */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: spacing.md,
              }}
            >
              <Button
                label={hasPhoto ? 'Retake' : 'Take a photo'}
                variant="secondary"
                compact
                onPress={() => void attachPhoto(true)}
                disabled={photoBusy}
                loading={preparing || upload.isPending}
              />
              <Button
                label="Choose"
                variant="secondary"
                compact
                onPress={() => void attachPhoto(false)}
                disabled={photoBusy}
              />
              {hasPhoto ? (
                <Button
                  label="Remove"
                  variant="ghost"
                  compact
                  onPress={() => setConfirmingPhotoRemoval(true)}
                  disabled={photoBusy}
                  loading={removePhoto.isPending}
                />
              ) : null}
            </View>
            {photoError ? (
              <Text style={[type.caption, { color: colors.danger }]}>{photoError}</Text>
            ) : null}
          </View>

          {missing ? (
            <Text style={[type.body, { color: colors.danger }]}>{missing}</Text>
          ) : null}
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
            disabled={busy}
          />

          <Button
            label="Delete this log"
            variant="danger"
            size="lg"
            full
            icon="trash"
            onPress={() => setConfirmingDelete(true)}
            disabled={busy}
          />
        </View>
      </View>

      {/* In a dialog on the page rather than an inline expansion, so the meal
          being deleted cannot scroll out of sight while it is confirmed. */}
      <Dialog
        visible={confirmingDelete}
        onDismiss={() => setConfirmingDelete(false)}
        title="Delete this log?"
        message="It comes off your dashboard and your streak, and there is no undo."
        actions={[
          {
            label: 'Delete this log',
            variant: 'danger',
            icon: 'trash',
            onPress: destroy,
            loading: deleteLog.isPending,
          },
          { label: 'Keep it', onPress: () => setConfirmingDelete(false) },
        ]}
      />

      <Dialog
        visible={confirmingPhotoRemoval}
        onDismiss={() => setConfirmingPhotoRemoval(false)}
        title="Remove this photo?"
        message="The meal itself stays in your diary."
        actions={[
          {
            label: 'Remove the photo',
            variant: 'danger',
            onPress: dropPhoto,
            loading: removePhoto.isPending,
          },
          { label: 'Keep it', onPress: () => setConfirmingPhotoRemoval(false) },
        ]}
      />
    </Screen>
  );
}
