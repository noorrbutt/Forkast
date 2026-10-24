import { forwardRef } from 'react';
import { Text, View } from 'react-native';

import type { RamadanSummary } from '../../hooks/useRamadanSummary';
import { formatNumber } from '../../lib/format';
import { useTheme } from '../../theme';

/**
 * The share card's fixed logical size. 360x450 is a 4:5 crop (the common
 * portrait post ratio) at a 1:3 scale of the 1080x1350 pixels the capture
 * actually asks for -- an exact factor, so the capture needs no fractional
 * resize and nothing on the card blurs or shifts a pixel from how it was
 * laid out.
 */
export const SHARE_CARD_WIDTH = 360;
export const SHARE_CARD_HEIGHT = 450;
export const SHARE_CARD_PIXEL_WIDTH = 1080;
export const SHARE_CARD_PIXEL_HEIGHT = 1350;

/**
 * The image that gets shared: aggregates only, nothing identifying.
 *
 * No photo, no dish name, no restaurant, no email, no name -- not because
 * each of those was individually stripped out, but because `summary` (see
 * useRamadanSummary) never carried any of them to begin with. The card
 * cannot leak what it was never handed.
 *
 * `collapsable={false}` on the outer View is required by react-native-
 * view-shot: without it Android's view flattening can optimise this whole
 * subtree away, since it paints nothing interactive, and the capture comes
 * back blank.
 */
export const RamadanShareCard = forwardRef<View, { summary: RamadanSummary }>(
  function RamadanShareCard({ summary }, ref) {
    const { colors, spacing, type } = useTheme();

    return (
      <View
        ref={ref}
        collapsable={false}
        style={{
          width: SHARE_CARD_WIDTH,
          height: SHARE_CARD_HEIGHT,
          backgroundColor: colors.surface,
          padding: spacing.xxl,
          justifyContent: 'space-between',
        }}
      >
        <Text style={[type.labelSoft, { color: colors.muted }]}>Forkast · This Ramadan</Text>

        <View style={{ gap: spacing.lg }}>
          <View>
            <Text style={[type.display, { color: colors.text }]}>
              {formatNumber(summary.daysLogged)}
            </Text>
            <Text style={[type.caption, { color: colors.muted }]}>days logged</Text>
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.xxl }}>
            <View style={{ flex: 1 }}>
              <Text style={[type.displaySm, { color: colors.text }]}>
                {summary.avgSehriKcal !== null ? formatNumber(summary.avgSehriKcal) : '—'}
              </Text>
              <Text style={[type.caption, { color: colors.muted }]}>avg sehri kcal</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[type.displaySm, { color: colors.text }]}>
                {summary.avgIftarKcal !== null ? formatNumber(summary.avgIftarKcal) : '—'}
              </Text>
              <Text style={[type.caption, { color: colors.muted }]}>avg iftar kcal</Text>
            </View>
          </View>

          <View>
            <Text style={[type.displaySm, { color: colors.text }]}>
              {summary.lateNightSharePct}%
            </Text>
            <Text style={[type.caption, { color: colors.muted }]}>logged late at night</Text>
          </View>
        </View>

        <Text style={[type.caption, { color: colors.muted }]}>
          Numbers only. Made with Forkast.
        </Text>
      </View>
    );
  },
);
