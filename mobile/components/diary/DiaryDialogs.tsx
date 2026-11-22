import { useTranslation } from 'react-i18next';

import { Dialog } from '../ui';
import { displayDish, formatNumber } from '../../lib/format';
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
  const { t } = useTranslation();
  return (
    <Dialog
      visible={log !== null}
      onDismiss={() => !busy && onCancel()}
      title={t('diary.repeatTitle')}
      message={
        log
          ? t('diary.repeatMessage', {
              dish: displayDish(log.dish_name),
              calories: formatNumber(log.estimated_calories),
            })
          : undefined
      }
      actions={[
        {
          label: t('diary.repeatAction'),
          variant: 'primary',
          onPress: () => log && onConfirm(log),
          disabled: busy,
          loading: busy,
        },
        {
          label: t('diary.cancel'),
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
  const { t } = useTranslation();
  return (
    <Dialog
      visible={log !== null}
      onDismiss={onCancel}
      title={t('diary.deleteTitle')}
      message={
        log
          ? t('diary.deleteMessage', { dish: displayDish(log.dish_name) })
          : undefined
      }
      actions={[
        {
          label: t('diary.delete'),
          variant: 'danger',
          icon: 'trash',
          onPress: () => {
            if (log) onConfirm(log);
            onCancel();
          },
        },
        {
          label: t('diary.cancel'),
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
  const { t } = useTranslation();
  return (
    <Dialog
      visible={log !== null}
      onDismiss={onClose}
      title={displayDish(log?.dish_name)}
      actions={[
        {
          label: t('diary.logAgain'),
          icon: 'log',
          onPress: () => {
            if (log) onRepeat(log);
            onClose();
          },
        },
        {
          label: t('diary.delete'),
          icon: 'trash',
          variant: 'danger',
          onPress: () => {
            if (log) onDelete(log);
            onClose();
          },
        },
        {
          label: t('diary.cancel'),
          onPress: onClose,
        },
      ]}
    />
  );
}
