import { View } from 'react-native';

import { useTheme } from '../theme';
import { Button } from './ui';

type MealPhotoActionsProps = {
  /** Whether the meal already has a picture, which decides the labels. */
  hasPhoto: boolean;
  /**
   * Whether taking a photo is the main thing to do on this screen.
   *
   * True on the log form, where the meal does not exist yet and the picture is
   * part of creating it. False on the meal screen, where the meal is already
   * saved and the main action is the one that saves an edit.
   */
  prominent: boolean;
  /** Any of the three operations in flight; every button goes inert. */
  busy: boolean;
  /** Narrower: only the pick-or-upload pair, which is what spins. */
  attaching: boolean;
  removing: boolean;
  onAttach: (fromCamera: boolean) => void;
  onRemove: () => void;
};

/**
 * Take, choose, remove: the row of three that sits under a meal's photo.
 *
 * Shared because it was written out twice, and the copy in app/logs/[id].tsx
 * carried a comment saying so: "the fix has to be applied in both places or the
 * screen the user named first stays broken". That is the whole argument against
 * leaving it duplicated, written by the person who had just had to do it twice.
 *
 * The two screens still compose their photo differently, and deliberately: the
 * meal screen leads with the picture at the full width of the content column
 * and puts these controls below the form, while the log form keeps the picture
 * and its controls together. Only this row was ever the same, so only this row
 * moves.
 *
 * Every number below is load bearing. With a photo attached the row asked for
 * 360pt of button inside the 342pt a 390pt phone actually has, so "Remove"
 * dropped to a second line and left-aligned under "Retake". It overflowed by
 * 18pt, which is why it read as a near miss rather than a break, and why it
 * does not reproduce on a Pro Max or in a browser where the column is wider.
 *
 * `compact` takes each button from 24pt of horizontal padding to 16, which is
 * 48pt back across the three, and dropping the icon returns another 25. That is
 * 287pt against 342, so it holds through the largest non-accessibility text size
 * rather than failing at the first step up.
 *
 * flexWrap stays. Above that size three labels cannot share a line on any phone
 * at any padding, and the guide's rule is to wrap rather than truncate.
 */
export function MealPhotoActions({
  hasPhoto,
  prominent,
  busy,
  attaching,
  removing,
  onAttach,
  onRemove,
}: MealPhotoActionsProps) {
  const { spacing } = useTheme();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' }}>
      <Button
        label={hasPhoto ? 'Retake' : 'Take a photo'}
        // Quiet once there is a photo, and quiet wherever the picture is not
        // what the screen is for. A primary button is a claim about what to do
        // next, and on a meal that already exists that claim belongs to Save.
        variant={hasPhoto || !prominent ? 'secondary' : 'primary'}
        compact
        onPress={() => onAttach(true)}
        disabled={busy}
        loading={attaching}
      />
      <Button
        label="Choose"
        variant="secondary"
        compact
        onPress={() => onAttach(false)}
        disabled={busy}
      />
      {hasPhoto ? (
        <Button
          label="Remove"
          variant="ghost"
          compact
          onPress={onRemove}
          disabled={busy}
          loading={removing}
        />
      ) : null}
    </View>
  );
}
