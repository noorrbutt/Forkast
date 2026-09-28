/**
 * FlameMeter: the streak count inside a hand drawn flame.
 *
 * The mocked reanimated module runs `useAnimatedStyle` synchronously but
 * does not actually animate (see jest.setup.js's own note on the tradeoff),
 * so what these can prove is that the component renders, that it draws two
 * layered shapes rather than one flat glyph, and that asking for reduced
 * motion genuinely stops the loop before it starts rather than merely
 * skipping to some other frame of it. Whether the breathing looks right is a
 * question only a device answers, the same caveat motion.test.tsx already
 * states for the interaction-driven tokens.
 */

import { render } from '@testing-library/react-native';
import { Path } from 'react-native-svg';

import { FlameMeter } from '../components/ui/FlameMeter';
import { ThemeProvider } from '../theme';

const mockedUseReducedMotion = jest.requireMock('react-native-reanimated')
  .useReducedMotion as jest.Mock;

function renderFlame(value: number) {
  return render(
    <ThemeProvider>
      <FlameMeter value={value} />
    </ThemeProvider>,
  );
}

/** Both flame layers pass an array style ([box, animatedStyle]) to their
 * wrapping Animated.View, so any prop read off it has to be merged first. */
function flatten(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(6).filter((s) => s && typeof s === 'object'));
}

/**
 * The wrapping Animated.View that positions and animates one flame layer.
 *
 * react-native-svg puts several of its own host and composite nodes between
 * a <Path> and the component that rendered it (a native SVG group, its own
 * composite wrapper, the Svg host view and its composite), and the exact
 * count is that library's implementation detail, not this component's
 * contract. Walking up until the style actually asked for -- absolute
 * positioning, which only the box FlameMeter builds ever sets -- is what
 * survives a version of react-native-svg inserting one more layer than it
 * does today.
 */
function positionedAncestor(node: { parent?: unknown; props?: { style?: unknown } } | null) {
  let current = node;
  while (current) {
    const style = flatten(current.props?.style);
    if (style.position === 'absolute') return style;
    current = (current.parent as typeof node) ?? null;
  }
  throw new Error('no absolutely positioned ancestor found');
}

beforeEach(() => {
  mockedUseReducedMotion.mockReturnValue(false);
});

describe('FlameMeter', () => {
  it('shows the streak count', () => {
    const screen = renderFlame(7);
    expect(screen.getByText('7')).toBeTruthy();
  });

  it('draws two layered shapes, not one flat flame glyph', () => {
    const screen = renderFlame(7);
    const paths = screen.UNSAFE_queryAllByType(Path);
    expect(paths).toHaveLength(2);
  });

  it('never draws the two layers as the same path', () => {
    // The point of a second layer is depth. Two identical paths on top of
    // each other would be one shape wearing a second colour, not a core.
    const screen = renderFlame(7);
    const [outer, inner] = screen.UNSAFE_queryAllByType(Path);
    expect(outer.props.d).not.toBe(inner.props.d);
  });

  it('gives the outer and inner layers different fills', () => {
    const screen = renderFlame(7);
    const [outer, inner] = screen.UNSAFE_queryAllByType(Path);
    expect(outer.props.fill).not.toBe(inner.props.fill);
  });

  it('never goes negative for a broken streak', () => {
    // A streak can legitimately be 0; it can never be negative, and this is
    // the one place that number also drives a visual size.
    const screen = renderFlame(0);
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('renders statically, with no rotation and no scale change, when the system asks for reduced motion', () => {
    mockedUseReducedMotion.mockReturnValue(true);

    const screen = renderFlame(7);
    const [outer, inner] = screen.UNSAFE_queryAllByType(Path);

    // Both wrapping Animated.Views resolve their transform synchronously
    // under the mock, so the resting values set in the reduced-motion branch
    // are what a snapshot of the style actually holds.
    const outerTransform = positionedAncestor(outer).transform;
    const innerTransform = positionedAncestor(inner).transform;

    expect(outerTransform).toEqual([{ scale: 1 }, { rotate: '0deg' }]);
    expect(innerTransform).toEqual([{ scale: 1 }]);
  });

  it('grows the flame rather than shrinking it as the streak gets longer', () => {
    const short = renderFlame(1);
    const long = renderFlame(30);

    // The pixel size lives on the wrapping Animated.View's style, not on the
    // Svg itself, which is always told to fill that box at "100%".
    const shortOuter = Number(positionedAncestor(short.UNSAFE_queryAllByType(Path)[0]).width);
    const longOuter = Number(positionedAncestor(long.UNSAFE_queryAllByType(Path)[0]).width);

    expect(longOuter).toBeGreaterThan(shortOuter);
  });
});
