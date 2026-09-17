import { Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';

import { palettes, radius, spacing, type } from '../theme';

/**
 * What a screen falls back to when it throws while rendering.
 *
 * This deliberately does not use `useTheme`. expo-router mounts an error
 * boundary in place of the route that failed, and for the root layout that is
 * the very component providing the theme context, so a boundary that consumed
 * it would throw inside the handler for a throw. It reads the system scheme
 * directly and pulls raw palette values instead, which needs no provider at all
 * and therefore cannot fail the same way twice.
 *
 * The same reasoning keeps it to plain react-native primitives: no Button, no
 * Screen, no Card. Anything from `components/ui` is a component that could be
 * the thing that just crashed.
 */
export function CrashView({ error, retry }: { error: Error; retry: () => void }) {
  // useColorScheme can return null before the system answers. Dark is the
  // better guess for a full bleed error screen if it does.
  const colors = palettes[useColorScheme() === 'light' ? 'light' : 'dark'];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: spacing.xl,
          gap: spacing.lg,
        }}
      >
        <View style={{ gap: spacing.sm }}>
          <Text style={[type.display, { color: colors.text }]}>That screen broke.</Text>
          <Text style={[type.body, { color: colors.muted }]}>
            Nothing you logged is lost. Try again, and if it keeps happening the detail below is
            what to report.
          </Text>
        </View>

        {/* The message, verbatim and selectable. A crash screen that hides the
            cause turns a five minute fix into a bug report saying "it broke". */}
        <View
          style={{
            backgroundColor: colors.surfaceAlt,
            borderRadius: radius.card,
            borderWidth: 1,
            borderColor: colors.border,
            padding: spacing.lg,
          }}
        >
          <Text selectable style={[type.caption, { color: colors.muted }]}>
            {error?.message || 'No message was attached to the error.'}
          </Text>
        </View>

        <Pressable
          onPress={retry}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={{
            backgroundColor: colors.accentFill,
            borderRadius: radius.pill,
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.xl,
            alignItems: 'center',
            // Matches the primary button's floor, and it is the only control
            // here, so it has to be unmissable.
            minHeight: 52,
            justifyContent: 'center',
          }}
        >
          <Text style={[type.subtitle, { color: colors.accentInk }]}>Try again</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
