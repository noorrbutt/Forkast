import { createContext, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Pressable, ScrollView, StatusBar, Text, View, type RefreshControlProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../theme';
import { Frosted } from './Frosted';

type ScreenProps = {
  children: ReactNode;
  /** Wraps the children in a ScrollView. Off for screens that own their own list. */
  scroll?: boolean;
  /** Title for the frosted header that floats over the content. */
  title?: string;
  /** Tiny uppercase line above the title. */
  eyebrow?: string;
  headerRight?: ReactNode;
  onBack?: () => void;
  refreshControl?: ReactElement<RefreshControlProps>;
  /** Extra bottom space so the floating tab bar never covers the last row. */
  bottomInset?: number;
  padded?: boolean;
  /**
   * Start the content at the very top edge, under the status bar.
   *
   * Only for a screen whose first element is meant to bleed off the top, which
   * in this app is the welcome arch and nothing else. Without it the top
   * padding is unconditional, so a full bleed band starts an inset and a
   * spacing step down the page and stops being full bleed.
   *
   * Whatever sits in that space has to account for the status bar itself, since
   * nothing is reserving it any more.
   */
  bleedTop?: boolean;
};

/**
 * The padding a screen would have applied, handed to a child that scrolls itself.
 *
 * A list screen cannot take Screen's padding on a wrapper: padding on the
 * outside stops the content scrolling under the frosted header, which is the
 * whole visual idea of that header. So `scroll={false}` leaves the box bare and
 * publishes the numbers here instead, for the list to put in its own content
 * container.
 */
type ScreenInsets = { top: number; bottom: number };

const ScreenInsetContext = createContext<ScreenInsets>({ top: 0, bottom: 0 });

export function useScreenInsets(): ScreenInsets {
  return useContext(ScreenInsetContext);
}

export function Screen({
  children,
  scroll = true,
  title,
  eyebrow,
  headerRight,
  onBack,
  refreshControl,
  bottomInset,
  padded = true,
  bleedTop = false,
}: ScreenProps) {
  const { colors, layout, spacing, type, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [headerHeight, setHeaderHeight] = useState(0);

  const hasHeader = Boolean(title || onBack);
  const topPad = hasHeader
    ? headerHeight + spacing.lg
    : bleedTop
      ? 0
      : insets.top + spacing.lg;
  const padH = padded ? layout.screenPadding : 0;

  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingTop: topPad,
        paddingHorizontal: padH,
        paddingBottom: (bottomInset ?? layout.scrollBottomInset) + insets.bottom,
        gap: spacing.lg,
      }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  ) : (
    // Bare on purpose. The child is a list that scrolls itself, and padding out
    // here would stop its content passing under the header.
    <View style={{ flex: 1 }}>{children}</View>
  );

  const insetValue = useMemo(
    () => ({ top: topPad, bottom: insets.bottom }),
    [topPad, insets.bottom],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <ScreenInsetContext.Provider value={insetValue}>{body}</ScreenInsetContext.Provider>

      {hasHeader ? (
        <Frosted
          intensity={50}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            paddingTop: insets.top + spacing.sm,
            paddingBottom: spacing.md,
            paddingHorizontal: layout.screenPadding,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <View
            onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height + insets.top + spacing.sm + spacing.md)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
          >
            {onBack ? (
              <Pressable
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                // A real box, not hitSlop, which react-native-web drops.
                style={({ pressed }) => ({
                  opacity: pressed ? 0.6 : 1,
                  minWidth: 44,
                  minHeight: 44,
                  marginLeft: -spacing.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                })}
              >
                <Text style={[type.title, { color: colors.accent }]}>‹</Text>
              </Pressable>
            ) : null}
            <View style={{ flex: 1 }}>
              {eyebrow ? <Text style={[type.labelSoft, { color: colors.muted }]}>{eyebrow}</Text> : null}
              {title ? (
                <Text style={[type.title, { color: colors.text }]} numberOfLines={1}>
                  {title}
                </Text>
              ) : null}
            </View>
            {headerRight}
          </View>
        </Frosted>
      ) : null}
    </View>
  );
}
