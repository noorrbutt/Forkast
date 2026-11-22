import { useRef } from 'react';
import { Pressable, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import { Icon } from '../ui';
import { useTheme } from '../../theme';

/**
 * The swipe itself: a shortcut for whoever already knows it exists, sitting
 * on top of the same onDelete every row's real Delete button already calls
 * (MealActions) -- never the only way to reach it, since a gesture nobody
 * can see is not a way in on its own.
 *
 * `renderRightActions` receiving `dragX` unused is deliberate: this reveals
 * a plain, fixed-width panel rather than a label that grows or fades with
 * the drag, since a target that moves while a thumb is still reaching for
 * it is worse than one that simply appears.
 */
export function SwipeToDelete({
  disabled,
  dishName,
  onDelete,
  children,
}: {
  disabled: boolean;
  dishName: string;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { colors, spacing, type } = useTheme();
  const ref = useRef<SwipeableMethods>(null);

  if (disabled) return <>{children}</>;

  return (
    <Swipeable
      ref={ref}
      renderRightActions={() => (
        <Pressable
          onPress={() => {
            ref.current?.close();
            onDelete();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('diary.deleteDish', { dish: dishName })}
          style={{
            width: 96,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surfaceAlt,
          }}
        >
          <Icon name="trash" size={20} color={colors.danger} />
          <Text style={[type.caption, { color: colors.danger, marginTop: spacing.xs }]}>
            {t('diary.delete')}
          </Text>
        </Pressable>
      )}
      overshootRight={false}
    >
      {children}
    </Swipeable>
  );
}
