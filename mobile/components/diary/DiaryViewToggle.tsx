import { View } from 'react-native';

import { Chip } from '../ui';
import { useTheme } from '../../theme';

export type DiaryView = 'list' | 'map';

/**
 * List or Map, in the diary's header.
 *
 * The map is a view of the diary, where the meals were eaten, rather than a
 * destination of its own, so it is a switch on the diary instead of a row on
 * Home. Two chips, because a choice among few is a Chip (section 2); the
 * selected one carries the tick as well as the fill, so the state is never
 * colour alone.
 */
export function DiaryViewToggle({
  view,
  onChange,
}: {
  view: DiaryView;
  onChange: (view: DiaryView) => void;
}) {
  const { spacing } = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Diary view"
      style={{ flexDirection: 'row', gap: spacing.sm }}
    >
      <Chip
        label="List"
        compact
        showCheck
        selected={view === 'list'}
        onPress={() => onChange('list')}
      />
      <Chip
        label="Map"
        compact
        showCheck
        selected={view === 'map'}
        onPress={() => onChange('map')}
      />
    </View>
  );
}
