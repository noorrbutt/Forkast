import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { MealPhoto } from '../../components/MealPhoto';
import { StarRating } from '../../components/StarRating';
import {
  Button,
  Card,
  Chip,
  ControlLabel,
  ErrorState,
  Field,
  Hero,
  Loading,
  Screen,
  Select,
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

/** Where the photo has got to, given it can only be sent once the log exists. */
type PhotoStatus = 'none' | 'uploading' | 'attached' | 'failed';

export default function LogScreen() {
  const { colors, layout, spacing, type } = useTheme();
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
          <View
            style={{
              alignItems: 'center',
              // The only xxxl in this file. That reservation is what makes this
              // read as the hero before its size is even considered.
              paddingTop: spacing.xxl,
              paddingBottom: spacing.xxxl,
            }}
          >
            <Hero
              value={formatNumber(saved.estimated_calories)}
              caption={`kcal for ${saved.dish_name}${
                saved.restaurant ? ` at ${saved.restaurant.name}` : ''
              }`}
              align="center"
            />
          </View>

          <Text style={[type.body, { color: colors.muted }]}>
            Your dashboard and your streak have already moved.
          </Text>

          {photoStatus === 'uploading' ? <Loading label="Attaching your photo" fill={false} /> : null}

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

  // Results only count once the query is long enough to have produced them, so
  // this is undefined rather than empty while someone is still typing the first
  // letter. Held in one const so the blocks below narrow off it.
  const results = query.trim().length >= 2 ? search.data : undefined;
  const noMatches =
    results !== undefined && results.dishes.length === 0 && results.categories.length === 0;

  return (
    <Screen title="Log a meal">
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

          {search.isFetching ? <Loading label="Searching" fill={false} /> : null}

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
          <Text style={[type.caption, { color: colors.danger }]}>{describeError(createLog.error)}</Text>
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
