import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';

import {
  useRemovePhoto,
  useSetPhoto,
  usePhotoPicker,
  usePhotoSource,
  type PickedPhoto,
} from '../hooks/usePhoto';
import { describeError } from '../lib/api';
import { haptics } from '../lib/haptics';
import { useTheme } from '../theme';
import type { Uuid } from '../lib/types';
import { Button, Dialog, SectionLabel } from './ui';

/** A meal that exists, so a picked photo goes to the server there and then. */
type AttachedProps = {
  logId: Uuid;
  hasPhoto: boolean;
  photo?: never;
  onPhotoChange?: never;
};

/**
 * A meal that does not exist yet.
 *
 * The photo API is addressed by log id and there is no id until the log is
 * created, so on the log form the picked file is handed to the caller and sent
 * once the meal has been saved.
 */
type HeldProps = {
  logId?: undefined;
  hasPhoto?: never;
  photo: PickedPhoto | null;
  onPhotoChange: (photo: PickedPhoto | null) => void;
};

/**
 * The picture on a meal.
 *
 * Text only logs read like a spreadsheet, so this is the part that makes the
 * diary feel like one. Everything here is optional: a meal without a photo is
 * complete, and nothing nags about it.
 */
export function MealPhoto(props: AttachedProps | HeldProps) {
  const { colors, radius, spacing, type } = useTheme();

  // The two modes are told apart once, here, so the markup below can ask which
  // one it is in without repeating the test. The handlers still check props
  // directly: a narrowing only holds where the compiler can see it.
  const pending = props.logId === undefined ? props : null;
  const attached = props.logId === undefined ? null : props;

  const attachedSource = usePhotoSource(attached?.logId ?? null);
  const { pick, preparing } = usePhotoPicker();
  const upload = useSetPhoto();
  const remove = useRemovePhoto();

  const busy = preparing || upload.isPending || remove.isPending;

  /** Whether the "remove this photo" confirmation is on screen. */
  const [confirming, setConfirming] = useState(false);

  const thumbnail = pending
    ? pending.photo && { uri: pending.photo.uri }
    : attached?.hasPhoto
      ? attachedSource
      : null;

  const attach = async (fromCamera: boolean) => {
    if (busy) return;

    try {
      const photo = await pick(fromCamera);
      // Null means the permission or the picker was declined, which is an
      // answer rather than a failure.
      if (!photo) return;

      if (props.logId === undefined) {
        props.onPhotoChange(photo);
        haptics.tap();
        return;
      }

      await upload.mutateAsync({
        logId: props.logId,
        uri: photo.uri,
        mimeType: photo.mimeType,
      });
      haptics.success();
    } catch {
      haptics.error();
    }
  };

  const drop = () => {
    if (busy) return;

    if (props.logId === undefined) {
      // Nothing has left the device, so there is nothing to warn about losing.
      props.onPhotoChange(null);
      haptics.tap();
      return;
    }

    // A Dialog rather than Alert.alert, and not as a style preference.
    // react-native-web ships Alert as a class with an empty static method, so
    // on web this confirmation opened nothing, threw nothing and logged
    // nothing: both the Remove button and tapping the photo simply did not
    // work, and there was no other way to take a photo off a meal in a browser.
    setConfirming(true);
  };

  const confirmRemove = () => {
    if (props.logId === undefined) return;
    remove.mutate(props.logId, {
      onSuccess: () => {
        haptics.tap();
        setConfirming(false);
      },
      onError: () => haptics.error(),
    });
  };

  const error = upload.isError ? upload.error : remove.isError ? remove.error : null;

  const frame = {
    borderRadius: radius.card,
    overflow: 'hidden' as const,
    backgroundColor: colors.surfaceAlt,
    aspectRatio: 4 / 3,
  };

  const preview = thumbnail ? (
    <Image
      source={thumbnail}
      style={{ width: '100%', height: '100%' }}
      resizeMode="cover"
      accessibilityIgnoresInvertColors
    />
  ) : null;

  return (
    <View style={{ gap: spacing.lg }}>
      <SectionLabel>Photo</SectionLabel>

      {thumbnail && attached ? (
        <Pressable
          onPress={drop}
          accessibilityRole="imagebutton"
          accessibilityLabel="Meal photo"
          accessibilityHint="Opens the option to remove this photo"
          disabled={busy}
          style={frame}
        >
          {preview}
          {busy ? (
            <View
              style={{
                ...StyleSheetAbsoluteFill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.scrim,
              }}
            >
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : null}
        </Pressable>
      ) : null}

      {/* Held mode leaves the picture inert: a stray tap on it must not throw
          away the photo when the Remove button is right below. */}
      {thumbnail && pending ? (
        <View accessible accessibilityLabel="Meal photo" style={frame}>
          {preview}
        </View>
      ) : null}

      {thumbnail ? null : (
        <Text style={[type.caption, { color: colors.muted }]}>
          {pending
            ? 'Optional. Pick it now and Forkast attaches it the moment the meal is saved.'
            : 'Optional. A picture turns a list of dishes into something worth looking back at.'}
        </Text>
      )}

      {/* Three buttons on one line, which they were not.
          With a photo attached the row asked for 360pt of button inside the
          342pt a 390pt phone actually has, so "Remove" dropped to a second line
          and left-aligned under "Retake". It overflowed by 18pt, which is why
          it looked like a near miss rather than a break, and why it does not
          reproduce on a Pro Max or in a browser where the column is wider.

          `compact` takes each button from 24pt of horizontal padding to 16,
          which is 48pt back across the three, and dropping the icon returns
          another 25. That is 287pt against 342, so it now holds through the
          largest non-accessibility text size rather than failing at the first
          step up.

          flexWrap stays. Above that size three labels cannot share a line on
          any phone at any padding, and the guide's rule is to wrap rather than
          truncate. */}
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' }}
      >
        <Button
          label={thumbnail ? 'Retake' : 'Take a photo'}
          variant={thumbnail ? 'secondary' : 'primary'}
          compact
          onPress={() => void attach(true)}
          disabled={busy}
          loading={preparing || upload.isPending}
        />
        <Button
          label="Choose"
          variant="secondary"
          compact
          onPress={() => void attach(false)}
          disabled={busy}
        />
        {thumbnail ? (
          <Button
            label="Remove"
            variant="ghost"
            compact
            onPress={drop}
            disabled={busy}
            loading={remove.isPending}
          />
        ) : null}
      </View>

      {error ? (
        <Text style={[type.caption, { color: colors.danger }]}>{describeError(error)}</Text>
      ) : null}

      <Dialog
        visible={confirming}
        onDismiss={() => !busy && setConfirming(false)}
        title="Remove this photo?"
        message="The meal itself stays in your diary."
        actions={[
          {
            label: 'Remove',
            variant: 'danger',
            onPress: confirmRemove,
            disabled: busy,
            loading: remove.isPending,
          },
          {
            label: 'Keep it',
            variant: 'secondary',
            onPress: () => setConfirming(false),
            disabled: busy,
          },
        ]}
      />
    </View>
  );
}

/** Inlined so this file does not pull StyleSheet in for one constant. */
const StyleSheetAbsoluteFill = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};
