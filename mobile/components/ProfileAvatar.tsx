import { useState, type ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useAvatarSource, usePickAvatar, useRemoveAvatar, useSetAvatar } from '../hooks/useAvatar';
import { describeError } from '../lib/api';
import { haptics } from '../lib/haptics';
import { useTheme } from '../theme';
import { Avatar, Dialog, Icon } from './ui';

type ProfileAvatarProps = {
  /** Drives both the initials fallback and the accessibility label. */
  name: string;
  hasPicture: boolean;
  size?: number;
};

/**
 * The picture at the top of the profile.
 *
 * The whole circle is the control, with a small badge on the corner rather than
 * a button underneath it. A separate "Change photo" button would be a fifth
 * thing competing for the top of the screen, and tapping your own face is what
 * every other app has already taught people to try.
 *
 * The three choices live in a dialog instead of an action sheet because an
 * action sheet is a platform component that looks nothing like the rest of this
 * app and does not exist at all on web.
 */
export function ProfileAvatar({ name, hasPicture, size = 88 }: ProfileAvatarProps) {
  const { colors, radius, spacing, type } = useTheme();
  const [open, setOpen] = useState(false);

  const source = useAvatarSource(hasPicture);
  const { pick, preparing } = usePickAvatar();
  const upload = useSetAvatar();
  const remove = useRemoveAvatar();

  const busy = preparing || upload.isPending || remove.isPending;

  const attach = async (fromCamera: boolean) => {
    if (busy) return;
    try {
      const picked = await pick(fromCamera);
      // Null means the permission or the picker was declined, which is an
      // answer rather than a failure, so the dialog stays where it was.
      if (!picked) return;
      await upload.mutateAsync(picked);
      haptics.success();
      setOpen(false);
    } catch {
      haptics.error();
    }
  };

  const drop = () => {
    if (busy) return;
    remove.mutate(undefined, {
      onSuccess: () => {
        haptics.tap();
        setOpen(false);
      },
      onError: () => haptics.error(),
    });
  };

  const failure = upload.isError ? upload.error : remove.isError ? remove.error : null;

  const actions: ComponentProps<typeof Dialog>['actions'] = [
    {
      label: 'Take a photo',
      variant: 'primary',
      onPress: () => void attach(true),
      disabled: busy,
      loading: preparing || upload.isPending,
    },
    {
      label: 'Choose a photo',
      variant: 'secondary',
      onPress: () => void attach(false),
      disabled: busy,
    },
  ];

  if (hasPicture) {
    actions.push({
      label: 'Remove photo',
      variant: 'danger',
      icon: 'trash',
      onPress: drop,
      disabled: busy,
      loading: remove.isPending,
    });
  }

  actions.push({
    label: 'Cancel',
    variant: 'secondary',
    onPress: () => setOpen(false),
    disabled: busy,
  });

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="imagebutton"
        accessibilityLabel="Profile picture"
        accessibilityHint="Opens the options for changing your picture"
        style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
      >
        <Avatar uri={source?.uri} headers={source?.headers} name={name} size={size} />
        {/* Sits over the circle's lower right, which is where a photo control
            goes on every app that has one. */}
        <View
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: 30,
            height: 30,
            borderRadius: radius.pill,
            backgroundColor: colors.accentFill,
            borderWidth: 2,
            borderColor: colors.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="edit" size={14} color={colors.accentInk} />
        </View>
      </Pressable>

      <Dialog
        visible={open}
        onDismiss={() => !busy && setOpen(false)}
        title="Your picture"
        message={
          hasPicture
            ? 'Replace it, or take it off and go back to your initials.'
            : 'Optional, and it stays on your account rather than anywhere public.'
        }
        actions={actions}
      >
        {failure ? (
          <Text style={[type.caption, { color: colors.danger, marginBottom: spacing.sm }]}>
            {describeError(failure)}
          </Text>
        ) : null}
      </Dialog>
    </>
  );
}
