import { useTheme } from '../../theme';

/**
 * The few layout shapes every step of the log screen shares, so a chip row
 * on the confirm step and one on the manual form can never drift apart.
 */
export function useLogFormStyles() {
  const { spacing } = useTheme();

  return {
    /** One shape for every row of pills on this screen, so no two rows differ. */
    optionRow: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: spacing.sm,
    },
    /** Pills keep their natural width, share the leftover space, and finish
     * flush with the column's right edge instead of trailing off wherever the
     * labels happened to end. */
    optionChip: { flexGrow: 1 },
    /**
     * A group of questions. Inside is 16 and around is 24: the gap inside a
     * group is a full step smaller than the gap outside, so the grouping reads
     * before any label does. Inside a single question, label to control, it
     * drops again to 8.
     */
    group: { gap: spacing.lg },
  };
}
