/**
 * The class of bug where importing a module takes the app down.
 *
 * This is not about one library. Importing expo-notifications runs its device
 * push token auto registration as a side effect, and that throws in Expo Go
 * because SDK 53 removed remote push from that client. Forkast never asks for a
 * push token; the import alone was enough, and it crashed the whole app before a
 * single screen rendered, reached through the Profile tab.
 *
 * react-native-maps did the same thing to the web build for a different reason.
 * Two libraries, one shape of fault: a module that cannot be safely loaded
 * everywhere, loaded at the top of a file that is always loaded.
 *
 * So these read the source rather than the behaviour. A runtime test cannot
 * catch this, because in the runner every native module is mocked and the
 * import that throws on a device resolves quietly here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { palettes } from '../theme/tokens';

const root = join(__dirname, '..');
const read = (relative: string) => readFileSync(join(root, relative), 'utf8');

/** Anything matching this at the start of a line is a module scope import. */
const topLevelImport = (module: string) =>
  new RegExp(`^\\s*import\\s[^;]*from\\s+['"]${module}['"]`, 'm');

describe('modules that cannot be loaded everywhere', () => {
  it('never imports expo-notifications at module scope', () => {
    // The whole point: it has to be required on demand, behind a check, so that
    // in Expo Go it is never touched at all.
    const source = read('lib/notifications.ts');

    expect(topLevelImport('expo-notifications').test(source)).toBe(false);
    expect(source).toMatch(/require\('expo-notifications'\)/);
  });

  it('gates that require behind an availability check', () => {
    const source = read('lib/notifications.ts');

    expect(source).toMatch(/REMINDERS_AVAILABLE/);
    // appOwnership, not executionEnvironment: StoreClient covers a development
    // client too, which would disable reminders in the build that supports them.
    expect(source).toMatch(/appOwnership/);
  });

  it('keeps react-native-maps in the one file that has a web twin', () => {
    // MapCanvas.web.tsx sits beside MapCanvas.tsx and exports the same names
    // with the map removed, so Metro swaps it out and the import never happens
    // on web. Any other file importing it directly would undo that.
    const offenders = [
      'components/MapScreen.tsx',
      'app/map.tsx',
      'app/(tabs)/index.tsx',
      'app/(tabs)/history.tsx',
    ].filter((file) => {
      try {
        return topLevelImport('react-native-maps').test(read(file));
      } catch {
        return false;
      }
    });

    expect(offenders).toEqual([]);
    expect(topLevelImport('react-native-maps').test(read('components/MapCanvas.tsx'))).toBe(true);
  });

  it('has a web twin for the map module, or the swap does not happen', () => {
    expect(() => read('components/MapCanvas.web.tsx')).not.toThrow();
    expect(read('components/MapCanvas.web.tsx')).toMatch(/MAPS_UNAVAILABLE\s*=\s*true/);
  });
});

describe('storing a session on every platform', () => {
  it('does not lose the session on a web reload', () => {
    // expo-secure-store ships an empty object as its web implementation, so
    // every call fails there and the in memory fallback catches it. That works
    // and signs you out on every refresh, which on web is constant.
    const source = read('lib/tokenStore.ts');

    expect(source).toMatch(/sessionStorage/);
    expect(source).toMatch(/Platform\.OS !== 'web'/);
  });

  it('does not put a token anywhere that outlives the tab', () => {
    // sessionStorage, deliberately. Same blast radius as the in memory version,
    // and it survives the reload that makes web usable. Matched as a property
    // access rather than as a word, because the comment explaining the choice
    // names the thing it is choosing against.
    const code = read('lib/tokenStore.ts')
      .split(/\r?\n/)
      .filter((line: string) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
      .join(' ');

    expect(code).not.toMatch(/localStorage\s*[.[]/);
    expect(code).toMatch(/sessionStorage/);
  });

  it('probes the web store rather than assuming it works', () => {
    // Private mode and blocked site data make this throw on access, not on use.
    const source = read('lib/tokenStore.ts');

    expect(source).toMatch(/probe/);
    expect(source).toMatch(/catch/);
  });
});

/**
 * The colours that paint before a single React frame exists.
 *
 * app.config.js is read by Expo's CLI before any TypeScript is compiled, so it
 * cannot import the palette and has to keep copies. It carried a comment saying
 * the two must be changed together, which is not a mechanism, and they drifted:
 * the splash background was #FAFAF7, the exact pre-rebuild page colour that
 * contrast.test.ts was written to get rid of, against a real page of #F4F1EE.
 * So the launch sequence painted one background and the app painted a warmer
 * one a frame later, on the one screen everybody sees every time.
 *
 * Asserted by reading the config as text rather than by importing it, because
 * importing it executes an Expo config function that expects a CLI context.
 */
describe('the native config, against the palette it copies', () => {
  const config = read('app.config.js');

  const declared = (name: string): string => {
    const found = new RegExp(`const ${name} = '(#[0-9A-Fa-f]{6})'`).exec(config);
    if (!found) throw new Error(`app.config.js no longer declares ${name}`);
    return found[1].toLowerCase();
  };

  it('paints the dark splash and the adaptive icon in the real dark page colour', () => {
    expect(declared('INK')).toBe(palettes.dark.bg.toLowerCase());
  });

  it('paints the light splash in the real light page colour', () => {
    expect(declared('PAPER')).toBe(palettes.light.bg.toLowerCase());
  });

  it('tints the notification icon in the real accent', () => {
    // Dark's accent, because a notification is drawn on the system's surface
    // rather than on either of the app's pages.
    expect(declared('SAFFRON')).toBe(palettes.dark.accent.toLowerCase());
  });
});
