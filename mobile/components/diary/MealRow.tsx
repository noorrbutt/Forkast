import { memo } from 'react';

import { CompactMealRow } from './CompactMealRow';
import type { MealRowProps } from './rowProps';
import { PhotoMealRow } from './PhotoMealRow';

/**
 * One meal, shaped by whether it has a photo.
 *
 * Every meal in the diary is equal weight, so this is not a ranking between
 * meals: a photo is the one piece of rich content the app has, and at
 * thumbnail size it was being thrown away. The list is still one column of
 * meals in the order they happened; only a row's own height follows what it
 * has to show, which FlatList handles per item without the fixed-height
 * assumptions `getItemLayout` would need.
 */
function MealRowBase(props: MealRowProps) {
  return props.log.has_photo ? <PhotoMealRow {...props} /> : <CompactMealRow {...props} />;
}

/**
 * Memoised, because the diary holds a hundred of these.
 *
 * Without it a single "Log again" tap re-rendered every row about four times
 * over: once when the mutation goes pending, once on success, once when the
 * acknowledgement is set, and once more four seconds later when it clears,
 * plus a pass when the refetch lands. That is the stutter after tapping.
 *
 * The props are all primitives, the log object, and functions the screen
 * keeps stable, so the default shallow comparison is enough and a custom
 * comparator would only be one more thing to get wrong.
 */
export const MealRow = memo(MealRowBase);
