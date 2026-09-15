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
  timezone: string | null;
  goal: Goal | null;
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

export type LogPage = {
  items: FoodLog[];
  total: number;
};

export type CaloriesByDay = {
  day: string;
  calories: number;
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

export type Dashboard = {
  /** Present while the backend is serving the seeded snapshot rather than real analytics. */
  _source?: string | null;
  junk_ratio: number;
  total_calories: number;
  logs_count: number;
  calories_by_day: CaloriesByDay[];
  top_category: TopCategory | null;
  top_restaurant: TopRestaurant | null;
  best_fun_meals: FunMeal[];
  burn_equivalents: BurnEquivalents | null;
};

export type Streaks = {
  _source?: string | null;
  current_streak: number;
  longest_streak: number;
  last_junk_date: string | null;
  message: string | null;
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
  created_at: string;
};
