import type { PhotoEstimate } from '../../lib/types';

/** Match Python's round-to-even behavior for calorie values sent to the API. */
export function roundCalories(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction < 0.5) return floor;
  if (fraction > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * The photo estimate after any ambiguous-portion choice. The portion multiplier
 * remains separate: the confirm screen applies it to this preview while submit
 * sends this base estimate and the multiplier independently for the server to
 * apply once.
 */
export function scaledPhotoEstimate(estimate: PhotoEstimate, chosenCalories: number) {
  const scale = estimate.calories > 0 ? chosenCalories / estimate.calories : 1;
  return {
    calories: chosenCalories,
    protein_g: estimate.macros.protein_g * scale,
    carbs_g: estimate.macros.carbs_g * scale,
    fat_g: estimate.macros.fat_g * scale,
  };
}
