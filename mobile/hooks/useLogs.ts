import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { api } from '../lib/api';
import { useAuth } from './useAuth';
import type { FoodLog, LogInput, LogPage, LogPatch, Uuid } from '../lib/types';

export function useLogs(limit = 20, offset = 0) {
  const { signedIn } = useAuth();
  return useQuery({
    queryKey: ['logs', limit, offset],
    enabled: signedIn,
    queryFn: async () => {
      const response = await api.get<LogPage>('/logs', { params: { limit, offset } });
      return response.data;
    },
  });
}

/** How many meals one page of the diary asks for. */
export const DIARY_PAGE = 30;

/**
 * The diary, a page at a time.
 *
 * It used to ask for a flat hundred and render every one of them. Two things
 * were wrong with that. A hundred is a cap, not a page: the header counted the
 * real total, so an account with three hundred meals read "312 logged" above a
 * list that stopped at the hundredth with nothing on screen saying so and no
 * way to reach the rest. And a hundred rows all mounted at once is a hundred
 * photo requests, on a screen whose whole job is to be scrolled.
 *
 * The page key deliberately stays under ['logs'], so every mutation that
 * already invalidates that key keeps working without knowing this exists.
 */
export function useInfiniteLogs(limit = DIARY_PAGE) {
  const { signedIn } = useAuth();
  return useInfiniteQuery({
    queryKey: ['logs', 'infinite', limit],
    enabled: signedIn,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const response = await api.get<LogPage>('/logs', {
        params: { limit, offset: pageParam },
      });
      return response.data;
    },
    // Counted from what has actually arrived rather than from the page number,
    // so a short page cannot leave an offset pointing past the end.
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
}

export function useLog(id: Uuid | null) {
  const { signedIn } = useAuth();
  return useQuery({
    queryKey: ['log', id],
    enabled: signedIn && id !== null,
    queryFn: async () => {
      const response = await api.get<FoodLog>(`/logs/${id}`);
      return response.data;
    },
  });
}

/**
 * What a just-logged meal looks like before the server has answered.
 *
 * id is the client_id itself: it already exists (submit() in the log form
 * always sets one), it is already a UUID, and reusing it rather than minting
 * a second one is what lets onSuccess and onError find this exact row again
 * to replace or remove it. category and restaurant stay null -- resolving
 * them here would mean duplicating a join the server already does -- so a
 * pending row's meta line is quietly incomplete until it settles, which
 * `pending` is what explains to the reader rather than leaving unstated.
 */
function optimisticLogFrom(input: LogInput): FoodLog {
  return {
    has_photo: false,
    id: input.client_id ?? `pending-${Date.now()}`,
    dish_name: input.dish_name,
    category_id: input.category_id,
    restaurant_id: input.restaurant_id ?? null,
    area: input.area ?? null,
    rating: input.rating,
    fun_scale: input.fun_scale ?? null,
    friend_scale: input.friend_scale ?? null,
    serving_size: input.serving_size,
    // The photo flow's own figure when there is one, same reasoning as
    // create_log's calorie_source: showing 0 until sync would read as an
    // empty meal rather than an unsettled one.
    estimated_calories: input.estimated_calories ?? 0,
    estimate_source: 'local',
    calorie_source: input.estimated_calories !== undefined ? 'photo' : null,
    protein_g: input.protein_g ?? null,
    carbs_g: input.carbs_g ?? null,
    fat_g: input.fat_g ?? null,
    refined: false,
    created_at: new Date().toISOString(),
    category: null,
    restaurant: null,
    pending: true,
  };
}

/** Prepend to the first page, bump the total, leave every other page alone. */
function insertOptimistic(data: InfiniteData<LogPage> | undefined, log: FoodLog) {
  if (!data || data.pages.length === 0) return data;
  const [first, ...rest] = data.pages;
  return {
    ...data,
    pages: [{ items: [log, ...first.items], total: first.total + 1 }, ...rest],
  };
}

/** Swap the pending row for the real one, in whichever page it landed on. */
function settleOptimistic(data: InfiniteData<LogPage> | undefined, id: Uuid, log: FoodLog) {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) => (item.id === id ? log : item)),
    })),
  };
}

/** The save genuinely failed (not merely paused offline -- a paused mutation
 * never reaches this), so the row that was never actually saved comes back out. */
function removeOptimistic(data: InfiniteData<LogPage> | undefined, id: Uuid) {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((item) => item.id !== id),
      total: page.items.some((item) => item.id === id) ? page.total - 1 : page.total,
    })),
  };
}

export function useCreateLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: LogInput) => {
      const response = await api.post<FoodLog>('/logs', input);
      return response.data;
    },
    // A meal appears in the diary the instant it is logged, whether or not
    // there is a connection to save it with right now -- see
    // lib/queryClient.ts's note on `networkMode: 'offlineFirst'`, which is
    // what decides whether mutationFn above runs immediately or waits. The
    // `pending` flag onMutate sets is what tells the diary row to say so.
    onMutate: async (input) => {
      // So a page fetch already in flight cannot land after this and quietly
      // overwrite the row this is about to insert.
      await queryClient.cancelQueries({ queryKey: ['logs', 'infinite'] });
      const optimistic = optimisticLogFrom(input);
      queryClient.setQueriesData<InfiniteData<LogPage>>({ queryKey: ['logs', 'infinite'] }, (data) =>
        insertOptimistic(data, optimistic),
      );
      return { optimisticId: optimistic.id };
    },
    onSuccess: (log, _input, context) => {
      if (context) {
        queryClient.setQueriesData<InfiniteData<LogPage>>(
          { queryKey: ['logs', 'infinite'] },
          (data) => settleOptimistic(data, context.optimisticId, log),
        );
      }
      // The dashboard and streaks are aggregated from food_logs on the
      // server, so adding a log really does move both of them.
      void queryClient.invalidateQueries({ queryKey: ['logs'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['streaks'] });
      // The month trend counts this meal too. Without this the card directly
      // under the dashboard hero kept its pre-meal figures while the hero
      // moved, so two cards on one screen disagreed about the same day.
      void queryClient.invalidateQueries({ queryKey: ['trend'] });
    },
    onError: (_err, _input, context) => {
      if (!context) return;
      queryClient.setQueriesData<InfiniteData<LogPage>>({ queryKey: ['logs', 'infinite'] }, (data) =>
        removeOptimistic(data, context.optimisticId),
      );
    },
  });
}

export function useUpdateLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: Uuid; patch: LogPatch }) => {
      const response = await api.patch<FoodLog>(`/logs/${id}`, patch);
      return response.data;
    },
    onSuccess: (log) => {
      queryClient.setQueryData(['log', log.id], log);
      // Editing the dish, category or serving size makes the server recompute
      // the estimate, so the totals and the streak can both move.
      void queryClient.invalidateQueries({ queryKey: ['logs'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['streaks'] });
      // The month trend counts this meal too. Without this the card directly
      // under the dashboard hero kept its pre-meal figures while the hero
      // moved, so two cards on one screen disagreed about the same day.
      void queryClient.invalidateQueries({ queryKey: ['trend'] });
    },
  });
}

export function useDeleteLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: Uuid) => {
      await api.delete(`/logs/${id}`);
      return id;
    },
    onSuccess: (id) => {
      queryClient.removeQueries({ queryKey: ['log', id] });
      void queryClient.invalidateQueries({ queryKey: ['logs'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['streaks'] });
      // The month trend counts this meal too. Without this the card directly
      // under the dashboard hero kept its pre-meal figures while the hero
      // moved, so two cards on one screen disagreed about the same day.
      void queryClient.invalidateQueries({ queryKey: ['trend'] });
    },
  });
}

/**
 * Log the same meal again.
 *
 * The server copies the old row rather than the client resubmitting a form,
 * which is what makes this one tap: nothing has to be re-derived here, and the
 * calorie figure is guaranteed to match the meal it was copied from.
 */
export function useRepeatLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: Uuid) => {
      const response = await api.post<FoodLog>(`/logs/${id}/repeat`);
      return response.data;
    },
    onSuccess: () => {
      // A new meal on today, so every derived figure moves.
      void queryClient.invalidateQueries({ queryKey: ['logs'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['streaks'] });
      void queryClient.invalidateQueries({ queryKey: ['trend'] });
    },
  });
}
