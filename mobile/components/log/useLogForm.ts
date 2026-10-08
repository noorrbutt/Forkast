import axios from 'axios';
import * as Crypto from 'expo-crypto';
import { useMemo, useRef, useState } from 'react';

import type { SelectOption } from '../ui';
import { useCategories, useCuisines, useSearch } from '../../hooks/useCatalog';
import { useEstimatorSource } from '../../hooks/useHealth';
import { useCreateLog } from '../../hooks/useLogs';
import { useEstimatePhoto, useSetPhoto, usePhotoPicker, type PickedPhoto } from '../../hooks/usePhoto';
import { useRestaurants } from '../../hooks/useRestaurants';
import { describeError } from '../../lib/api';
import { haptics } from '../../lib/haptics';
import type {
  FoodLog,
  FriendScale,
  LogInput,
  PhotoEstimate,
  RefId,
  ServingSize,
  Uuid,
} from '../../lib/types';
import { scaledPhotoEstimate } from './photoEstimate';

/** Stands for "no cuisine filter". Never collides with an id, which is numeric. */
const ANY_CUISINE = 'any';

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

  return {
    estimatorSource,
    query,
    setQuery,
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
    photo,
    setPhoto,
    photoStatus,
    setPhotoStatus,
    saved,
    setSaved,
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
  };
}

export type LogForm = ReturnType<typeof useLogForm>;
