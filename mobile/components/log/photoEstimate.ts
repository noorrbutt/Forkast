import type { PhotoEstimate } from '../../lib/types';

/**
 * The calories and macros a photo estimate actually shows, portion chip
 * included, in one place -- so the confirm screen's preview and submit's
 * saved payload can never drift apart on the scaling arithmetic between them.
 * Picking "large" has to move both the headline number and the macro line by
 * the same ratio, since the model's macros describe its own single guess, not
 * whichever portion chip ends up chosen.
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
