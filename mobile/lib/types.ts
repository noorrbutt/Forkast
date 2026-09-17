/** Shapes returned by the Forkast backend under /api/v1. */

/**
 * Reference tables use smallint identity ids; anything a user owns uses UUIDv7.
 * Keeping the two apart means a mixed up id is a compile error rather than a
 * 422 discovered on device.
 */
export type RefId = number;
export type Uuid = string;

export type Goal = 'cut' | 'maintain' | 'bulk';
export type ServingSize = 'small' | 'medium' | 'large';
export type FriendScale = 'solo' | 'small_group' | 'squad';

export const GOALS: Goal[] = ['cut', 'maintain', 'bulk'];
export const SERVING_SIZES: ServingSize[] = ['small', 'medium', 'large'];
export const FRIEND_SCALES: FriendScale[] = ['solo', 'small_group', 'squad'];

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: string;
};

export type User = {
  id: Uuid;
  email: string;
  // Both are NOT NULL with a default on the server, so they always arrive.
  timezone: string;
  goal: Goal;
  /** Null until someone sets one. Null and zero mean different things here:
   *  null is "no target", and there is no way to store a zero one. */
  daily_calorie_target: number | null;
  created_at: string;
};

export type Cuisine = {
  id: RefId;
  slug: string;
  name: string;
  emoji: string | null;
  sort_order: number;
};

export type Category = {
  id: RefId;
  cuisine_id: RefId;
  slug: string;
  name: string;
  base_calorie_min: number;
  base_calorie_max: number;
  is_junk: boolean;
};

export type DishHit = {
  dish_name: string;
  category_id: RefId;
};

export type SearchResults = {
  cuisines: Cuisine[];
  categories: Category[];
  dishes: DishHit[];
};

export type Restaurant = {
  id: Uuid;
  name: string;
  area: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type FoodLog = {
  /** Whether a picture is attached. Answered by the list query itself, so the
   *  client can decide whether to request the image without fetching it. */
  has_photo: boolean;
  id: Uuid;
  dish_name: string;
  category_id: RefId;
  restaurant_id: Uuid | null;
  area: string | null;
  rating: number;
  fun_scale: number | null;
  friend_scale: FriendScale | null;
  serving_size: ServingSize;
  estimated_calories: number;
  created_at: string;
  /** Joined in by the backend so a log row renders without a second request. */
  category: Category | null;
  restaurant: Restaurant | null;
};

export type LogInput = {
  dish_name: string;
  category_id: RefId;
  restaurant_id?: Uuid;
  restaurant_name?: string;
  area?: string;
  rating: number;
  fun_scale?: number;
  friend_scale?: FriendScale;
  serving_size: ServingSize;
};

/**
 * A partial update. Omitting a field leaves it alone; sending null on a
 * nullable one clears it. The server rejects an explicit null on anything it
 * stores NOT NULL, so those are simply never sent as null from here.
 */
export type LogPatch = {
  dish_name?: string;
  category_id?: RefId;
  restaurant_id?: Uuid | null;
  area?: string | null;
  rating?: number;
  fun_scale?: number | null;
  friend_scale?: FriendScale | null;
  serving_size?: ServingSize;
};

export type LogPage = {
  items: FoodLog[];
  total: number;
};

export type CaloriesByDay = {
  /** How much of the day came from junk, so the chart can show its shape. */
  junk_calories: number;
  day: string;
  calories: number;
  /** What the user said they burned. Zero when nothing was entered. */
  burned: number;
};

export type BurnEquivalents = {
  walking_minutes: number;
  running_minutes: number;
  cycling_minutes: number;
};

/** Accepted by labelOf, which renders any of these down to a display string. */
export type Namedish = string | { name?: string | null; slug?: string | null } | null;

export type TopCategory = {
  category_id: RefId;
  name: string;
  count: number;
};

export type TopRestaurant = {
  /** Null for a meal logged with no restaurant attached. */
  restaurant_id: Uuid | null;
  name: string;
  count: number;
};

export type FunMeal = {
  dish_name: string;
  fun_scale: number;
  restaurant_name: string | null;
};

/** Today on its own, which is the only window a progress bar can honestly describe. */
export type Today = {
  target: number | null;
  consumed: number;
  burned: number;
  net: number;
  /** Null when no target is set. Negative once the day has gone over it. */
  remaining: number | null;
};

export type MonthTotals = {
  month: string;
  total_calories: number;
  meals_logged: number;
  junk_ratio: number;
  avg_calories_per_day: number;
  days_counted: number;
};

export type Trend = {
  this_month: MonthTotals;
  last_month: MonthTotals;
  change: {
    total_calories: number;
    meals_logged: number;
    junk_ratio: number;
    avg_calories_per_day: number;
  };
};

export type Dashboard = {
  junk_ratio: number;
  total_calories: number;
  total_burned: number;
  /** Eaten minus burned. Negative is a real result, not an error. */
  net_calories: number;
  logs_count: number;
  today: Today;
  calories_by_day: CaloriesByDay[];
  top_category: TopCategory | null;
  top_restaurant: TopRestaurant | null;
  best_fun_meals: FunMeal[];
  burn_equivalents: BurnEquivalents;
};

/** One day's burned calories. There is at most one of these per day. */
export type BurnEntry = {
  id: Uuid;
  day: string;
  calories: number;
  updated_at: string;
};

export type Streaks = {
  current_streak: number;
  longest_streak: number;
  last_junk_date: string | null;
  message: string;
};

export type PlanMeal = {
  slot: string;
  suggestion: string;
  approx_calories: number;
};

export type PlanDay = {
  day: string;
  meals: PlanMeal[];
};

export type GeneratedPlan = {
  summary: string;
  days: PlanDay[];
  nudges: string[];
};

export type Plan = {
  id: Uuid;
  goal: Goal;
  generated_plan: GeneratedPlan;
  /** Which model produced it. "stub" while the Groq integration is a TODO. */
  model: string | null;
  created_at: string;
};
