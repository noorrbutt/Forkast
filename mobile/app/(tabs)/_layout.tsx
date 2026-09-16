import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, Text, View } from 'react-native';

import { Frosted, Icon, type IconName } from '../../components/ui';
import { haptics } from '../../lib/haptics';
import { useTheme } from '../../theme';

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
  streaks: 'streaks',
  log: 'log',
  plan: 'plan',
  profile: 'profile',
};

const RAISED_ROUTE = 'log';

function FloatingTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
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
              <Icon name={icon} size={20} color={focused ? colors.accent : colors.muted} />
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
          centre of the bar. */}
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="streaks" options={{ title: 'Streaks' }} />
      <Tabs.Screen name="log" options={{ title: 'Log' }} />
      <Tabs.Screen name="plan" options={{ title: 'Plan' }} />
      <Tabs.Screen name="profile" options={{ title: 'You' }} />
    </Tabs>
  );
}
