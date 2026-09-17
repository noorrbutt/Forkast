import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { ArchHero, Button, Hero, Mark, Screen } from '../../components/ui';
import { useTheme } from '../../theme';

/**
 * Self-critique, per the style guide section 13.
 *
 * What it was, immediately before this: a 177pt wash starting 39pt down the
 * page, a left aligned 64pt "Welcome.", three left aligned pitch items, and two
 * full width buttons of equal size.
 *
 * What it broke, measured. The wash was 21 percent of an 844pt screen and did
 * not reach the top edge, because Screen's top padding is unconditional and
 * HeroWash only pulled up 24 against 63, so the one element meant to set the
 * tone arrived as a band floating in the middle of nothing. Section 1: the
 * three pitch items were six text elements carrying 167pt of the screen, which
 * is more weight than the promise they were evidence for. Section 7: both
 * buttons were `size="lg"`, `full` and saffron, so the way in and the way back
 * looked equally likely. The two are the same size and width again now, at the
 * user's request and in line with section 7's rule against near equal, but only
 * one of them is filled, and fill is the part of a button that says "press me".
 *
 * What the one thing is now: a full bleed field of colour taking a little over
 * half the screen, its lower edge curving down through the middle, with the
 * app's own mark centred in it. Everything else is small, centred and below it.
 *
 * On the picture. The reference this was designed against leads with a
 * photograph. Forkast has never shipped one: every image in the repo is flat
 * launcher art, and section 10 bans stock photography twice by name, on the
 * grounds that the only images in this app are the user's own meals. So the top
 * half is the warm wash that already gives the rest of the app its character,
 * carrying the fork the native splash has already shown this person one second
 * earlier. It continues something rather than decorating nothing.
 *
 * The mark is ink and never saffron, at reduced opacity so the field reads
 * through it. A large saffron shape here would be the brand spent on decoration
 * and would leave the button below with no claim on the one colour that means
 * "you can press this".
 *
 * On centring. Section 2 asks for one left edge because content is read rather
 * than admired, and names welcome as the exception: centring is for a screen
 * with a single focal object. The failure it bans is alternating, and nothing
 * here alternates. Both auth screens centre their lower block already.
 *
 * What was demoted, and why that is correct: the three pitch items are gone as
 * items and survive as one sentence. The honest cost is specificity, three
 * concrete claims traded for one compound one. They were the evidence for the
 * promise, and on a screen whose job is to make a stranger read the promise
 * first, evidence that outweighs it is evidence in the wrong place.
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
        <Mark size={132} color={colors.text} opacity={0.14} />
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

          {/* The quiet door, the same size and width as the primary button
              above it, which is the pattern both auth screens now ship. It was
              medium and unstretched, and an unstretched Button aligns itself to
              flex-start, so it sat against the left edge of a centred column.

              Still not the reference's inline text link: a control with no fill
              and no border measures 1.00:1 and reads as a sentence, which this
              app has already shipped once and had reported as a missing button.
              Quiet is a border instead of a fill, never a smaller control. */}
          <Text
            style={[type.caption, { color: colors.muted, textAlign: 'center', marginTop: spacing.sm }]}
          >
            Already have an account?
          </Text>
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
