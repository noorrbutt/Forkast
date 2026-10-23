import { Text, View } from 'react-native';

import { Button, Checkbox, Field, FormError } from '../ui';
import { describeError } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { useTheme } from '../../theme';
import { useLogFormStyles } from './formStyles';
import type { LogForm } from './useLogForm';

/** What the review sheet says about how much to trust one line item. */
const CONFIDENCE_LABEL: Record<'high' | 'medium' | 'low', string> = {
  high: 'Clearly read off the order.',
  medium: 'A decent guess, worth a glance.',
  low: 'Hard to read. Check this one.',
};

/**
 * The step after a delivery-order screenshot is read: a checklist of what
 * was on it, each one editable before it becomes its own logged meal.
 *
 * Deliberately not a form per item -- a checkbox, an editable name and a
 * quantity stepper is the whole control surface, same as the brief: there is
 * no category picker here, unmatched items fall back to a sensible default
 * category (see useLogForm's fallbackCategoryId), and every figure here is
 * still an estimate the same way every other logged meal's is.
 */
export function OrderReviewForm({ form }: { form: LogForm }) {
  const { colors, spacing, type } = useTheme();
  const { group } = useLogFormStyles();
  const {
    orderRestaurantName,
    orderRows,
    orderNotice,
    orderLoggedCount,
    orderTruncated,
    toggleOrderRow,
    setOrderRowName,
    setOrderRowQty,
    logOrderItems,
    createLog,
    resetForm,
    setMode,
  } = form;

  const selectedCount = orderRows.filter((row) => row.selected).length;

  if (orderLoggedCount !== null) {
    return (
      <View style={{ gap: spacing.lg }}>
        <Text style={[type.display, { color: colors.text }]}>
          {orderLoggedCount === 1 ? 'Logged 1 item' : `Logged ${orderLoggedCount} items`}
        </Text>
        <Text style={[type.body, { color: colors.muted }]}>
          Each one is in your diary as its own meal, saved as an estimate.
        </Text>
        <View style={{ gap: spacing.sm }}>
          <Button
            label="Log another"
            icon="log"
            size="lg"
            full
            onPress={() => {
              resetForm();
            }}
          />
          <Button
            label="See the diary"
            variant="secondary"
            size="lg"
            full
            onPress={() => setMode('capture')}
          />
        </View>
      </View>
    );
  }

  return (
    <>
      <View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
        <Text style={[type.display, { color: colors.text }]}>What was on the order?</Text>
        <Text style={[type.body, { color: colors.muted }]}>
          {orderRestaurantName ? `From ${orderRestaurantName}. ` : ''}
          Uncheck anything that is not food, fix a name, and adjust the quantity -- these are
          estimates, the same as every other logged meal.
        </Text>
      </View>

      {orderNotice ? <FormError>{orderNotice}</FormError> : null}

      {/* Not an error -- the read itself succeeded, just not all the way
          to the end of a dense order. Said once, here, rather than on
          every row, since it is a fact about the read as a whole. */}
      {orderTruncated ? (
        <Text style={[type.caption, { color: colors.muted }]}>
          Read the first {orderRows.length} items. Add the rest by hand.
        </Text>
      ) : null}

      {orderRows.length === 0 ? (
        <Text style={[type.body, { color: colors.muted }]}>
          Nothing on that screenshot looked like a food order. Try another one, or type this meal
          in instead.
        </Text>
      ) : (
        <View style={group}>
          {orderRows.map((row, index) => (
            <View
              key={index}
              style={{ gap: spacing.sm, paddingBottom: spacing.sm, opacity: row.selected ? 1 : 0.5 }}
            >
              <Checkbox
                checked={row.selected}
                onChange={() => toggleOrderRow(index)}
                label={`${row.name}${row.categoryId === null ? ' (no category match)' : ''}`}
              />
              <Field
                label="Name"
                value={row.name}
                onChangeText={(value) => setOrderRowName(index, value)}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Button
                  label="-"
                  variant="secondary"
                  compact
                  disabled={!row.selected}
                  onPress={() => setOrderRowQty(index, row.qty - 1)}
                />
                <Text style={[type.body, { color: colors.text }]}>Qty {row.qty}</Text>
                <Button
                  label="+"
                  variant="secondary"
                  compact
                  disabled={!row.selected}
                  onPress={() => setOrderRowQty(index, row.qty + 1)}
                />
              </View>
              <Text style={[type.caption, { color: colors.muted }]}>
                About {formatNumber(Math.round(row.kcalMin))} to{' '}
                {formatNumber(Math.round(row.kcalMax))} kcal. {CONFIDENCE_LABEL[row.confidence]}
              </Text>
            </View>
          ))}
        </View>
      )}

      {createLog.isError ? <FormError>{describeError(createLog.error)}</FormError> : null}

      <View style={{ gap: spacing.sm }}>
        <Button
          label={selectedCount === 1 ? 'Log 1 item' : `Log ${selectedCount} items`}
          size="lg"
          full
          disabled={selectedCount === 0}
          onPress={logOrderItems}
        />
        <Button
          label="Type it in instead"
          variant="ghost"
          size="lg"
          full
          onPress={() => setMode('manual')}
        />
      </View>
    </>
  );
}
