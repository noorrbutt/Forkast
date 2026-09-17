/**
 * The controls you touch, and what they do besides call onPress.
 *
 * Scope worth being honest about: reanimated is mocked in this environment, so
 * nothing here proves a spring settles or that a scale actually animates. What
 * it does prove is that the right handler is wired, that the haptic fires on
 * the right interaction and not the wrong one, and that a disabled control is
 * genuinely inert rather than merely looking it.
 */

import * as Haptics from 'expo-haptics';
import { fireEvent, render } from '@testing-library/react-native';

import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';

const mocked = Haptics as jest.Mocked<typeof Haptics>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Chip', () => {
  it('ticks as the finger goes down, not when it lifts', () => {
    const { getByText } = render(<Chip label="Biryani" />);

    fireEvent(getByText('Biryani'), 'pressIn');

    // Feedback that waits for press out arrives after the decision, which reads
    // as lag rather than as response.
    expect(mocked.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Chip label="Karahi" onPress={onPress} />);

    fireEvent.press(getByText('Karahi'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all when disabled', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Chip label="Nihari" onPress={onPress} disabled />);

    fireEvent(getByText('Nihari'), 'pressIn');
    fireEvent.press(getByText('Nihari'));

    expect(mocked.selectionAsync).not.toHaveBeenCalled();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('renders the leading emoji as its own node, not glued to the label', () => {
    // Separate nodes on purpose: a search over option labels must never match
    // an emoji, and the glyph needs its own size rather than inheriting the
    // label's.
    const { getByText } = render(<Chip label="Desi" leading="A" />);

    expect(getByText('A')).toBeTruthy();
    expect(getByText('Desi')).toBeTruthy();
  });

  it('keeps the label the same weight whether or not it is selected', () => {
    // Selecting used to flip fontWeight 500 to 600, which widened the text
    // inside a fixed flex:1 box with numberOfLines={1}, so at larger font
    // scales "Medium" truncated to "Medi..." exactly when it was chosen.
    const plain = render(<Chip label="Medium" />).getByText('Medium');
    const picked = render(<Chip label="Medium" selected />).getByText('Medium');

    const weightOf = (node: { props: { style: unknown } }) =>
      [node.props.style].flat(3).find((s) => s && typeof s === 'object' && 'fontWeight' in s);

    expect(weightOf(picked)).toEqual(weightOf(plain));
  });

  it('is big enough to hit on both platforms', () => {
    // 41pt and 37pt were both under the 44pt iOS and 48dp Android minimums.
    const { getByRole } = render(<Chip label="Small" />);
    const style = [getByRole('button').props.style].flat(3).find(
      (s) => s && typeof s === 'object' && 'minHeight' in s,
    );

    expect((style as { minHeight: number }).minHeight).toBeGreaterThanOrEqual(48);
  });

  it('reports its selected state to assistive tech', () => {
    const { getByRole } = render(<Chip label="Squad" selected />);

    expect(getByRole('button', { selected: true })).toBeTruthy();
  });
});

describe('Button', () => {
  it('stays silent on a primary action', () => {
    const { getByText } = render(<Button label="Log it" onPress={jest.fn()} />);

    fireEvent(getByText('Log it'), 'pressIn');

    // The meaningful haptic for a primary action is the success one that fires
    // when the work finishes. Two in quick succession reads as a stutter.
    expect(mocked.selectionAsync).not.toHaveBeenCalled();
  });

  it('ticks on a secondary action, where nothing else will', () => {
    const { getByText } = render(<Button label="Cancel" variant="secondary" onPress={jest.fn()} />);

    fireEvent(getByText('Cancel'), 'pressIn');

    expect(mocked.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('is inert while loading, so a slow save cannot be submitted twice', () => {
    const onPress = jest.fn();
    const { getByRole } = render(<Button label="Saving" onPress={onPress} loading />);

    // The label is replaced by a spinner while loading, so reach for the role.
    fireEvent.press(getByRole('button'));

    expect(onPress).not.toHaveBeenCalled();
  });

  it('marks itself busy for assistive tech while loading', () => {
    const { getByRole } = render(<Button label="Saving" loading />);

    expect(getByRole('button', { busy: true })).toBeTruthy();
  });

  it('does not fire when disabled', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Button label="Log it" onPress={onPress} disabled />);

    fireEvent.press(getByText('Log it'));

    expect(onPress).not.toHaveBeenCalled();
  });
});
