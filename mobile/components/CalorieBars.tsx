import { Text, View } from 'react-native';

import { shortDay } from '../lib/format';
import type { CaloriesByDay } from '../lib/types';
import { useTheme } from '../theme';

const CHART_HEIGHT = 120;

/**
 * A plain-View bar chart. No chart library, which keeps the bundle small and
 * lets the bars inherit the same pill radius as everything else.
 */
export function CalorieBars({ data }: { data: CaloriesByDay[] }) {
  const { colors, radius, spacing, type } = useTheme();

  if (data.length === 0) {
    return (
      <Text style={[type.caption, { color: colors.muted }]}>
        No days logged yet, your week will draw itself in here.
      </Text>
    );
  }

  const peak = Math.max(1, ...data.map((entry) => entry.calories ?? 0));

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, height: CHART_HEIGHT }}>
        {data.map((entry, index) => {
          const value = entry.calories ?? 0;
          const height = Math.max(6, (value / peak) * CHART_HEIGHT);
          const isPeak = value === peak && value > 0;

          return (
            <View
              key={`${entry.day}-${index}`}
              style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}
            >
              <View
                style={{
                  height,
                  borderRadius: radius.pill,
                  backgroundColor: isPeak ? colors.accent : colors.accentSoft,
                  borderWidth: isPeak ? 0 : 1,
                  borderColor: colors.border,
                }}
              />
            </View>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {data.map((entry, index) => (
          <Text
            key={`label-${entry.day}-${index}`}
            style={[type.labelSoft, { color: colors.muted, flex: 1, textAlign: 'center' }]}
            numberOfLines={1}
          >
            {shortDay(entry.day)}
          </Text>
        ))}
      </View>
    </View>
  );
}
