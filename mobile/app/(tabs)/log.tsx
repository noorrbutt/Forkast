import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { ConfirmEstimate } from '../../components/log/ConfirmEstimate';
import { useLogFormStyles } from '../../components/log/formStyles';
import { LogSaved } from '../../components/log/LogSaved';
import { ManualLogForm } from '../../components/log/ManualLogForm';
import { useLogForm, type LogForm } from '../../components/log/useLogForm';
import { Button, Chip, ControlLabel, FormError, Loading, Screen } from '../../components/ui';
import { SERVING_LABELS } from '../../lib/format';
import { SERVING_SIZES } from '../../lib/types';
import { useTheme } from '../../theme';

/**
 * Logging a meal, and the one screen state that follows it.
 *
 * THE ONE THING, while the form is being filled in: the question "What did you
 * eat?" at `display`, with the two controls that answer it directly underneath.
 * Everything below that is a step of the type scale quieter and a step of the
 * spacing scale closer together.
 *
 * THE ONE THING, once the meal is saved: the estimate, as the only `hero` in
 * this file. The two states are mutually exclusive renders of one component, so
 * the screen still only ever shows one hero.
 *
 * Section 13 critique of what this replaced.
 *
 * 1. What it was. One capped column holding fifteen top level blocks at a
 *    single gap of 24: four cards, four text fields, two pickers and four rows
 *    of chips, each of the last five introduced by a heading with an icon
 *    beside it. Nothing on it was larger than 16 until the meal had been saved.
 *
 * 2. Which rules it broke.
 *    - Section 2 contrast, and the first composition line of Section 14: the
 *      largest type anywhere on the form was `subtitle` at 16, which is also
 *      what every field label, chip and button used. The gap between the first
 *      and second element was zero steps against a floor of one full step, so
 *      there was nothing for the eye to land on and no honest answer to "what
 *      is the one thing".
 *    - Section 10: an icon beside all seven headings, through the local
 *      IconLabel helper. Estimated, How a log works, Matches, Rating, Fun
 *      scale, Who was there and Serving size.
 *    - Section 6: four cards on a screen that is one task. The explainer card,
 *      the matches card and both empty states were surfaces around content that
 *      needed no surface of its own, and a card around a chip row is what turns
 *      a form into a stack.
 *    - Section 3 usability: the primary action shipped `disabled={!canSubmit}`.
 *      The guide names this exactly, "MUST NOT disable the primary action of a
 *      form until the form is valid", and calls hiding the affordance behind
 *      the action it invites the worst version of it.
 *    - Section 5: all fifteen blocks were separated by the same 24, so the gap
 *      inside a group equalled the gap around it and the grouping said nothing.
 *      Serving size sat four blocks away from the category even though those
 *      two together are the whole calorie estimate.
 *    - Section 10 again: both empty states passed an icon to `Empty`, which
 *      draws it on a 56pt accent disc.
 *    - Section 12: the header wore "Nice one" as an eyebrow, which does no job.
 *
 * 3. What the one thing is now. The question the form asks, at 48 over a body
 *    line that says how the estimate is arrived at, with 32 of space beneath it
 *    against 24 everywhere else. After a save it is the estimate at 64, alone
 *    in the top third with 48 above and below it.
 *
 * 4. What was demoted or cut, and why that is correct.
 *    Demoted: the seven headings. Four became the same 12/500 sentence case
 *    label that Field and Select already print above themselves, because a row
 *    of chips is a question of exactly the same rank as a text input and
 *    dressing it as a section made every question look like a section. The
 *    other three are gone: search results under a search field, and a photo
 *    picker with a photo in it, are obvious from their content.
 *    Demoted: the form itself, from fifteen blocks to four groups, "what you
 *    ate", "where you ate it", "how it was" and the photo, with serving size
 *    moved up beside the category it scales.
 *    Cut: the three step explainer card, replaced by one line under the
 *    question that stays put rather than vanishing at the first tap, and the
 *    two `Empty` cards, replaced by a sentence and the one button that fixes
 *    the situation.
 *
 * A third state, ahead of both of the above: the camera. This screen used to
 * open directly on the form; it now opens on a capture screen instead, since a
 * photo is the fastest way to log a meal and typing one in is the deliberate
 * fallback rather than the default. The one thing there is the same question
 * this screen has always asked, "What did you eat?", answered by a button
 * instead of a field. A photo hands back a guess with no category attached to
 * it yet, so it opens a fourth state, confirm, which is deliberately not a
 * second copy of the form: it shows only what a photo can answer for itself
 * (the dish, a portion, a calorie preview) plus the fastest way to pick a
 * category, which is the same dish search the form already has, run against
 * the guess instead of against what someone typed. Saving from there still
 * goes through the exact same submit() and the exact same POST /logs the form
 * uses, so a photo-confirmed meal and a typed one are priced identically.
 *
 * Why the estimate is NOT a hero on the form.
 *
 * It was the obvious candidate and it is the wrong call twice over. The number
 * does not exist yet: the server picks a value inside the category's range and
 * only then multiplies it by the serving size, so the most the client can
 * honestly say before submitting is a range. The style guide requires a hero to
 * be a number or a short headline, and a range is neither. Second, a 64pt
 * figure that appears only once a category is chosen would take the top of the
 * hierarchy away from the controls mid task and shove every remaining field
 * down under the reader's finger at the moment they are using it. The range
 * lives where it is acted on instead, as the hint under the category picker,
 * which is also what this screen's tests assert. Once the meal is saved the
 * number is real and the screen has nothing else to say, and that is where the
 * hero goes.
 */

/**
 * The serving size chips, shared by the confirm step and the manual form so
 * the question is asked the same way on both.
 */
function ServingSizeQuestion({ form, hint }: { form: LogForm; hint?: string }) {
  const { colors, spacing, type } = useTheme();
  const { optionRow, optionChip } = useLogFormStyles();
  const { servingSize, setServingSize } = form;

  return (
    <View style={{ gap: spacing.sm }}>
      <ControlLabel>Serving size</ControlLabel>
      <View style={optionRow}>
        {SERVING_SIZES.map((size) => (
          <Chip
            key={size}
            label={SERVING_LABELS[size]}
            selected={servingSize === size}
            showCheck
            style={optionChip}
            onPress={() => setServingSize(size)}
          />
        ))}
      </View>
      {hint ? <Text style={[type.caption, { color: colors.muted }]}>{hint}</Text> : null}
    </View>
  );
}

export default function LogScreen() {
  const { colors, layout, spacing, type } = useTheme();
  const router = useRouter();
  const form = useLogForm();
  const {
    saved,
    setSaved,
    mode,
    setMode,
    estimate,
    estimateNotice,
    setEstimateNotice,
    photo,
    photoStatus,
    estimatorSource,
    estimatePhoto,
    photoPicker,
    resetForm,
    captureAndEstimate,
    attachPhoto,
  } = form;

  /**
   * How wide the form is allowed to get, and what centring it actually means.
   *
   * Centring every element would be worse than leaving it ragged: headings,
   * fields and chip rows would each find their own axis and nothing would line up
   * with anything. So the column is what gets centred, capped here at a
   * comfortable reading measure. On a phone the cap never binds and the column is
   * simply the screen; on a tablet, a foldable or the web build it stops a form
   * of short controls being stretched across 900pt.
   *
   * Inside the column every row then fills it edge to edge: fields already do,
   * and the chip rows below use flexGrow so the pills keep their natural width,
   * share the leftover space and finish flush with the right hand edge instead of
   * trailing off wherever the labels happened to end.
   */
  const column = {
    width: '100%' as const,
    maxWidth: layout.formWidth,
    alignSelf: 'center' as const,
    gap: spacing.xl,
  };

  if (saved) {
    return (
      // No frosted header here on purpose. A bar reading "Logged" above a 64pt
      // figure that already says so would be the same statement twice, and it
      // would eat the top third the hero is meant to own.
      <Screen>
        <View style={column}>
          <LogSaved
            saved={saved}
            estimatorSource={estimatorSource.data}
            photoStatus={photoStatus}
            onRetryPhoto={() => {
              if (photo) void attachPhoto(saved.id, photo);
            }}
            onLogAnother={() => {
              setSaved(null);
              resetForm();
            }}
            onSeeDashboard={() => {
              setSaved(null);
              resetForm();
              router.navigate('/');
            }}
          />
        </View>
      </Screen>
    );
  }

  if (mode === 'capture') {
    const busy = photoPicker.preparing || estimatePhoto.isPending;

    return (
      <Screen title="Log a meal">
        <View style={column}>
          <View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
            <Text style={[type.display, { color: colors.text }]}>What did you eat?</Text>
            <Text style={[type.body, { color: colors.muted }]}>
              Snap a photo and Forkast guesses the dish, the portion and the calories. Typing it in
              yourself works just as well.
            </Text>
          </View>

          {busy ? <Loading label="Looking at your photo" /> : null}
          {estimateNotice ? <FormError>{estimateNotice}</FormError> : null}

          <View style={{ gap: spacing.md }}>
            <Button
              label="Take a photo"
              icon="camera"
              size="lg"
              full
              loading={busy}
              onPress={() => void captureAndEstimate(true)}
            />
            <Button
              label="Choose from library"
              variant="secondary"
              size="lg"
              full
              disabled={busy}
              onPress={() => void captureAndEstimate(false)}
            />
            <Button
              label="Type it in instead"
              variant="ghost"
              size="lg"
              full
              disabled={busy}
              onPress={() => {
                setEstimateNotice(null);
                setMode('manual');
              }}
            />
          </View>
        </View>
      </Screen>
    );
  }

  if (mode === 'confirm' && estimate) {
    return (
      <Screen title="Log a meal" onBack={resetForm}>
        <View style={column}>
          <ConfirmEstimate
            form={form}
            estimate={estimate}
            servingSizeQuestion={<ServingSizeQuestion form={form} />}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="Log a meal" onBack={resetForm}>
      <View style={column}>
        <ManualLogForm
          form={form}
          servingSizeQuestion={
            <ServingSizeQuestion
              form={form}
              hint="The estimate scales with this, so a large portion goes past the range above."
            />
          }
        />
      </View>
    </Screen>
  );
}
