import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, Text, View } from 'react-native';

import { Frosted } from '../../components/ui';
import { haptics } from '../../lib/haptics';
import { useTheme } from '../../theme';

/**
 * A floating frosted pill. The active tab fills with soft saffron, the rest
 * stay as quiet uppercase labels, which keeps the bar reading as type rather
 * than as chrome.
 */
function FloatingTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { colors, layout, radius, spacing, type } = useTheme();

  return (
    <Frosted
      intensity={60}
      style={{
        position: 'absolute',
        left: spacing.lg,
        right: spacing.lg,
        bottom: insets.bottom + spacing.md,
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

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          // Only when the tab actually changes. Bumping on a tap that goes
          // nowhere teaches the user the feedback means nothing.
          if (!focused && !event.defaultPrevented) {
            haptics.tap();
            // NavigationHelpers types navigate against a generic param list, so
            // the concrete route name and params need a widening cast here.
            const navigate = navigation.navigate as (name: string, params?: object) => void;
            navigate(route.name, route.params);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            style={({ pressed }) => ({
              flex: 1,
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.pill,
              backgroundColor: focused ? colors.accentSoft : 'transparent',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text
              style={[
                type.label,
                { color: focused ? colors.accent : colors.muted, textAlign: 'center' },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </Frosted>
  );
}

export default function TabsLayout() {
  const { colors } = useTheme();

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Dashboard' }} />
      <Tabs.Screen name="log" options={{ title: 'Log' }} />
      <Tabs.Screen name="streaks" options={{ title: 'Streaks' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
