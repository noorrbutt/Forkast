import { useRef } from 'react';
import { Pressable, Text } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

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
  const { colors, spacing, type } = useTheme();
  const ref = useRef<Swipeable>(null);

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
          accessibilityLabel={`Delete ${dishName}`}
          style={{
            width: 96,
            alignItems: 'center',
            justifyContent: 'center',
            // dangerSoft fill with danger ink, not a solid danger fill with
            // white text: the same pairing every other destructive control
            // in this app uses (Button's danger variant), and the one the
            // contrast tests already check clears 4.5:1.
            backgroundColor: colors.dangerSoft,
          }}
        >
          <Icon name="trash" size={20} color={colors.danger} />
          <Text style={[type.caption, { color: colors.danger, marginTop: spacing.xs }]}>Delete</Text>
        </Pressable>
      )}
      overshootRight={false}
    >
      {children}
    </Swipeable>
  );
}
