import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';

import { useTheme } from '../../theme';
import { Icon } from './Icon';

export type SelectOption = {
  value: string;
  label: string;
  /** Shown under the label, for example the cuisine a category belongs to. */
  hint?: string;
  /** A leading emoji. Kept separate from the label so search never matches it. */
  emoji?: string;
  /** A leading colour dot, used to carry the cuisine colour through. */
  color?: string;
};

type SelectProps = {
  label: string;
  value: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** Shown under the control, or as the error when something is wrong. */
  hint?: string;
  disabled?: boolean;
  /** Below this many options the search field is pointless and is hidden. */
  searchThreshold?: number;
  emptyText?: string;
};

/**
 * A field that opens a searchable list.
 *
 * This exists because 38 categories as a row of chips is not a control, it is a
 * wall. Chips cannot be searched, they push everything else off the screen, and
 * to fit at all their text has to shrink to a size that is hard to read. A
 * closed field says what is chosen in one line at a readable size, and the list
 * only appears when it is being used.
 *
 * Selection lives in a full screen sheet rather than a dropdown because a
 * dropdown on a phone either covers the thing you are choosing for, or gets
 * clipped by whatever is scrolling underneath it.
 */
export function Select({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose one',
  hint,
  disabled = false,
  searchThreshold = 8,
  emptyText = 'Nothing matches that.',
}: SelectProps) {
  const { colors, radius, spacing, type } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = options.find((o) => o.value === value) ?? null;
  const showSearch = options.length >= searchThreshold;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    // Label first, then hint, so typing a cuisine finds its categories too.
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[type.label, { color: colors.muted }]}>{label}</Text>

      <Pressable
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: selected?.label ?? placeholder }}
        accessibilityHint="Opens a searchable list"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          minHeight: 52,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          borderRadius: radius.input,
          backgroundColor: colors.surfaceAlt,
          borderWidth: 1.5,
          borderColor: colors.outline,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        })}
      >
        {selected?.color ? (
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: radius.pill,
              backgroundColor: selected.color,
            }}
          />
        ) : null}
        <Text
          style={[
            type.body,
            { flex: 1, color: selected ? colors.text : colors.muted, fontWeight: selected ? '600' : '400' },
          ]}
          numberOfLines={1}
        >
          {selected ? `${selected.emoji ? `${selected.emoji} ` : ''}${selected.label}` : placeholder}
        </Text>
        <Icon name="forward" size={18} color={colors.muted} />
      </Pressable>

      {hint ? <Text style={[type.caption, { color: colors.muted }]}>{hint}</Text> : null}

      <Modal visible={open} animationType="slide" onRequestClose={close} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <View
            style={{
              paddingTop: spacing.xxl + spacing.lg,
              paddingHorizontal: spacing.xl,
              paddingBottom: spacing.lg,
              gap: spacing.lg,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              backgroundColor: colors.surface,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Text style={[type.title, { color: colors.text, flex: 1 }]}>{label}</Text>
              <Pressable
                onPress={close}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={14}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Icon name="close" size={24} color={colors.text} />
              </Pressable>
            </View>

            {showSearch ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  paddingHorizontal: spacing.lg,
                  borderRadius: radius.input,
                  backgroundColor: colors.surfaceAlt,
                  borderWidth: 1.5,
                  borderColor: colors.outline,
                }}
              >
                <Icon name="search" size={18} color={colors.muted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search"
                  placeholderTextColor={colors.muted}
                  autoCorrect={false}
                  autoFocus
                  style={[type.body, { flex: 1, color: colors.text, paddingVertical: spacing.md }]}
                />
                {query ? (
                  <Pressable
                    onPress={() => setQuery('')}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                    hitSlop={12}
                  >
                    <Icon name="close" size={16} color={colors.muted} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>

          <FlatList
            data={matches}
            keyExtractor={(item) => item.value}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}
            ListEmptyComponent={
              <Text
                style={[
                  type.body,
                  { color: colors.muted, textAlign: 'center', padding: spacing.xxl },
                ]}
              >
                {emptyText}
              </Text>
            }
            renderItem={({ item }) => {
              const active = item.value === value;
              return (
                <Pressable
                  onPress={() => {
                    onChange(item.value);
                    close();
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                    // A 56pt row, so the text can be read at body size rather
                    // than shrunk to fit a chip.
                    minHeight: 56,
                    paddingHorizontal: spacing.lg,
                    paddingVertical: spacing.md,
                    marginBottom: spacing.xs,
                    borderRadius: radius.input,
                    backgroundColor: active ? colors.accentSoft : colors.surface,
                    borderWidth: 1,
                    borderColor: active ? colors.accent : colors.border,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  {item.color ? (
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: radius.pill,
                        backgroundColor: item.color,
                      }}
                    />
                  ) : null}
                  {item.emoji ? <Text style={{ fontSize: 20 }}>{item.emoji}</Text> : null}
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        type.body,
                        { color: colors.text, fontWeight: active ? '700' : '500' },
                      ]}
                    >
                      {item.label}
                    </Text>
                    {item.hint ? (
                      <Text style={[type.caption, { color: colors.muted }]}>{item.hint}</Text>
                    ) : null}
                  </View>
                  {active ? <Icon name="check" size={20} color={colors.accent} /> : null}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}
