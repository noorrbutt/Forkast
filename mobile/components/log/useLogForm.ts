import axios from 'axios';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { SelectOption } from '../ui';
import { useCategories, useCuisines, useDishHints, useSearch } from '../../hooks/useCatalog';
import { useEstimatorSource } from '../../hooks/useHealth';
import { useCreateLog, useDeleteLog, useLogs, useRepeatLog } from '../../hooks/useLogs';
import {
  useEstimateOrder,
  useEstimatePhoto,
  useSetPhoto,
  usePhotoPicker,
  type PickedPhoto,
} from '../../hooks/usePhoto';
import { useRestaurants } from '../../hooks/useRestaurants';
import { describeError } from '../../lib/api';
import { haptics } from '../../lib/haptics';
import { recentDishes } from './recentDishes';
import type {
  DishHint,
  FoodLog,
  FriendScale,
  LogInput,
  PhotoEstimate,
  RefId,
  ServingSize,
  Uuid,
} from '../../lib/types';
import { scaledPhotoEstimate } from './photoEstimate';

/** One row of the order review sheet: an OrderItem plus the editable state
 * the checkbox, the name field and the qty stepper each need, and the qty
 * the estimate actually started at, which the calorie figure scales against
 * as the stepper moves it. */
export type OrderRow = {
  selected: boolean;
  name: string;
  qty: number;
  baseQty: number;
  kcalMin: number;
  kcalMax: number;
  categoryId: RefId | null;
  confidence: 'high' | 'medium' | 'low';
};

/** Stands for "no cuisine filter". Never collides with an id, which is numeric. */
const ANY_CUISINE = 'any';

/**
 * The serving size whose multiplier (app/services/calories.py's
 * SERVING_MULTIPLIERS: small 0.75, medium 1.0, large 1.4) is closest to
 * `ratio`. The portion stepper counts in a dish's own unit (e.g. "2 roti"),
 * not small/medium/large, so stepping it has to fall back to the nearest of
 * the three sizes the server actually prices against.
 */
function nearestServingSize(ratio: number): ServingSize {
  const multipliers: [ServingSize, number][] = [
    ['small', 0.75],
    ['medium', 1.0],
    ['large', 1.4],
  ];
  return multipliers.reduce((best, candidate) =>
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best,
  )[0];
}

/** Where the photo has got to, given it can only be sent once the log exists. */
export type PhotoStatus = 'none' | 'uploading' | 'attached' | 'failed';

/**
 * Everything the log screen knows: the form's answers, the photo and its
 * estimate, which step is showing, and the save itself. One hook so the
 * capture, confirm and manual steps all read and write the same state --
 * moving from confirm to manual keeps every answer already given.
 */
export function useLogForm() {
  const estimatorSource = useEstimatorSource();

  const [cuisineId, setCuisineId] = useState<RefId | null>(null);
  const [categoryId, setCategoryId] = useState<RefId | null>(null);
  const [dishName, setDishNameRaw] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [restaurantId, setRestaurantId] = useState<Uuid | null>(null);
  const [area, setArea] = useState('');
  const [rating, setRating] = useState(4);
  const [funScale, setFunScale] = useState<number | null>(null);
  const [friendScale, setFriendScale] = useState<FriendScale | null>(null);
  const [servingSize, setServingSize] = useState<ServingSize>('medium');
  // The desi dish hint behind the portion stepper, if one is selected, and
  // how many of its unit the stepper currently says. Null/null means no
  // stepper is showing and serving size is picked the ordinary way.
  const [dishHint, setDishHint] = useState<DishHint | null>(null);
  const [portionQty, setPortionQty] = useState<number | null>(null);
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [photoStatus, setPhotoStatus] = useState<PhotoStatus>('none');
  const [saved, setSaved] = useState<FoodLog | null>(null);
  // The log a one-tap Recent repeat just created, for as long as Undo is
  // still offered underneath the saved state. Separate from `saved` itself:
  // `saved` also holds a meal that arrived through the ordinary photo/manual
  // path, which was never a repeat and must never show an Undo it has no
  // use for.
  const [undoLog, setUndoLog] = useState<FoodLog | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, []);
  // The screen opens on the camera and only ever leaves it forward, to
  // confirm or to manual, or back to itself on "Log another". Nothing sends
  // it back to capture from manual: once someone has chosen to type, forcing
  // them back through the camera on the next field would be the app
  // second-guessing a choice it already asked for.
  const [mode, setMode] = useState<'capture' | 'confirm' | 'manual' | 'order'>('capture');
  const [estimate, setEstimate] = useState<PhotoEstimate | null>(null);
  const [estimateNotice, setEstimateNotice] = useState<string | null>(null);
  // The order review step's own state: the restaurant name the screenshot
  // carried (if any), one editable row per item, and how many were actually
  // logged once "Log N items" is pressed -- null means nothing has been
  // logged yet, which is what keeps the sheet showing instead of a success
  // state nobody asked for.
  const [orderRestaurantName, setOrderRestaurantName] = useState<string | null>(null);
  const [orderRows, setOrderRows] = useState<OrderRow[]>([]);
  const [orderNotice, setOrderNotice] = useState<string | null>(null);
  const [orderLoggedCount, setOrderLoggedCount] = useState<number | null>(null);
  // Which of estimate.portion_options was tapped, null until one is. Only
  // ever meaningful while estimate.portion_ambiguous is true; the calorie and
  // macro preview falls back to estimate's own single guess otherwise, so
  // nothing downstream has to check portion_ambiguous a second time.
  const [portionCalories, setPortionCalories] = useState<number | null>(null);
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
  // Both debounced on the dish name field itself now that it is the one and
  // only dish input -- it used to be a separate "find a dish" field driving
  // `search` while this typed into `dishName`, which was the same question
  // asked twice.
  const search = useSearch(dishName);
  const dishHints = useDishHints(dishName);
  // The diary's own newest meals, for the Recent section on the capture
  // screen: a dedicated fetch rather than reusing whatever page Home or the
  // diary happen to have cached, so this works the same whether or not
  // either of those screens has been visited this session.
  const recentLogsQuery = useLogs();
  const recentLogs = useMemo(
    () => recentDishes(recentLogsQuery.data?.items ?? []),
    [recentLogsQuery.data],
  );
  // A second, independent search against whatever a photo guessed, so the
  // confirm screen can offer the same quick dish/category chips the form
  // already has without the two queries fighting over one piece of state.
  const guessSearch = useSearch(estimate?.dish_guess ?? '');
  const restaurants = useRestaurants(restaurantName);
  const createLog = useCreateLog();
  const repeatLog = useRepeatLog();
  const deleteLog = useDeleteLog();
  const uploadPhoto = useSetPhoto();
  const estimatePhoto = useEstimatePhoto();
  const estimateOrder = useEstimateOrder();
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
    setDishHint(null);
    setPortionQty(null);
    setPhoto(null);
    setPhotoStatus('none');
    setRefused(false);
    setMode('capture');
    setEstimate(null);
    setEstimateNotice(null);
    setPortionCalories(null);
    setOrderRestaurantName(null);
    setOrderRows([]);
    setOrderNotice(null);
    setOrderLoggedCount(null);
    createLog.reset();
    uploadPhoto.reset();
    estimatePhoto.reset();
    estimateOrder.reset();
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    setUndoLog(null);
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

  /** How long a one-tap Recent repeat stays undoable. */
  const RECENT_UNDO_MS = 6000;

  const clearUndoTimer = () => {
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
  };

  const dismissUndo = () => {
    clearUndoTimer();
    setUndoLog(null);
  };

  /**
   * One tap on a Recent row: repeat it through the same POST
   * /logs/{id}/repeat the diary's own "Log again" uses, with no confirmation
   * first -- a row already named and priced is what the diary's confirm
   * dialog exists to surface, and a Recent row already shows both.
   *
   * Lands on the ordinary saved state (same as a photo or typed save), with
   * an Undo offered for a few seconds on top of it: a one-tap action with no
   * confirmation needs a way back more than a confirmed one does.
   */
  const repeatRecent = (logId: Uuid) => {
    if (repeatLog.isPending) return;
    repeatLog.mutate(logId, {
      onSuccess: (copy) => {
        haptics.tap();
        clearUndoTimer();
        setSaved(copy);
        setUndoLog(copy);
        undoTimer.current = setTimeout(() => setUndoLog(null), RECENT_UNDO_MS);
      },
      onError: () => haptics.error(),
    });
  };

  /** Takes back the meal `repeatRecent` just created. */
  const undoRecent = () => {
    if (!undoLog) return;
    const id = undoLog.id;
    dismissUndo();
    setSaved((current) => (current?.id === id ? null : current));
    deleteLog.mutate(id);
  };

  /**
   * Pick a delivery-order screenshot from the library and read it into
   * editable rows on the order review step.
   *
   * Library only, never the camera: a screenshot already exists as a photo
   * on the device, and ImagePicker's library mode is the one picker that
   * works inside Expo Go, with no dev build needed, unlike a share-sheet
   * intent straight from Foodpanda/Uber Eats (out of scope for the same
   * reason).
   */
  const importOrder = async () => {
    setOrderNotice(null);
    const picked = await photoPicker.pick(false);
    if (!picked) return;

    estimateOrder.mutate(picked, {
      onSuccess: (result) => {
        haptics.tap();
        setOrderRestaurantName(result.restaurant_name);
        setOrderRows(
          result.items.map((item) => ({
            selected: true,
            name: item.name,
            qty: item.qty,
            baseQty: item.qty,
            kcalMin: item.kcal_min,
            kcalMax: item.kcal_max,
            categoryId: item.category_id,
            confidence: item.confidence,
          })),
        );
        setOrderLoggedCount(null);
        setMode('order');
      },
      onError: (error) => {
        haptics.error();
        if (axios.isAxiosError(error) && error.response?.status === 429) {
          setOrderNotice("You've hit the order-scan limit for now, try typing these in.");
          setMode('manual');
          return;
        }
        setOrderNotice(describeError(error));
      },
    });
  };

  const toggleOrderRow = (index: number) => {
    setOrderRows((rows) =>
      rows.map((row, i) => (i === index ? { ...row, selected: !row.selected } : row)),
    );
  };

  const setOrderRowName = (index: number, name: string) => {
    setOrderRows((rows) => rows.map((row, i) => (i === index ? { ...row, name } : row)));
  };

  const setOrderRowQty = (index: number, qty: number) => {
    const next = Math.max(1, qty);
    setOrderRows((rows) => rows.map((row, i) => (i === index ? { ...row, qty: next } : row)));
  };

  // There is no single catch-all category in the seed data (see
  // app/seed/data.py -- "continental" there is a whole cuisine, not one
  // category), so an item the desi table had no match for needs some other
  // fallback to stay loggable without the review sheet growing a category
  // picker of its own. 'beverage' is the least wrong guess for the kind of
  // line item that typically has no dish match -- a soda, a side drink --
  // and the review sheet's editable name still lets someone fix the dish
  // name itself before logging.
  const fallbackCategoryId = useMemo(
    () => (categories.data ?? []).find((c) => c.slug === 'beverage')?.id ?? null,
    [categories.data],
  );

  /**
   * Turn every selected row into its own ordinary POST /logs call.
   *
   * Fired without waiting on the network (mutate, not mutateAsync): each
   * call's onMutate inserts its optimistic row into the diary immediately,
   * same as a single typed log, and each carries its own client_id, so a
   * save that is offline right now is queued and later retried exactly like
   * any other log -- a retried create_log call is deduped by client_id, so
   * two attempts at the same row can never become two meals.
   */
  const logOrderItems = () => {
    const selected = orderRows.filter((row) => row.selected && row.name.trim().length > 0);
    for (const row of selected) {
      const categoryId = row.categoryId ?? fallbackCategoryId;
      if (categoryId === null) continue;
      const midpoint = (row.kcalMin + row.kcalMax) / 2;
      const scaled = Math.round(midpoint * (row.qty / row.baseQty));
      const input: LogInput = {
        dish_name: row.name.trim(),
        category_id: categoryId,
        // No per-item rating control on the review sheet (checkbox, qty
        // stepper and name only, per the brief); 4 matches the form's own
        // default for a log nobody has rated.
        rating: 4,
        serving_size: nearestServingSize(scaled / midpoint),
        estimated_calories: scaled,
        client_id: Crypto.randomUUID(),
      };
      if (orderRestaurantName) input.restaurant_name = orderRestaurantName;
      createLog.mutate(input);
    }
    setOrderLoggedCount(selected.length);
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

  /** Edits the dish name field. A manual edit that no longer names the
   * selected hint drops the portion stepper, since it would otherwise keep
   * showing a unit and quantity for a dish the field no longer says. */
  const setDishName = (value: string) => {
    setDishNameRaw(value);
    if (dishHint && value !== dishHint.name) {
      setDishHint(null);
      setPortionQty(null);
    }
  };

  /** A dish hint chip was tapped: fills the dish name and its category, and
   * starts the portion stepper at the dish's own typical quantity. */
  const chooseDishHint = (hint: DishHint) => {
    setDishNameRaw(hint.name);
    setCategoryId(hint.category_id);
    const category = (categories.data ?? []).find((item) => item.id === hint.category_id);
    if (category) setCuisineId(category.cuisine_id);
    setDishHint(hint);
    setPortionQty(hint.typical_qty);
    setServingSize('medium');
  };

  /** The stepper was moved: re-derives serving_size from how far the new
   * quantity sits from the dish's own typical quantity. */
  const changePortionQty = (qty: number) => {
    const next = Math.max(1, qty);
    setPortionQty(next);
    if (dishHint) setServingSize(nearestServingSize(next / dishHint.typical_qty));
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

  return {
    estimatorSource,
    cuisineId,
    setCuisineId,
    categoryId,
    setCategoryId,
    dishName,
    setDishName,
    restaurantName,
    setRestaurantName,
    restaurantId,
    setRestaurantId,
    area,
    setArea,
    rating,
    setRating,
    funScale,
    setFunScale,
    friendScale,
    setFriendScale,
    servingSize,
    setServingSize,
    dishHints,
    dishHint,
    portionQty,
    chooseDishHint,
    changePortionQty,
    photo,
    setPhoto,
    photoStatus,
    setPhotoStatus,
    saved,
    setSaved,
    undoLog,
    undoRecent,
    dismissUndo,
    recentLogs,
    repeatRecent,
    repeatLog,
    mode,
    setMode,
    estimate,
    estimateNotice,
    setEstimateNotice,
    portionCalories,
    setPortionCalories,
    refused,
    cuisines,
    categories,
    search,
    guessSearch,
    restaurants,
    createLog,
    estimatePhoto,
    estimateOrder,
    photoPicker,
    selectedCategory,
    cuisineOptions,
    visibleCategories,
    categoryOptions,
    outstanding,
    resetForm,
    captureAndEstimate,
    pickCuisine,
    chooseCuisine,
    chooseCategory,
    attachPhoto,
    submit,
    orderRestaurantName,
    orderRows,
    orderNotice,
    orderLoggedCount,
    importOrder,
    toggleOrderRow,
    setOrderRowName,
    setOrderRowQty,
    logOrderItems,
  };
}

export type LogForm = ReturnType<typeof useLogForm>;
