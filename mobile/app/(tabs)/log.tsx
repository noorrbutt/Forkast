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
 * Logging a meal: capture, then confirm or manual entry, then the saved state.
 *
 * The screen opens on the camera because a photo is the fastest way to log a
 * meal; typing it in is the deliberate fallback. A photo hands back a guess
 * with no category, so it leads to ConfirmEstimate rather than straight to a
 * save. Every step reads and writes the same useLogForm state and saves
 * through the same submit(), so a photo-confirmed meal and a typed one are
 * priced identically.
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
            {/* The same secondary style as the library button above. Both are
                the alternative to the photo, and one was outlined while the
                other was saffron text, a difference that meant nothing. */}
            <Button
              label="Type it in instead"
              variant="secondary"
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
