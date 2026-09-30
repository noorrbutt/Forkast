/**
 * The breakpoint hook, at the three window sizes it actually has to tell
 * apart: a phone, a small tablet in portrait (or a phone turned sideways),
 * and a tablet or wide browser window with room for two columns.
 */

import { renderHook } from '@testing-library/react-native';

let mockWidth = 390;
let mockHeight = 844;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: mockHeight, scale: 3, fontScale: 1 }),
}));

import { BREAKPOINTS, useLayout } from '../theme/useLayout';

function setWindow(width: number, height = 844) {
  mockWidth = width;
  mockHeight = height;
}

describe('useLayout', () => {
  it('reads a phone in portrait as compact', () => {
    setWindow(390, 844);
    const { result } = renderHook(() => useLayout());

    expect(result.current.breakpoint).toBe('compact');
    expect(result.current.isAtLeastMedium).toBe(false);
    expect(result.current.isExpanded).toBe(false);
  });

  it('reads the narrowest phone this app supports as compact, not broken', () => {
    setWindow(320, 568);
    const { result } = renderHook(() => useLayout());

    expect(result.current.breakpoint).toBe('compact');
  });

  it('reads a phone turned sideways as at least medium, not compact', () => {
    // A 390pt phone rotated is roughly 844 wide -- past even the expanded
    // threshold, since a phone's short edge plus its long edge minus the
    // safe areas is genuinely close to small-tablet width. The breakpoint
    // only has to stop treating it as a single narrow column; which of the
    // two wider breakpoints it lands on is a detail neither the hook nor a
    // screen reading `isAtLeastMedium` needs to get exactly right.
    setWindow(844, 390);
    const { result } = renderHook(() => useLayout());

    expect(result.current.breakpoint).not.toBe('compact');
    expect(result.current.isAtLeastMedium).toBe(true);
  });

  it('reads a smaller phone turned sideways as medium specifically', () => {
    // 667pt (an iPhone SE/8-class phone's long edge) sits inside the medium
    // band, not expanded, which is the case the boundary test below cannot
    // exercise on its own.
    setWindow(667, 375);
    const { result } = renderHook(() => useLayout());

    expect(result.current.breakpoint).toBe('medium');
    expect(result.current.isAtLeastMedium).toBe(true);
    expect(result.current.isExpanded).toBe(false);
  });

  it('reads a small tablet in portrait as medium', () => {
    setWindow(768, 1024);
    const { result } = renderHook(() => useLayout());

    expect(result.current.breakpoint).toBe('medium');
  });

  it('reads a large tablet or a wide window as expanded', () => {
    setWindow(1024, 1366);
    const { result } = renderHook(() => useLayout());

    expect(result.current.breakpoint).toBe('expanded');
    expect(result.current.isAtLeastMedium).toBe(true);
    expect(result.current.isExpanded).toBe(true);
  });

  it('treats the boundary itself as the wider breakpoint', () => {
    setWindow(BREAKPOINTS.medium, 900);
    expect(renderHook(() => useLayout()).result.current.breakpoint).toBe('medium');

    setWindow(BREAKPOINTS.expanded, 900);
    expect(renderHook(() => useLayout()).result.current.breakpoint).toBe('expanded');

    setWindow(BREAKPOINTS.medium - 1, 900);
    expect(renderHook(() => useLayout()).result.current.breakpoint).toBe('compact');
  });
});
