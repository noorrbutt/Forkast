/**
 * The loading placeholder, and the one thing worth proving about it:
 * reduced motion actually stops the pulse rather than merely skipping to
 * some other frame of it. The mocked reanimated module runs synchronously
 * but does not animate (see jest.setup.js's own note), so whether the pulse
 * looks right is a question only a device answers -- what this can prove is
 * that the resting opacity differs between the two branches, which is the
 * whole point of checking reduced motion at all.
 */

import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Skeleton, SkeletonCard, SkeletonText } from '../components/ui/Skeleton';
import { ThemeProvider } from '../theme';

const mockedUseReducedMotion = jest.requireMock('react-native-reanimated')
  .useReducedMotion as jest.Mock;

function flat(style: unknown): { opacity?: number; width?: number; height?: number } {
  return (StyleSheet.flatten([style].flat(4) as never) ?? {}) as {
    opacity?: number;
    width?: number;
    height?: number;
  };
}

beforeEach(() => {
  mockedUseReducedMotion.mockReturnValue(false);
});

describe('Skeleton', () => {
  it('renders at the given size', () => {
    const { UNSAFE_root } = render(<Skeleton width={200} height={16} />, {
      wrapper: ThemeProvider,
    });
    const box = UNSAFE_root.findByType(require('react-native-reanimated').default.View);
    expect(flat(box.props.style)).toEqual(
      expect.objectContaining({ width: 200, height: 16 }),
    );
  });

  it('is hidden from a screen reader, since it stands for content that has not landed yet', () => {
    const { UNSAFE_root } = render(<Skeleton width={200} height={16} />, {
      wrapper: ThemeProvider,
    });
    const box = UNSAFE_root.findByType(require('react-native-reanimated').default.View);
    expect(box.props.accessibilityElementsHidden).toBe(true);
    expect(box.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('rests at a different, static opacity when the system asks for reduced motion', () => {
    const AnimatedView = require('react-native-reanimated').default.View;

    mockedUseReducedMotion.mockReturnValue(false);
    const moving = flat(
      render(<Skeleton width={200} height={16} />, { wrapper: ThemeProvider }).UNSAFE_root.findByType(
        AnimatedView,
      ).props.style,
    ).opacity;

    mockedUseReducedMotion.mockReturnValue(true);
    const still = flat(
      render(<Skeleton width={200} height={16} />, { wrapper: ThemeProvider }).UNSAFE_root.findByType(
        AnimatedView,
      ).props.style,
    ).opacity;

    expect(still).not.toBe(moving);
  });
});

describe('SkeletonText', () => {
  it('sizes itself off the given font size rather than a fixed height', () => {
    const { UNSAFE_root } = render(<SkeletonText width="60%" fontSize={32} />, {
      wrapper: ThemeProvider,
    });
    const box = UNSAFE_root.findByType(require('react-native-reanimated').default.View);
    expect(flat(box.props.style).height).toBeLessThan(32);
    expect(flat(box.props.style).height).toBeGreaterThan(16);
  });
});

describe('SkeletonCard', () => {
  it('draws the requested number of lines', () => {
    // Queried by the component itself rather than by the Animated.View it
    // renders down to, which is not a safe proxy for "one per row": nothing
    // here promises ThemeProvider or Card never render one of their own.
    const { UNSAFE_root } = render(<SkeletonCard rows={3} />, { wrapper: ThemeProvider });
    const lines = UNSAFE_root.findAllByType(SkeletonText);
    expect(lines).toHaveLength(3);
  });
});
