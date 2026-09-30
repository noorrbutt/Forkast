import axios from 'axios';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { MealPhoto } from '../../components/MealPhoto';
import { StarRating } from '../../components/StarRating';
import { Button, Card, Chip, ControlLabel, ErrorState, EstimateSourceLabel, Field, FormError, Hero, Loading, Screen, Select, type SelectOption } from '../../components/ui';
import { useCategories, useCuisines, useSearch } from '../../hooks/useCatalog';
import { useEstimatorSource } from '../../hooks/useHealth';
import { useCreateLog } from '../../hooks/useLogs';
import { useEstimatePhoto, useSetPhoto, usePhotoPicker, type PickedPhoto } from '../../hooks/usePhoto';
import { useRestaurants } from '../../hooks/useRestaurants';
import { describeError } from '../../lib/api';
import { haptics } from '../../lib/haptics';
import {
  FRIEND_LABELS,
  FUN_HINT,
  FUN_LEVELS,
  SERVING_LABELS,
  formatNumber,
  saveReaction,
} from '../../lib/format';
import {
  FRIEND_SCALES,
  SERVING_SIZES,
  type FoodLog,
  type FriendScale,
  type PhotoEstimate,
  type RefId,
  type Uuid,
  type LogInput,
  type ServingSize,
} from '../../lib/types';
import { useTheme } from '../../theme';
import { motion } from '../../theme/motion';
import { elevation } from '../../theme/tokens';

/**
 * Logging a meal, and the one screen state that follows it.
 *
 * THE ONE THING, while the form is being filled in: the question "What did you
 * eat?" at `display`, with the two controls that answer it directly underneath.
 * Everything below that is a step of the type scale quieter and a step of the
 * spacing scale closer together.
 *
 * THE ONE THING, once the meal is saved: the estimate, as the only `hero` in
 * this file. The two states are mutually exclusive renders of one component, so
 * the screen still only ever shows one hero.
 *
 * Section 13 critique of what this replaced.
 *
 * 1. What it was. One capped column holding fifteen top level blocks at a
 *    single gap of 24: four cards, four text fields, two pickers and four rows
 *    of chips, each of the last five introduced by a heading with an icon
 *    beside it. Nothing on it was larger than 16 until the meal had been saved.
 *
 * 2. Which rules it broke.
 *    - Section 2 contrast, and the first composition line of Section 14: the
 *      largest type anywhere on the form was `subtitle` at 16, which is also
 *      what every field label, chip and button used. The gap between the first
 *      and second element was zero steps against a floor of one full step, so
 *      there was nothing for the eye to land on and no honest answer to "what
 *      is the one thing".
 *    - Section 10: an icon beside all seven headings, through the local
 *      IconLabel helper. Estimated, How a log works, Matches, Rating, Fun
 *      scale, Who was there and Serving size.
 *    - Section 6: four cards on a screen that is one task. The explainer card,
 *      the matches card and both empty states were surfaces around content that
 *      needed no surface of its own, and a card around a chip row is what turns
 *      a form into a stack.
 *    - Section 3 usability: the primary action shipped `disabled={!canSubmit}`.
 *      The guide names this exactly, "MUST NOT disable the primary action of a
 *      form until the form is valid", and calls hiding the affordance behind
 *      the action it invites the worst version of it.
 *    - Section 5: all fifteen blocks were separated by the same 24, so the gap
 *      inside a group equalled the gap around it and the grouping said nothing.
 *      Serving size sat four blocks away from the category even though those
 *      two together are the whole calorie estimate.
 *    - Section 10 again: both empty states passed an icon to `Empty`, which
 *      draws it on a 56pt accent disc.
 *    - Section 12: the header wore "Nice one" as an eyebrow, which does no job.
 *
 * 3. What the one thing is now. The question the form asks, at 48 over a body
 *    line that says how the estimate is arrived at, with 32 of space beneath it
 *    against 24 everywhere else. After a save it is the estimate at 64, alone
 *    in the top third with 48 above and below it.
 *
 * 4. What was demoted or cut, and why that is correct.
 *    Demoted: the seven headings. Four became the same 12/500 sentence case
 *    label that Field and Select already print above themselves, because a row
 *    of chips is a question of exactly the same rank as a text input and
 *    dressing it as a section made every question look like a section. The
 *    other three are gone: search results under a search field, and a photo
 *    picker with a photo in it, are obvious from their content.
 *    Demoted: the form itself, from fifteen blocks to four groups, "what you
 *    ate", "where you ate it", "how it was" and the photo, with serving size
 *    moved up beside the category it scales.
 *    Cut: the three step explainer card, replaced by one line under the
 *    question that stays put rather than vanishing at the first tap, and the
 *    two `Empty` cards, replaced by a sentence and the one button that fixes
 *    the situation.
 *
 * A third state, ahead of both of the above: the camera. This screen used to
 * open directly on the form; it now opens on a capture screen instead, since a
 * photo is the fastest way to log a meal and typing one in is the deliberate
 * fallback rather than the default. The one thing there is the same question
 * this screen has always asked, "What did you eat?", answered by a button
 * instead of a field. A photo hands back a guess with no category attached to
 * it yet, so it opens a fourth state, confirm, which is deliberately not a
 * second copy of the form: it shows only what a photo can answer for itself
 * (the dish, a portion, a calorie preview) plus the fastest way to pick a
 * category, which is the same dish search the form already has, run against
 * the guess instead of against what someone typed. Saving from there still
 * goes through the exact same submit() and the exact same POST /logs the form
 * uses, so a photo-confirmed meal and a typed one are priced identically.
 *
 * Why the estimate is NOT a hero on the form.
 *
 * It was the obvious candidate and it is the wrong call twice over. The number
 * does not exist yet: the server picks a value inside the category's range and
 * only then multiplies it by the serving size, so the most the client can
 * honestly say before submitting is a range. The style guide requires a hero to
 * be a number or a short headline, and a range is neither. Second, a 64pt
 * figure that appears only once a category is chosen would take the top of the
 * hierarchy away from the controls mid task and shove every remaining field
 * down under the reader's finger at the moment they are using it. The range
 * lives where it is acted on instead, as the hint under the category picker,
 * which is also what this screen's tests assert. Once the meal is saved the
 * number is real and the screen has nothing else to say, and that is where the
 * hero goes.
 */


/** Stands for "no cuisine filter". Never collides with an id, which is numeric. */
const ANY_CUISINE = 'any';

/** What the confirm screen says about how much to trust the guess. */
const CONFIDENCE_COPY: Record<PhotoEstimate['confidence'], string> = {
  high: 'Forkast is fairly sure about this one.',
  medium: 'A decent guess, worth a glance before you log it.',
  low: 'Not very sure about this one. Take a look before logging it.',
};

/**
 * The calories and macros a photo estimate actually shows, portion chip
 * included, in one place -- so the confirm screen's preview and submit's
 * saved payload can never drift apart on the scaling arithmetic between them.
 * Picking "large" has to move both the headline number and the macro line by
 * the same ratio, since the model's macros describe its own single guess, not
 * whichever portion chip ends up chosen.
 */
function scaledPhotoEstimate(estimate: PhotoEstimate, chosenCalories: number) {
  const scale = estimate.calories > 0 ? chosenCalories / estimate.calories : 1;
  return {
    calories: chosenCalories,
    protein_g: estimate.macros.protein_g * scale,
    carbs_g: estimate.macros.carbs_g * scale,
    fat_g: estimate.macros.fat_g * scale,
  };
}

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

/** Where the photo has got to, given it can only be sent once the log exists. */
type PhotoStatus = 'none' | 'uploading' | 'attached' | 'failed';

export default function LogScreen() {
  const { colors, isDark, layout, radius, spacing, type } = useTheme();
  const router = useRouter();
  const estimatorSource = useEstimatorSource();

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
  // The screen opens on the camera and only ever leaves it forward, to
  // confirm or to manual, or back to itself on "Log another". Nothing sends
  // it back to capture from manual: once someone has chosen to type, forcing
  // them back through the camera on the next field would be the app
  // second-guessing a choice it already asked for.
  const [mode, setMode] = useState<'capture' | 'confirm' | 'manual'>('capture');
  const [estimate, setEstimate] = useState<PhotoEstimate | null>(null);
  const [estimateNotice, setEstimateNotice] = useState<string | null>(null);
  // Which of estimate.portion_options was tapped, null until one is. Only
  // ever meaningful while estimate.portion_ambiguous is true; the calorie and
  // macro preview falls back to estimate's own single guess otherwise, so
  // nothing downstream has to check portion_ambiguous a second time.
  const [portionCalories, setPortionCalories] = useState<number | null>(null);
  // The one entrance this screen ever plays. Keyed on the saved log's id
  // rather than firing from onSuccess directly, so it also fires correctly if
  // this state is ever restored rather than only just set, and so it cannot
  // replay on an unrelated re-render while the hero is already on screen.
  const heroScale = useSharedValue(0);
  useEffect(() => {
    if (!saved) return;
    heroScale.value = 0;
    heroScale.value = withSpring(1, motion.celebrate);
  }, [saved, heroScale]);
  const heroAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heroScale.value }],
  }));
  const clientIdRef = useRef<string | null>(null);
  const ensureClientId = () => {
    if (clientIdRef.current === null) {
      clientIdRef.current = Crypto.randomUUID();
    }
    return clientIdRef.current;
  };
  ensureClientId();
  // Whether "Log it" has been pressed on a form that was not ready. The button
  // stays live either way; this only decides whether the line under it is said
  // quietly or urgently.
  const [refused, setRefused] = useState(false);

  const cuisines = useCuisines();
  // Every category, once, rather than a fetch per cuisine. Choosing a category
  // sets the cuisine it belongs to, and refetching at that exact moment would
  // empty the list under the field that had just been filled in.
  const categories = useCategories(null);
  const search = useSearch(query);
  // A second, independent search against whatever a photo guessed, so the
  // confirm screen can offer the same quick dish/category chips the form
  // already has without the two queries fighting over one piece of state.
  const guessSearch = useSearch(estimate?.dish_guess ?? '');
  const restaurants = useRestaurants(restaurantName);
  const createLog = useCreateLog();
  const uploadPhoto = useSetPhoto();
  const estimatePhoto = useEstimatePhoto();
  const photoPicker = usePhotoPicker();

  const selectedCategory = useMemo(
    () => (categories.data ?? []).find((category) => String(category.id) === String(categoryId)) ?? null,
    [categories.data, categoryId],
  );

  const cuisineOptions = useMemo<SelectOption[]>(
    () => [
      { value: ANY_CUISINE, label: 'Any cuisine', hint: 'Search every category' },
      // No colour dot. Cuisine identity is the emoji plus the name: the ten
      // generated cuisine colours failed the palette validator on three of six
      // checks, worst adjacent pair 9.3 against a normal vision floor of 15 and
      // 5.8 deutan against a floor of 8, and a picker is exactly where two of
      // them end up side by side.
      ...(cuisines.data ?? []).map((cuisine) => ({
        value: String(cuisine.id),
        label: cuisine.name,
        emoji: cuisine.emoji ?? undefined,
      })),
    ],
    [cuisines.data],
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
        };
      }),
    [visibleCategories, cuisineById],
  );

  const resetForm = () => {
    clientIdRef.current = Crypto.randomUUID();
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
    setRefused(false);
    setMode('capture');
    setEstimate(null);
    setEstimateNotice(null);
    setPortionCalories(null);
    createLog.reset();
    uploadPhoto.reset();
    estimatePhoto.reset();
  };

  /**
   * Take or choose a photo, then read it, then land on the confirm screen.
   *
   * A declined permission or a cancelled picker hands back null and is not an
   * error: the person changed their mind, and the capture screen just sits
   * there with its buttons still live. A 429 gets its own message and drops
   * straight to the manual form rather than leaving someone stuck on a
   * screen whose one button just told them no.
   */
  const captureAndEstimate = async (fromCamera: boolean) => {
    setEstimateNotice(null);
    const picked = await photoPicker.pick(fromCamera);
    if (!picked) return;
    setPhoto(picked);

    estimatePhoto.mutate(picked, {
      onSuccess: (result) => {
        haptics.tap();
        setEstimate(result);
        setPortionCalories(null);
        setDishName(result.dish_guess);
        setMode('confirm');
      },
      onError: (error) => {
        haptics.error();
        if (axios.isAxiosError(error) && error.response?.status === 429) {
          setEstimateNotice("You've hit the photo-scan limit for now, try typing this one in.");
          setMode('manual');
          return;
        }
        setEstimateNotice(describeError(error));
      },
    });
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

  /**
   * What the form still needs, in the order the controls appear.
   *
   * Worked out whether or not anybody has pressed anything, because the button
   * is never disabled and a reader has to be able to see what is outstanding
   * without first pressing a control to find out.
   */
  const gaps = [
    dishName.trim().length === 0 ? 'a dish name' : null,
    categoryId === null ? 'a category' : null,
  ].filter((gap): gap is string => gap !== null);

  const outstanding = gaps.length === 0 ? null : `Still needs ${gaps.join(' and ')}.`;

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
    if (createLog.isPending) return;

    // The button was live, so a press on an unfinished form is answered by
    // saying what is missing rather than by having been unpressable.
    if (categoryId === null || gaps.length > 0) {
      setRefused(true);
      haptics.error();
      return;
    }
    setRefused(false);

    const input: LogInput = {
      dish_name: dishName.trim(),
      category_id: categoryId,
      rating,
      serving_size: servingSize,
      client_id: ensureClientId(),
    };
    if (funScale !== null) input.fun_scale = funScale;
    if (friendScale !== null) input.friend_scale = friendScale;
    if (restaurantId !== null) input.restaurant_id = restaurantId;
    else if (restaurantName.trim().length > 0) input.restaurant_name = restaurantName.trim();
    if (area.trim().length > 0) input.area = area.trim();

    // The number the confirm screen actually showed. Sent whenever a photo
    // estimate exists in state at all, not only while still on the confirm
    // screen, since switching to manual entry to fix a detail should not also
    // throw away a calorie figure the photo already answered.
    if (estimate) {
      const scaled = scaledPhotoEstimate(estimate, portionCalories ?? estimate.calories);
      input.estimated_calories = Math.round(scaled.calories);
      input.protein_g = scaled.protein_g;
      input.carbs_g = scaled.carbs_g;
      input.fat_g = scaled.fat_g;
    }

    createLog.mutate(input, {
      // The moment worth celebrating, and the only success haptic in the app.
      onSuccess: (log) => {
        haptics.success();
        clientIdRef.current = null;
        setSaved(log);
        if (photo) void attachPhoto(log.id, photo);
      },
      onError: () => haptics.error(),
    });
  };

  /** The centred, capped column every screen state lays itself out in. */
  const column = {
    width: '100%' as const,
    maxWidth: layout.formWidth,
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

  /**
   * A group of questions. Inside is 16 and around is 24, which is the proximity
   * rule: the gap inside a group is a full step smaller than the gap outside.
   * Inside a single question, label to control, it drops again to 8.
   */
  const group = { gap: spacing.lg };

  if (saved) {
    return (
      // No frosted header here on purpose. A bar reading "Logged" above a 64pt
      // figure that already says so would be the same statement twice, and it
      // would eat the top third the hero is meant to own.
      <Screen>
        <View style={column}>
          <Animated.View
            style={[
              {
                alignItems: 'center',
                // The only xxxl in this file. That reservation is what makes this
                // read as the hero before its size is even considered.
                paddingTop: spacing.xxl,
                paddingBottom: spacing.xxxl,
              },
              heroAnimatedStyle,
            ]}
          >
            <Hero
              value={formatNumber(saved.estimated_calories)}
              caption={`kcal for ${saved.dish_name}${saved.restaurant ? ` at ${saved.restaurant.name}` : ''
                }`}
              align="center"
            />
            <EstimateSourceLabel source={estimatorSource.data} />
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
                <Button
                  label="Try the photo again"
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

  if (mode === 'capture') {
    const busy = photoPicker.preparing || estimatePhoto.isPending;

    return (
      <Screen title="Log a meal">
        <View style={column}>
          <View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
            <Text style={[type.display, { color: colors.text }]}>What did you eat?</Text>
            <Text style={[type.body, { color: colors.muted }]}>
              Snap a photo and Forkast guesses the dish, the portion and the calories. Typing it in
              yourself works just as well.
            </Text>
          </View>

          {busy ? <Loading label="Looking at your photo" /> : null}
          {estimateNotice ? <FormError>{estimateNotice}</FormError> : null}

          <View style={{ gap: spacing.md }}>
            <Button
              label="Take a photo"
              icon="camera"
              size="lg"
              full
              loading={busy}
              onPress={() => void captureAndEstimate(true)}
            />
            <Button
              label="Choose from library"
              variant="secondary"
              size="lg"
              full
              disabled={busy}
              onPress={() => void captureAndEstimate(false)}
            />
            <Button
              label="Type it in instead"
              variant="ghost"
              size="lg"
              full
              disabled={busy}
              onPress={() => {
                setEstimateNotice(null);
                setMode('manual');
              }}
            />
          </View>
        </View>
      </Screen>
    );
  }

  if (mode === 'confirm' && estimate) {
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
      <Screen title="Log a meal" onBack={resetForm}>
        <View style={column}>
          <View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
            <Text style={[type.display, { color: colors.text }]}>Is this right?</Text>
            <Text style={[type.body, { color: colors.muted }]}>
              {CONFIDENCE_COPY[estimate.confidence]}
            </Text>
          </View>

          <View style={group}>
            {photo ? (
              <View style={{ gap: spacing.sm }}>
                {/* The one primary surface on this screen: full width, the
                    large radius, and on light the same shadow Card reserves
                    for a prominent surface (see Card's `prominent` prop).
                    The photo just taken is the reason this screen exists, so
                    it gets the same weight the diary now gives a photo row
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
                    label="Retake"
                    variant="secondary"
                    compact
                    disabled={photoBusy}
                    loading={photoBusy}
                    onPress={() => void captureAndEstimate(true)}
                  />
                  <Button
                    label="Choose"
                    variant="secondary"
                    compact
                    disabled={photoBusy}
                    onPress={() => void captureAndEstimate(false)}
                  />
                  <Button
                    label="Remove"
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
              label="Dish"
              value={dishName}
              onChangeText={setDishName}
              placeholder="Chicken karahi"
            />

            {/* The fastest way to a category: the same dish search the manual
                form uses, run against the guess instead of against typing.
                Picking one of these is what actually resolves a category --
                the guess alone never does, since a photo has no category on
                it at all. */}
            {guessResults && guessResults.dishes.length > 0 ? (
              <View style={{ gap: spacing.sm }}>
                <ControlLabel>Matches this dish</ControlLabel>
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
                <ControlLabel>Or the category</ControlLabel>
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
                    : 'Nothing above matching? Search the full list.'
                }
                disabled={categoryOptions.length === 0}
                emptyText="Nothing matches that. Try a cuisine, for example Continental."
              />
            )}

            <View style={{ gap: spacing.sm }}>
              <ControlLabel>Serving size</ControlLabel>
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

            {/* Shown instead of trusting a single guess when the photo gives
                no size reference to judge scale from -- a hand, a utensil, a
                plate edge. One tap and it is answered; nothing here opens a
                second screen or asks for a gram figure. */}
            {estimate.portion_ambiguous && estimate.portion_options.length > 0 ? (
              <View style={{ gap: spacing.sm }}>
                <ControlLabel>Which portion is closest?</ControlLabel>
                <View style={optionRow}>
                  {estimate.portion_options.map((option) => (
                    <Chip
                      key={option.label}
                      label={`${option.label} (~${formatNumber(Math.round(option.calories))} kcal)`}
                      selected={portionCalories === option.calories}
                      showCheck
                      style={optionChip}
                      onPress={() => setPortionCalories(option.calories)}
                    />
                  ))}
                </View>
                <Text style={[type.caption, { color: colors.muted }]}>
                  Hard to tell the portion from the photo alone. Pick the closest one.
                </Text>
              </View>
            ) : null}

            <View style={{ gap: spacing.xs }}>
              <Text style={[type.title, { color: colors.text }]}>
                About {formatNumber(Math.round(previewCalories))} kcal
              </Text>
              <Text style={[type.caption, { color: colors.muted }]}>
                {formatNumber(Math.round(previewMacros.protein_g))}g protein ·{' '}
                {formatNumber(Math.round(previewMacros.carbs_g))}g carbs ·{' '}
                {formatNumber(Math.round(previewMacros.fat_g))}g fat
              </Text>
              <Text style={[type.caption, { color: colors.muted }]}>
                A preview from the photo alone. The saved figure comes from the category you pick,
                same as it always does.
              </Text>
            </View>
          </View>

          {createLog.isError ? <FormError>{describeError(createLog.error)}</FormError> : null}

          <View style={{ gap: spacing.sm }}>
            {/* Never disabled, same reasoning as the manual form's own button:
                an unresolved category is answered by the line below rather
                than by making the control unpressable. */}
            <Button
              label={createLog.isPending ? 'Saving' : 'Log it'}
              icon="check"
              size="lg"
              full
              onPress={submit}
              loading={createLog.isPending}
            />

            {outstanding ? (
              <Text
                style={[
                  type.caption,
                  { color: refused ? colors.danger : colors.muted, textAlign: 'center' },
                ]}
              >
                {outstanding}
              </Text>
            ) : null}

            <Button
              label="Not right? Edit manually"
              variant="ghost"
              size="lg"
              full
              onPress={() => setMode('manual')}
            />
          </View>
        </View>
      </Screen>
    );
  }

  // Results only count once the query is long enough to have produced them, so
  // this is undefined rather than empty while someone is still typing the first
  // letter. Held in one const so the blocks below narrow off it.
  const results = query.trim().length >= 2 ? search.data : undefined;
  const noMatches =
    results !== undefined && results.dishes.length === 0 && results.categories.length === 0;

  return (
    <Screen title="Log a meal" onBack={resetForm}>
      <View style={column}>
        {/* The one thing. 48 against a next largest of 21, and 32 of space
            beneath it against 24 between everything else. */}
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
          <Field
            label="Search"
            value={query}
            onChangeText={setQuery}
            placeholder="Biryani, ramen, burger"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {search.isFetching ? <Loading label="Searching" /> : null}

          {noMatches ? (
            <View style={{ gap: spacing.md, alignItems: 'flex-start' }}>
              <Text style={[type.caption, { color: colors.muted }]}>
                Nothing matched. Forkast only knows the dishes people have logged so far, so name
                the dish below and pick the category it belongs to.
              </Text>
              <Button label="Clear the search" variant="secondary" onPress={() => setQuery('')} />
            </View>
          ) : null}

          {/* Results sit directly under the field that produced them, with no
              heading and no surface. Both would be saying the obvious. */}
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
                      setQuery('');
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
                      setQuery('');
                    }}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <Field
            label="Dish"
            value={dishName}
            onChangeText={setDishName}
            placeholder="Chicken karahi"
          />

          {/* Ten cuisines and thirty eight categories. As chips that is a wall
              of tiny text with no way to search it, which is what made this
              screen unreadable, so both are fields that open a searchable
              list. */}
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

          {/* Beside the category on purpose. These two are the whole estimate:
              the category gives the range and this multiplies it. They used to
              sit four blocks apart. */}
          <View style={{ gap: spacing.sm }}>
            <ControlLabel>Serving size</ControlLabel>
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
            <Text style={[type.caption, { color: colors.muted }]}>
              The estimate scales with this, so a large portion goes past the range above.
            </Text>
          </View>
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
          {/* Never disabled. An unfinished form is answered by the line below,
              which is on screen before the press as well as after it. */}
          <Button
            label={createLog.isPending ? 'Saving' : 'Log it'}
            icon="check"
            size="lg"
            full
            onPress={submit}
            loading={createLog.isPending}
          />

          {outstanding ? (
            <Text
              style={[
                type.caption,
                { color: refused ? colors.danger : colors.muted, textAlign: 'center' },
              ]}
            >
              {outstanding}
            </Text>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}
