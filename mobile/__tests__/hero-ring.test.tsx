/**
 * The two primitives the style guide is built on.
 *
 * Both exist because a rule that lives at the call site gets forgotten. The hero
 * shrinks itself rather than trusting every screen to pick a safe size, and the
 * ring grows its own scale rather than trusting a caller to notice that going
 * over target is the state a progress bar normally hides.
 */

import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Hero } from '../components/ui/Hero';
import { Ring } from '../components/ui/Ring';
import { ThemeProvider } from '../theme';

const wrap = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

// The runner's default window is 750pt wide, which is a tablet. The step down
// rule exists for a phone, so the phone is what these measure against.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

const styleOf = (node: { props: Record<string, unknown> }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter((s) => s && typeof s === 'object'));

describe('Hero', () => {
  it('renders the value at the reserved size', () => {
    const { getByText } = render(<Hero value="1,400" />, { wrapper: wrap });

    expect(styleOf(getByText('1,400')).fontSize).toBe(64);
  });

  it('steps down rather than overflowing a long value', () => {
    // At 64pt a glyph runs about 35pt, so a 390pt phone's 342pt column holds
    // nine characters and no more. Ten is where the rule has to fire, and
    // letting a caller handle it is how "Maintain" became "Maint...".
    const short = styleOf(render(<Hero value="850" />, { wrapper: wrap }).getByText('850'));
    const long = styleOf(
      render(<Hero value="999,999,999" />, { wrapper: wrap }).getByText('999,999,999'),
    );

    expect(long.fontSize).toBeLessThan(short.fontSize);
  });

  it('keeps the line height with the size when it steps down', () => {
    // The token's line height is tuned to 64, so a stepped down hero would
    // otherwise sit in a box meant for a taller one.
    const node = styleOf(
      render(<Hero value="999,999,999" />, { wrapper: wrap }).getByText('999,999,999'),
    );

    expect(node.lineHeight).toBeLessThan(70);
    expect(node.lineHeight).toBeGreaterThan(node.fontSize);
  });

  it('never shrinks past the point of being a hero', () => {
    const node = styleOf(
      render(<Hero value="999,999,999" />, { wrapper: wrap }).getByText('999,999,999'),
    );

    // Below this it stops outranking a page title and the screen needs a
    // different composition, not a smaller number.
    expect(node.fontSize).toBeGreaterThanOrEqual(44);
  });

  it('carries a caption without competing with it', () => {
    const { getByText } = render(<Hero value="1,400" caption="left today" />, { wrapper: wrap });

    const hero = styleOf(getByText('1,400')).fontSize;
    const caption = styleOf(getByText('left today')).fontSize;
    expect(hero / caption).toBeGreaterThanOrEqual(4);
  });
});

describe('Ring', () => {
  it('draws nothing when there is no target to be a proportion of', () => {
    // A ring with no limit is a circle with nothing to fill, so the screen
    // shows the number alone instead.
    const { UNSAFE_queryAllByType } = render(
      <Ring value={1400} max={null}>
        <Text>1,400</Text>
      </Ring>,
      { wrapper: wrap },
    );

    expect(UNSAFE_queryAllByType(require('react-native-svg').default)).toHaveLength(0);
  });

  it('renders whatever it is given in the middle', () => {
    const { getByText } = render(
      <Ring value={1400} max={1800}>
        <Text>1,400</Text>
      </Ring>,
      { wrapper: wrap },
    );

    expect(getByText('1,400')).toBeTruthy();
  });

  it('fills proportionally under target', () => {
    const { UNSAFE_getAllByType } = render(
      <Ring value={900} max={1800}>
        <Text>900</Text>
      </Ring>,
      { wrapper: wrap },
    );
    const circles = UNSAFE_getAllByType(require('react-native-svg').Circle);
    const track = Number(String(circles[0].props.strokeDasharray).split(' ')[0]);
    const fill = Number(String(circles[1].props.strokeDasharray).split(' ')[0]);

    expect(fill / track).toBeCloseTo(0.5, 1);
  });

  it('grows its scale past the target instead of pinning at full', () => {
    // The failure this component exists to avoid: a bar that caps at 100% makes
    // 1,801 and 3,000 look identical.
    const at = UNSAFE_fillFraction(1800, 1800);
    const over = UNSAFE_fillFraction(3600, 1800);

    expect(at).toBeCloseTo(1, 2);
    // Twice the target still fills the arc, but the target tick has moved to
    // halfway, so the overshoot is visible as distance.
    expect(over).toBeCloseTo(1, 2);
    expect(UNSAFE_targetOffset(3600, 1800)).toBeLessThan(UNSAFE_targetOffset(1900, 1800));
  });

  it('changes colour when over, but that is never the only signal', () => {
    const under = UNSAFE_fillColor(900, 1800);
    const over = UNSAFE_fillColor(2400, 1800);

    expect(under).not.toEqual(over);
    // The target tick only exists in the over case, so geometry carries it too.
    expect(UNSAFE_circleCount(2400, 1800)).toBeGreaterThan(UNSAFE_circleCount(900, 1800));
  });
});

function renderRing(value: number, max: number) {
  return render(
    <Ring value={value} max={max}>
      <Text>{String(value)}</Text>
    </Ring>,
    { wrapper: wrap },
  ).UNSAFE_getAllByType(require('react-native-svg').Circle);
}
function UNSAFE_fillFraction(value: number, max: number) {
  const c = renderRing(value, max);
  const track = Number(String(c[0].props.strokeDasharray).split(' ')[0]);
  return Number(String(c[1].props.strokeDasharray).split(' ')[0]) / track;
}
function UNSAFE_fillColor(value: number, max: number) {
  return renderRing(value, max)[1].props.stroke;
}
function UNSAFE_circleCount(value: number, max: number) {
  return renderRing(value, max).length;
}
function UNSAFE_targetOffset(value: number, max: number) {
  const c = renderRing(value, max);
  return Math.abs(Number(c[2]?.props.strokeDashoffset ?? 0));
}
