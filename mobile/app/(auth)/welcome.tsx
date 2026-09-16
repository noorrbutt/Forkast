import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { Button, Icon, Screen, type IconName } from '../../components/ui';
import { useTheme } from '../../theme';

/**
 * What the app is, before it asks for anything.
 *
 * The first screen used to be a login form, which tells someone who has never
 * heard of Forkast precisely nothing: it asks them to identify themselves
 * before saying what they would be identifying themselves for. This says what
 * the app does in three lines, then offers the two doors.
 */
const PITCH: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'meal',
    title: 'Log it in seconds',
    body: 'Pick the dish, tap a size, done. No weighing, no barcodes.',
  },
  {
    icon: 'chart',
    title: 'See it coming',
    body: 'Your own pattern, forecast forward, so the week holds no surprises.',
  },
  {
    icon: 'plan',
    title: 'Get a plan that fits',
    body: 'Built around what you actually eat, not a stranger on the internet.',
  },
];

export default function WelcomeScreen() {
  const { colors, radius, spacing, type } = useTheme();
  const router = useRouter();

  return (
    <Screen scroll bottomInset={spacing.xxl}>
      <View style={{ gap: spacing.xxl, paddingTop: spacing.lg }}>
        <View style={{ gap: spacing.sm }}>
          <Text style={[type.label, { color: colors.accent }]}>Forkast</Text>
          <Text style={[type.display, { color: colors.text }]}>Welcome{'\n'}to Forkast.</Text>
          <Text style={[type.title, { color: colors.muted, fontWeight: '400' }]}>
            Eat now. Explain later.
          </Text>
        </View>

        <View style={{ gap: spacing.lg }}>
          {PITCH.map((item) => (
            <View
              key={item.title}
              style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: radius.pill,
                  backgroundColor: colors.accentSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name={item.icon} size={22} color={colors.accent} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.subtitle, { color: colors.text }]}>{item.title}</Text>
                <Text style={[type.caption, { color: colors.muted }]}>{item.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={{ gap: spacing.md }}>
          <Button
            label="Get started"
            size="lg"
            full
            onPress={() => router.push('/register')}
            accessibilityHint="Create a new Forkast account"
          />
          <Button
            label="Sign in"
            variant="secondary"
            size="lg"
            full
            onPress={() => router.push('/login')}
            accessibilityHint="Sign in to an account you already have"
          />
        </View>
      </View>
    </Screen>
  );
}
