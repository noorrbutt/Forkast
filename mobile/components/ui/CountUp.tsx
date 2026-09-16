import { useEffect } from 'react';
import { TextInput, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { formatNumber } from '../../lib/format';
import { motion } from '../../theme/motion';

/**
 * An uneditable TextInput, not a Text.
 *
 * Text has no animatable prop carrying its content, so driving it from the UI
 * thread is impossible. TextInput does, through `text`, which is why this is
 * the established way to animate a number in reanimated. The input is disabled
 * and stripped of its own padding so it behaves as a label.
 */
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

type CountUpProps = {
  value: number;
  style?: StyleProp<TextStyle>;
  /** Appended after the number, for example " kcal". Not animated. */
  suffix?: string;
};

/**
 * A number that counts up to its value instead of appearing at it.
 *
 * The animation runs entirely on the UI thread, so a number ticking sixty times
 * a second does not re-render the screen sixty times. That matters on the
 * dashboard, where several of these run beside a chart.
 *
 * It animates from whatever it currently shows, so a refresh that changes 1,840
 * to 1,910 counts the difference rather than restarting from zero.
 */
export function CountUp({ value, style, suffix = '' }: CountUpProps) {
  const shown = useSharedValue(0);

  useEffect(() => {
    shown.value = withTiming(value, motion.counter);
  }, [value, shown]);

  const animatedProps = useAnimatedProps(() => {
    'worklet';
    // toLocaleString does not exist in the worklet runtime, so the thousands
    // separator is inserted by hand.
    const rounded = Math.round(shown.value);
    const digits = String(Math.abs(rounded));
    let grouped = '';
    for (let i = 0; i < digits.length; i += 1) {
      if (i > 0 && (digits.length - i) % 3 === 0) grouped += ',';
      grouped += digits[i];
    }
    return { text: `${rounded < 0 ? '-' : ''}${grouped}${suffix}` } as never;
  });

  return (
    <AnimatedTextInput
      editable={false}
      // Never focusable: this is a label that happens to animate.
      pointerEvents="none"
      underlineColorAndroid="transparent"
      style={[{ padding: 0, margin: 0 }, style]}
      animatedProps={animatedProps}
      defaultValue={`0${suffix}`}
      accessibilityLabel={`${formatNumber(value)}${suffix}`}
    />
  );
}
