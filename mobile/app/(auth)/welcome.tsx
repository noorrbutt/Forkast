import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { Button, Hero, HeroWash, Screen } from '../../components/ui';
import { useTheme } from '../../theme';

/**
 * Self-critique, per the style guide section 13.
 *
 * What it was: an uppercase eyebrow, a 48pt headline, three icon rows each with
 * a 44pt coloured disc, and two identical full width buttons.
 *
 * What it broke. Section 4: `type.label`, 11px uppercase with letterspacing,
 * used as an eyebrow above the headline, which is the named tell the guide
 * bans outside the tab bar and chart axes. Section 10: three 44pt accentSoft
 * discs drawn behind icons purely to give them presence. Section 8: saffron
 * spent on decoration, when it is the one colour that is supposed to mean "you
 * can press this", so the two real buttons had no colour of their own to claim.
 * Section 7 and section 1: nothing above `display`, and each of the three
 * supporting rows carried a coloured disc plus a 16pt title, so all three
 * weighed about as much as the headline. That is the equal weight failure, on
 * the one screen whose entire job is to lead with a single idea. Section 5: no
 * cap on the content column, so the pitch ran the full width of a browser.
 *
 * What the one thing is now: "Welcome." at `hero`, 64 against a next largest of
 * 21, sitting in the warm wash with 40 above it and 64 below when nothing else
 * on the screen gets more than 32.
 *
 * What was demoted, and why that is correct: the three features lost their
 * icons, their discs and their brand colour, and are now a plain sentence case
 * line plus one caption each. They are the evidence for the promise, not the
 * promise, and a stranger should read the promise first and then decide whether
 * to read the evidence at all.
 */

/** Capped so the pitch never runs the full width of a tablet or a browser. */
const COLUMN_WIDTH = 420;

/**
 * The three things the app actually does.
 *
 * No icons. Each one is a short claim and a line of proof, and the claim says
 * what it means without a glyph beside it helping.
 */
const PITCH: { title: string; body: string }[] = [
  {
    title: 'Log it in seconds',
    body: 'Pick the dish, tap a size, done. No weighing, no barcodes.',
  },
  {
    title: 'See it coming',
    body: 'Forkast forecasts your own pattern forward, so the week holds no surprises.',
  },
  {
    title: 'Get a plan that fits',
    body: 'Built around what you actually eat, not a stranger on the internet.',
  },
];

export default function WelcomeScreen() {
  const { colors, spacing, type } = useTheme();
  const router = useRouter();

  return (
    <Screen scroll bottomInset={spacing.xxl}>
      <View
        style={{
          width: '100%',
          maxWidth: COLUMN_WIDTH,
          alignSelf: 'center',
          gap: spacing.xxl,
        }}
      >
        {/* The only thing on this screen that gets the wash, and the only thing
            above 21. The promise sits directly under it at a full two steps
            down, close enough to be read as one thought and small enough that
            it can never compete. */}
        <HeroWash>
          <Hero value="Welcome." />
          <Text
            style={[
              type.title,
              { color: colors.text, fontWeight: '400', marginTop: spacing.sm },
            ]}
          >
            Eat now. Explain later.
          </Text>
        </HeroWash>

        <View style={{ gap: spacing.lg }}>
          {PITCH.map((item) => (
            <View key={item.title} style={{ gap: spacing.xs }}>
              <Text style={[type.subtitle, { color: colors.text }]}>{item.title}</Text>
              <Text style={[type.caption, { color: colors.muted }]}>{item.body}</Text>
            </View>
          ))}
        </View>

        {/* Both doors stay full width. These two are the screen's whole purpose
            and are genuinely equal in role, so the guide asks for them to be
            obviously equal in size; the fill is what says which one is the way
            in for someone who has never been here. */}
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
