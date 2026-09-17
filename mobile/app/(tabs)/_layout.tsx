import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { CrashView } from '../../components/CrashView';
import { Frosted, Icon, type IconName } from '../../components/ui';
import { haptics } from '../../lib/haptics';
import { useTheme } from '../../theme';
import { motion } from '../../theme/motion';

/**
 * Which glyph belongs to which route, and which one is the raised action.
 *
 * Logging a meal is the whole point of the app and it used to be one of four
 * identical 11px uppercase words. It is now the saffron circle in the middle,
 * which is the only control in the tab bar that does not look like the others,
 * because it is the only one that is not navigation.
 */
const ICONS: Record<string, IconName> = {
  index: 'dashboard',
  history: 'history',
  log: 'log',
  streaks: 'streaks',
  profile: 'profile',
};

const RAISED_ROUTE = 'log';

/**
 * Routes that live in the tab group but do not earn a slot in the bar.
 *
 * Five is the most a centred raised button allows, since the button has to land
 * on the middle one. Plan is reached from a card on Home instead: a plan is
 * generated once in a while, and the bar is for the places you go every day.
 */
const HIDDEN_ROUTES = new Set(['plan']);

/** How small the filled glyph starts before it grows into place. */
const FILL_FROM = 0.85;

type TabIconProps = {
  name: IconName;
  focused: boolean;
  size: number;
};

/**
 * The tab glyph, as an outline that fills in when its tab is selected.
 *
 * Both cuts are in the tree at once and their opacities are opposites, which
 * is what makes this a cross fade rather than a swap: there is no frame with
 * nothing in it, and no frame with two glyphs at full strength. The filled one
 * also grows the last fraction of its size on the way in, so the change reads
 * as the icon arriving rather than as the colour being repainted.
 *
 * On the duration. The ask was a fill in about 10ms, which is worth taking
 * literally for a moment: one frame at 60Hz is 16.7ms, so a 10ms fade ends
 * before the screen can draw a single intermediate state and the icon simply
 * snaps, which is what it already did. motion.quick, at 220ms, is the shortest
 * timing this app has that a person can actually watch resolve, and it is the
 * one every other everyday transition already uses, so the tab bar keeps time
 * with the rest of the app instead of inventing its own tempo.
 */
function TabIcon({ name, focused, size }: TabIconProps) {
  const { colors } = useTheme();
  // Seeded from the current state, so the tab that is already selected when
  // the bar mounts is drawn filled rather than animating in behind the first
  // frame the user sees.
  const fill = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    fill.value = withTiming(focused ? 1 : 0, motion.quick);
  }, [fill, focused]);

  const outlineStyle = useAnimatedStyle(() => ({ opacity: 1 - fill.value }));
  const filledStyle = useAnimatedStyle(() => ({
    opacity: fill.value,
    transform: [{ scale: FILL_FROM + fill.value * (1 - FILL_FROM) }],
  }));

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View
        testID={`tab-glyph-${name}-outline`}
        style={[StyleSheet.absoluteFill, outlineStyle]}
      >
        <Icon name={name} variant="outline" size={size} color={colors.muted} />
      </Animated.View>
      <Animated.View
        testID={`tab-glyph-${name}-filled`}
        style={[StyleSheet.absoluteFill, filledStyle]}
      >
        <Icon name={name} variant="filled" size={size} color={colors.accent} />
      </Animated.View>
    </View>
  );
}

/** Exported for the tests, which drive it with a fabricated navigation state. */
export function FloatingTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { colors, layout, radius, spacing, type } = useTheme();

  const go = (route: (typeof state.routes)[number], focused: boolean) => {
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    // Only when the tab actually changes. Bumping on a tap that goes nowhere
    // teaches the user the feedback means nothing.
    if (!focused && !event.defaultPrevented) {
      haptics.tap();
      // NavigationHelpers types navigate against a generic param list, so the
      // concrete route name and params need a widening cast here.
      const navigate = navigation.navigate as (name: string, params?: object) => void;
      navigate(route.name, route.params);
    }
  };

  return (
    <View
      style={{
        position: 'absolute',
        left: spacing.lg,
        right: spacing.lg,
        bottom: insets.bottom + spacing.md,
      }}
    >
      <Frosted
        intensity={60}
        style={{
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 6,
          height: layout.tabBarHeight,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label = options.title ?? route.name;
          const focused = state.index === index;
          const icon = ICONS[route.name] ?? 'dashboard';

          if (HIDDEN_ROUTES.has(route.name)) return null;

          // The raised action leaves a gap here and is drawn over the bar
          // below, so the other tabs still divide the width evenly.
          if (route.name === RAISED_ROUTE) return <View key={route.key} style={{ flex: 1 }} />;

          return (
            <Pressable
              key={route.key}
              onPress={() => go(route, focused)}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              style={({ pressed }) => ({
                flex: 1,
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                borderRadius: radius.pill,
                backgroundColor: focused ? colors.accentSoft : 'transparent',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <TabIcon name={icon} focused={focused} size={20} />
              <Text
                style={[
                  type.labelSoft,
                  { color: focused ? colors.accent : colors.muted, textAlign: 'center' },
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </Frosted>

      {/* Drawn last so it sits above the bar, and centred on the gap left for it. */}
      {state.routes.map((route, index) => {
        if (route.name !== RAISED_ROUTE) return null;
        const focused = state.index === index;
        return (
          <Pressable
            key={route.key}
            onPress={() => go(route, focused)}
            accessibilityRole="button"
            accessibilityLabel="Log a meal"
            accessibilityHint="Record something you ate"
            accessibilityState={{ selected: focused }}
            style={({ pressed }) => ({
              position: 'absolute',
              alignSelf: 'center',
              bottom: layout.tabBarHeight / 2 - 2,
              width: 60,
              height: 60,
              borderRadius: radius.pill,
              backgroundColor: colors.accentFill,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 4,
              borderColor: colors.bg,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Icon name="log" size={30} color={colors.accentInk} />
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  const { colors } = useTheme();

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
    >
      {/* Order matters: log sits third of five so the raised button lands dead
          centre of the bar, and five is the most a centred button allows.
          Meals takes the slot Plan had. Looking back at what you ate is a daily
          act and it was reachable only from one card near the bottom of the
          dashboard, whereas a plan is generated once in a while, so Plan moves
          to a card on Home where an occasional action belongs. */}
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="history" options={{ title: 'Meals' }} />
      <Tabs.Screen name="log" options={{ title: 'Log' }} />
      <Tabs.Screen name="streaks" options={{ title: 'Streaks' }} />
      <Tabs.Screen name="profile" options={{ title: 'You' }} />
      {/* Still a route, just not a tab. */}
      <Tabs.Screen name="plan" options={{ title: 'Plan' }} />
    </Tabs>
  );
}

/**
 * A second boundary, one level in.
 *
 * The root one catches everything, but it replaces the whole app including the
 * tab bar, so a crash on Streaks would look identical to a crash in the
 * providers. Caught here, the failure is contained to the tab group and the
 * retry re-renders just that, which is both truer to what went wrong and a far
 * shorter way back.
 */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return <CrashView error={error} retry={() => void retry()} />;
}
