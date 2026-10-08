import { Text } from 'react-native';

import { Button } from '../ui';
import { useTheme } from '../../theme';
import type { LogForm } from './useLogForm';

/**
 * "Log it", and the line under it saying what the form still needs.
 *
 * Never disabled. An unfinished form is answered by that line, which is on
 * screen before the press as well as after it -- and said in danger ink once
 * a press has actually been refused.
 */
export function LogItButton({ form }: { form: LogForm }) {
  const { colors, type } = useTheme();
  const { createLog, outstanding, refused, submit } = form;

  return (
    <>
      <Button
        label={createLog.isPending ? 'Saving' : 'Log it'}
        icon="check"
        size="lg"
        full
        onPress={submit}
        loading={createLog.isPending}
      />

      {outstanding ? (
        <Text
          style={[
            type.caption,
            { color: refused ? colors.danger : colors.muted, textAlign: 'center' },
          ]}
        >
          {outstanding}
        </Text>
      ) : null}
    </>
  );
}
