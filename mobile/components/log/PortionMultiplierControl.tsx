import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Chip, ControlLabel } from '../ui';
import { useTheme } from '../../theme';
import { useLogFormStyles } from './formStyles';

const PRESETS = [
  { value: 0.7, label: 'servingSmall', multiplier: '0.7' },
  { value: 1, label: 'portionRegular', multiplier: '1' },
  { value: 1.4, label: 'servingLarge', multiplier: '1.4' },
] as const;

function formatMultiplier(value: number): string {
  return String(Number(value.toFixed(2)));
}

export function PortionMultiplierControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const { t } = useTranslation();
  const { colors, spacing, type } = useTheme();
  const { optionRow, optionChip } = useLogFormStyles();

  const step = (amount: number) => {
    onChange(Math.min(3, Math.max(0.25, Math.round((value + amount) * 100) / 100)));
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <ControlLabel>{t('log.portionMultiplier')}</ControlLabel>
      <View style={optionRow}>
        {PRESETS.map((preset) => (
          <Chip
            key={preset.value}
            label={`${t(`log.${preset.label}`)} ${preset.multiplier}`}
            selected={value === preset.value}
            showCheck
            style={optionChip}
            onPress={() => onChange(preset.value)}
          />
        ))}
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.sm,
        }}
      >
        <Button
          label="- 0.25"
          variant="secondary"
          compact
          disabled={value <= 0.25}
          accessibilityHint={t('log.decreasePortionHint')}
          onPress={() => step(-0.25)}
        />
        <Text style={[type.labelSoft, { color: colors.text }]}>
          {t('log.customPortionValue', { value: formatMultiplier(value) })}
        </Text>
        <Button
          label="+ 0.25"
          variant="secondary"
          compact
          disabled={value >= 3}
          accessibilityHint={t('log.increasePortionHint')}
          onPress={() => step(0.25)}
        />
      </View>
    </View>
  );
}
