import { unlockHint } from '../components/home/unlockHints';

describe('unlockHint', () => {
  it('encourages a first log when there are no logs', () => {
    expect(unlockHint(0)).toBe('Log your first meal to start your streak and build your weekly digest.');
  });

  it('returns no hint after the first log', () => {
    expect(unlockHint(1)).toBeNull();
  });

  it('returns no hint at three logs, once both features are available', () => {
    expect(unlockHint(3)).toBeNull();
  });
});
