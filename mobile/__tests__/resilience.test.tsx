/**
 * What happens when something goes wrong, rather than when it goes right.
 *
 * Two separate concerns that share a cause. A screen that throws used to take
 * the entire React tree with it, because nothing anywhere caught: in Expo Go
 * and the browser that is the red screen, and in a shipped build it is a blank
 * page with no route left to navigate back to. And several pieces of state
 * outlived the thing that set them, so a failure in one place changed what a
 * later, unrelated screen did.
 */

import { render } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CrashView } from '../components/CrashView';

const root = join(__dirname, '..');
const read = (relative: string) => readFileSync(join(root, relative), 'utf8');

/** Source with comments stripped, so prose about a thing is not a use of it. */
const code = (relative: string) =>
  read(relative)
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('/*');
    })
    .join('\n');

describe('the crash screen', () => {
  it('names the problem instead of hiding it', () => {
    const { getByText } = render(
      <CrashView error={new Error('target is not an object')} retry={() => undefined} />,
    );

    expect(getByText('That screen broke.')).toBeTruthy();
    // Verbatim. A crash screen that swallows the cause turns a five minute fix
    // into a bug report that says "it broke".
    expect(getByText('target is not an object')).toBeTruthy();
  });

  it('offers a way back', () => {
    const retry = jest.fn();
    const { getByLabelText } = render(<CrashView error={new Error('x')} retry={retry} />);

    expect(getByLabelText('Try again')).toBeTruthy();
  });

  it('survives an error carrying no message', () => {
    // A thrown string, or an error constructed with nothing, both reach here.
    const { getByText } = render(<CrashView error={{} as Error} retry={() => undefined} />);

    expect(getByText('No message was attached to the error.')).toBeTruthy();
  });

  it('does not use the theme context, which is the thing that may be gone', () => {
    // expo-router mounts the boundary in place of the route that failed, and
    // for the root layout that is the component providing the theme. A boundary
    // consuming it would throw inside the handler for a throw. Rendered above
    // with no provider at all, which is the actual proof; this just states the
    // rule so it is not undone by someone tidying imports.
    expect(code('components/CrashView.tsx')).not.toMatch(/useTheme/);
  });
});

describe('the boundaries themselves', () => {
  it('exists at the root, where expo-router looks for it', () => {
    // The name is the wiring: expo-router installs its Try boundary only for a
    // layout or route that exports a component called exactly this.
    expect(read('app/_layout.tsx')).toMatch(/export function ErrorBoundary/);
  });

  it('exists again inside the tabs, so one bad tab keeps the tab bar', () => {
    expect(read('app/(tabs)/_layout.tsx')).toMatch(/export function ErrorBoundary/);
  });
});

describe('state that must not outlive what set it', () => {
  it('clears needsSetup when a session dies, not only on a deliberate sign out', () => {
    // Otherwise the flag survives, and signing in to an existing account lands
    // on the one time setup screen, where "Skip for now" sends the goal anyway
    // and overwrites that account's real goal with Maintain.
    const handler = /setAuthFailureHandler\(\(\) => \{[\s\S]*?\}\);/.exec(code('hooks/useAuth.tsx'));

    expect(handler).not.toBeNull();
    expect(handler?.[0]).toMatch(/setNeedsSetup\(false\)/);
  });

  it('clears needsSetup on every sign in', () => {
    const signIn = /const signIn = useCallback\([\s\S]*?\[adopt\],\s*\);/.exec(
      code('hooks/useAuth.tsx'),
    );

    expect(signIn).not.toBeNull();
    expect(signIn?.[0]).toMatch(/setNeedsSetup\(false\)/);
  });

  it('lets a failed setup save be skipped past', () => {
    // Setup is a convenience, not a gate, and the router sends the user
    // straight back here from anywhere else. With the API unreachable, both
    // buttons used to spin, print an error and leave them stuck.
    expect(code('app/setup.tsx')).toMatch(
      /onError: \(\) => \{\s*if \(!withTarget\) completeSetup\(\);/,
    );
  });

  it('empties the burn draft on close, not just the touched flag', () => {
    // The seeding effect cannot run while nothing is stored, so clearing only
    // `touched` left a cancelled draft in the field, pre-filled and saveable,
    // while the dashboard still read zero.
    const reset = /if \(!visible\) \{[\s\S]*?\}/.exec(code('components/BurnDialog.tsx'));

    expect(reset).not.toBeNull();
    expect(reset?.[0]).toMatch(/setDraft\(''\)/);
  });

  it('reseeds the target draft when the dialog is opened', () => {
    // `touched` was cleared only after a successful save, so a cancelled edit
    // made the stored value unreachable in the one dialog that edits it.
    expect(code('app/(tabs)/profile.tsx')).toMatch(
      /setTouched\(false\);\s*setDraft\(target != null \? String\(target\) : ''\);\s*setOpen\(true\);/,
    );
  });
});

describe('caches that have to move together', () => {
  it('moves the month trend whenever a meal changes', () => {
    // Four mutations write a meal: create, update, delete and repeat. Only
    // repeat invalidated the trend, so the card under the dashboard hero kept
    // its pre-meal figures while the hero moved.
    const invalidations = read('hooks/useLogs.ts').match(/queryKey: \['trend'\]/g) ?? [];

    expect(invalidations).toHaveLength(4);
  });

  it('moves the streak and the trend when the timezone changes', () => {
    // Timezone decides which calendar day a meal lands in, and the server
    // computes both in the account's zone.
    expect(code('hooks/useProfile.ts')).toMatch(/patch\.timezone !== undefined/);
  });

  it('does not ask for today\'s burn with nobody signed in', () => {
    // Signing out clears the cache, which refetches every active observer. This
    // was the only query hook without the gate, so it fired with no token, took
    // the unrecoverable branch on the 401, and that branch clears the cache
    // again: a burst of failing requests on every sign out.
    expect(code('hooks/useBurn.ts')).toMatch(/enabled: signedIn/);
  });
});
