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

  it('renders the leading emoji beside the label', () => {
    const { getByText } = render(<Chip label="Desi" leading="A" />);

    expect(getByText(/A\s+Desi/)).toBeTruthy();
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
