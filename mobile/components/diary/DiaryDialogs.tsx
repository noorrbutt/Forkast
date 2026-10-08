import { Dialog } from '../ui';
import { formatNumber } from '../../lib/format';
import type { FoodLog } from '../../lib/types';

/*
 * The diary's three dialogs. All are mounted once at screen level rather than
 * inside a row: a dialog per row would be a hundred modals, and it would
 * unmount underneath itself the moment the list refetched.
 */

/**
 * "Log this again?" -- Log again writes a real row that would then have to be
 * found and deleted, and its button sits on a row that is itself pressable,
 * so it is easy to hit by accident while scrolling. One question is cheaper
 * than an undo that does not exist.
 */
export function RepeatMealDialog({
  log,
  busy,
  onConfirm,
  onCancel,
}: {
  log: FoodLog | null;
  busy: boolean;
  onConfirm: (log: FoodLog) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      visible={log !== null}
      onDismiss={() => !busy && onCancel()}
      title="Log this again?"
      message={
        log
          ? `${log.dish_name} goes into today at ${formatNumber(
              log.estimated_calories
            )} kcal. You can edit or delete it afterwards.`
          : undefined
      }
      actions={[
        {
          label: 'Log it again',
          variant: 'primary',
          onPress: () => log && onConfirm(log),
          disabled: busy,
          loading: busy,
        },
        {
          label: 'Cancel',
          variant: 'secondary',
          onPress: onCancel,
          disabled: busy,
        },
      ]}
    />
  );
}

/**
 * Delete's confirmation, for the footer button only: it is one plain tap on
 * every row, which is exactly why it asks first. The swipe and the long-press
 * menu skip this -- both are already a deliberate step -- and the undo
 * snackbar is the second safety net under all three either way.
 */
export function DeleteMealDialog({
  log,
  onConfirm,
  onCancel,
}: {
  log: FoodLog | null;
  onConfirm: (log: FoodLog) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      visible={log !== null}
      onDismiss={onCancel}
      title="Delete this meal?"
      message={
        log
          ? `${log.dish_name} will be removed from your diary. You can undo it for a few seconds afterwards.`
          : undefined
      }
      actions={[
        {
          label: 'Delete',
          variant: 'danger',
          icon: 'trash',
          onPress: () => {
            if (log) onConfirm(log);
            onCancel();
          },
        },
        {
          label: 'Cancel',
          variant: 'secondary',
          onPress: onCancel,
        },
      ]}
    />
  );
}

/**
 * The accessible, non-gesture equivalent of the swipe: a long press, or the
 * "Show actions" custom accessibility action, opens this instead of reaching
 * for a hidden panel off the edge of the row.
 */
export function MealActionMenu({
  log,
  onRepeat,
  onDelete,
  onClose,
}: {
  log: FoodLog | null;
  onRepeat: (log: FoodLog) => void;
  onDelete: (log: FoodLog) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      visible={log !== null}
      onDismiss={onClose}
      title={log?.dish_name ?? ''}
      actions={[
        {
          label: 'Log again',
          icon: 'log',
          onPress: () => {
            if (log) onRepeat(log);
            onClose();
          },
        },
        {
          label: 'Delete',
          icon: 'trash',
          variant: 'danger',
          onPress: () => {
            if (log) onDelete(log);
            onClose();
          },
        },
        {
          label: 'Cancel',
          onPress: onClose,
        },
      ]}
    />
  );
}
