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

    const weightOf = (node: { props: Record<string, unknown> }) =>
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


describe('styles survive the animation wrapper', () => {
  // Reanimated has to inspect the style object to animate it, so an animated
  // component silently drops the ({ pressed }) => style callback that plain
  // Pressable accepts. Button and Chip both used that form, and on web it meant
  // they rendered with no fill, no border and no padding: bare text on the page.
  // The welcome screen shipped looking exactly like that.
  const flat = (node: { props: Record<string, unknown> }) => [node.props.style].flat(4);

  it.each([
    ['Button', () => render(<Button label="Sign in" />).getByRole('button')],
    ['Chip', () => render(<Chip label="Medium" />).getByRole('button')],
  ])('%s passes a resolved style, never a function', (_name, get) => {
    const node = get();

    expect(typeof node.props.style).not.toBe('function');
    const fill = flat(node).find((s) => s && typeof s === 'object' && 'backgroundColor' in s);
    expect(fill).toBeDefined();
  });

  it.each([
    ['Button', () => render(<Button label="Sign in" />).getByRole('button')],
    ['Chip', () => render(<Chip label="Medium" />).getByRole('button')],
  ])('%s actually renders a shape, not just a label', (_name, get) => {
    const style = Object.assign({}, ...flat(get()).filter((s) => s && typeof s === 'object'));

    // A control with no fill, no radius and no padding is text.
    expect(style.backgroundColor).toBeTruthy();
    expect(style.borderRadius).toBeGreaterThan(0);
    expect(style.paddingHorizontal).toBeGreaterThan(0);
  });
});

describe('every button variant is visibly a button', () => {
  // The ghost variant shipped with a transparent fill AND a transparent border,
  // so it measured 1.00:1 of shape contrast. Two screens used it for Remove and
  // Clear, sitting directly beside outlined buttons, and it read as floating
  // text rather than as a control. A quiet variant is allowed a lighter fill, it
  // is not allowed to have no shape at all.
  const VARIANTS = ['primary', 'secondary', 'ghost', 'danger'] as const;

  it.each(VARIANTS)('%s has either a fill or a visible border', (variant) => {
    const { getByRole } = render(<Button label="Remove" variant={variant} />);
    const style = Object.assign(
      {},
      ...[getByRole('button').props.style].flat(4).filter((s) => s && typeof s === 'object'),
    );

    const hasFill = style.backgroundColor && style.backgroundColor !== 'transparent';
    const hasEdge = style.borderColor && style.borderColor !== 'transparent' && style.borderWidth > 0;

    expect({ variant, visible: Boolean(hasFill || hasEdge) }).toEqual({ variant, visible: true });
  });

  it.each(VARIANTS)('%s is the same height as every other variant', (variant) => {
    // Consistency is the complaint. A row of buttons that do not line up reads
    // as a mistake even when each one is fine on its own.
    const pad = (v: (typeof VARIANTS)[number]) => {
      const { getByRole } = render(<Button label="Remove" variant={v} />);
      const style = Object.assign(
        {},
        ...[getByRole('button').props.style].flat(4).filter((s) => s && typeof s === 'object'),
      );
      return { paddingVertical: style.paddingVertical, borderWidth: style.borderWidth };
    };

    expect(pad(variant)).toEqual(pad('secondary'));
  });
});

describe('a chip never cuts its own label off', () => {
  // "Maintain" came out as "Maint..." in the goal row. The label carried
  // numberOfLines={1} and the caller squeezed each chip into a third of a row
  // inside a Card, which leaves about 58pt of text box for a word needing 66pt.
  // Raising the font from 13px to 15px, which was the right call for
  // readability, is what pushed it over.
  it('renders the whole word, not an ellipsis', () => {
    const { getByText } = render(<Chip label="Maintain" />);

    expect(getByText('Maintain')).toBeTruthy();
  });

  it('does not limit the label to a single line', () => {
    // Wrapping is survivable. Truncating is not, because the option becomes
    // unreadable exactly when it matters.
    const { getByText } = render(<Chip label="Maintain" />);

    expect(getByText('Maintain').props.numberOfLines).toBeUndefined();
  });

  it.each(['Cut', 'Maintain', 'Bulk', 'Small', 'Medium', 'Large', 'Small group'])(
    'renders %s in full',
    (label) => {
      const { getByText } = render(<Chip label={label} selected />);

      expect(getByText(label)).toBeTruthy();
    },
  );
});
