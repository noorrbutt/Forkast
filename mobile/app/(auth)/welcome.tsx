import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { ArchHero, Button, Hero, Mark, Screen, TextLink } from '../../components/ui';
import { useTheme } from '../../theme';

/**
 * The first screen a stranger sees.
 *
 * A full bleed field of colour takes a little over half the screen, its lower
 * edge curving through the middle, with the app's own mark centred in it.
 * Everything else is small, centred and below it, with one button: the way
 * back to signing in is a line of prose with "Sign in" tinted, so "Get
 * started" is the only shape on the lower half.
 *
 * No photograph: the only images in this app are the user's own meals. The
 * wash is what gives the rest of the app its warmth, and it carries the fork
 * the native splash showed a second earlier, so it continues something
 * rather than decorating nothing. The mark is ink, never saffron -- a large
 * saffron shape would spend the one colour that means "you can press this"
 * on decoration.
 *
 * Centred, unlike content screens, because this one has a single focal
 * object and nothing on it alternates between centred and left aligned. The
 * pitch is one sentence rather than three items, so the evidence for the
 * promise does not outweigh the promise itself.
 */

/**
 * Narrower than the 420 the forms use, and deliberately.
 *
 * Centred text wants a shorter measure than left aligned text: at 420 these
 * three lines come out badly lopsided, because a ragged right edge that is also
 * centred reads as a triangle. Near 300 the lines land close to equal.
 */
const COLUMN_WIDTH = 300;

export default function WelcomeScreen() {
  const { colors, spacing, type } = useTheme();
  const router = useRouter();

  return (
    <Screen scroll bleedTop padded={false} bottomInset={spacing.xxl}>
      <ArchHero>
        {/* A token, not an opacity. One alpha over ink that is near-white on
            dark and near-black on light gave the mark two different weights;
            this is the same presence in both, and measurable. */}
        <Mark size={132} color={colors.markOnWash} />
      </ArchHero>

      <View
        style={{
          width: '100%',
          maxWidth: COLUMN_WIDTH,
          alignSelf: 'center',
          alignItems: 'center',
          gap: spacing.xl,
          paddingHorizontal: spacing.xl,
        }}
      >
        <View style={{ alignItems: 'center', gap: spacing.md }}>
          {/* Eight characters, and that is a constraint rather than a
              preference: Hero never wraps, so it steps its size down and then
              overflows. "Welcome to Forkast." is nineteen and cannot be drawn.
              The full stop matches "Sign in." and "Sign up.", which is the
              same voice on all three screens someone sees before an account. */}
          <Hero value="Forkast." align="center" />
          <Text style={[type.body, { color: colors.muted, textAlign: 'center' }]}>
            Eat now. Explain later. Log a meal in seconds, watch the week take shape, and get a
            plan built on what you actually eat.
          </Text>
        </View>

        <View style={{ width: '100%', alignItems: 'center', gap: spacing.sm }}>
          <Button
            label="Get started"
            size="lg"
            full
            onPress={() => router.push('/register')}
            accessibilityHint="Create a new Forkast account"
          />

          {/* The quiet door, and the reference's inline text link after all.
              The note that used to sit here argued against one on the grounds
              that this app had shipped bare text where a button belonged and
              had it reported as missing. That was Button dropping its own
              styles through the animation wrapper, not a considered link, and
              TextLink says where the difference lies. */}
          <TextLink
            prompt="Already have an account?"
            label="Sign in"
            onPress={() => router.push('/login')}
            accessibilityHint="Sign in to an account you already have"
            style={{ marginTop: spacing.sm }}
          />
        </View>
      </View>
    </Screen>
  );
}
