/**
 * The class of bug where a call works on a phone and quietly does nothing in a
 * browser.
 *
 * Every entry here was a real defect found in the shipped source, and they all
 * share a shape: react-native-web implements the module, so the import
 * resolves, the types check and the code runs. It just throws the argument
 * away. Nothing throws, nothing logs, and the feature is simply absent.
 *
 * These read the source rather than the behaviour, for the same reason
 * native-safety.test.ts does: the runner is neither a browser nor a device, so
 * a runtime test here would prove nothing about either. Each one also asserts
 * against the library itself, so if react-native-web ever implements the prop,
 * the test says so instead of quietly guarding nothing.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (relative: string) => readFileSync(join(root, relative), 'utf8');
const readDep = (relative: string) => readFileSync(join(root, 'node_modules', relative), 'utf8');

/** Source with comments stripped, so prose about a thing is not a use of it. */
const code = (relative: string) =>
  read(relative)
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('/*');
    })
    .join('\n');

describe('images that need an Authorization header', () => {
  it('still has a reason to exist: react-native-web drops source.headers', () => {
    const image = readDep('react-native-web/dist/exports/Image/index.js');
    const loader = readDep('react-native-web/dist/modules/ImageLoader/index.js');

    expect(image).not.toMatch(/headers/);
    expect(loader).not.toMatch(/headers/);
  });

  it('routes both authenticated images through the platform seam', () => {
    // The seam is what turns {uri, headers} into something the platform's
    // Image can actually load. Passing the source straight to Image works on
    // iOS and Android and renders an empty box in a browser.
    expect(code('hooks/usePhoto.ts')).toMatch(/useAuthedImage\(/);
    expect(code('hooks/useAvatar.ts')).toMatch(/useAuthedImage\(/);
  });

  it('has a web twin for the seam, or the swap never happens', () => {
    expect(() => read('lib/authedImage.web.ts')).not.toThrow();
    // Fetched with the header, handed over as an object url.
    expect(read('lib/authedImage.web.ts')).toMatch(/createObjectURL/);
  });

  it('revokes the object url, because a scrolled diary is a lot of images', () => {
    expect(read('lib/authedImage.web.ts')).toMatch(/revokeObjectURL/);
  });
});

describe('uploading a picked file', () => {
  it('never appends a file descriptor object directly', () => {
    // React Native's FormData takes {uri, name, type} and streams the file.
    // The browser's follows the spec and coerces any non-Blob to a string, so
    // the same call sent the literal text "[object Object]" and got a 422.
    const offenders = ['hooks/usePhoto.ts', 'hooks/useAvatar.ts'].filter((file) =>
      /form\.append\(\s*'file'\s*,\s*\{/.test(code(file)),
    );

    expect(offenders).toEqual([]);
  });

  it('goes through the seam instead', () => {
    expect(code('hooks/usePhoto.ts')).toMatch(/appendFile\(/);
    expect(code('hooks/useAvatar.ts')).toMatch(/appendFile\(/);
    expect(() => read('lib/upload.web.ts')).not.toThrow();
    expect(read('lib/upload.web.ts')).toMatch(/new File\(/);
  });

  it('proves the browser really does stringify the old shape', () => {
    const form = new FormData();
    form.append('file', { uri: 'blob:x', name: 'meal.jpeg', type: 'image/jpeg' } as never);

    expect(typeof form.get('file')).toBe('string');
    expect(String(form.get('file'))).toBe('[object Object]');
  });
});

describe('confirmations', () => {
  it('still has a reason to exist: react-native-web Alert is an empty method', () => {
    const alert = readDep('react-native-web/dist/exports/Alert/index.js');

    // The whole module is a class with one static method whose body is empty.
    expect(alert).toMatch(/static\s+alert\s*\(\s*\)\s*\{\s*\}/);
  });

  it('never confirms a destructive action through Alert', () => {
    // Every one of these deletes something with no undo, so a confirmation that
    // silently does not appear is worse than no confirmation at all.
    const destructive = [
      'components/MealPhoto.tsx',
      'components/ProfileAvatar.tsx',
      'app/(tabs)/profile.tsx',
    ].filter((file) => /Alert\.alert\(/.test(code(file)));

    expect(destructive).toEqual([]);
  });
});

describe('tap targets', () => {
  it('still has a reason to exist: react-native-web Pressable ignores hitSlop', () => {
    const pressable = readDep('react-native-web/dist/exports/Pressable/index.js');

    expect(pressable).not.toMatch(/hitSlop/);
  });

  it('gives small controls a real box rather than relying on hitSlop', () => {
    // hitSlop is additive and harmless where it is implemented, but it cannot
    // be the only thing making a 16pt icon reachable, because in a browser it
    // is not there at all.
    const files = [
      'components/StarRating.tsx',
      'components/ui/Screen.tsx',
      'components/ui/Select.tsx',
    ];

    for (const file of files) {
      const source = code(file);
      expect(source).toMatch(/minHeight: 44/);
      expect(source).toMatch(/minWidth: 44/);
    }
  });
});

describe('refreshing', () => {
  it('still has a reason to exist: react-native-web RefreshControl drops onRefresh', () => {
    const control = readDep('react-native-web/dist/exports/RefreshControl/index.js');

    // It destructures the props out and renders a bare View with the rest.
    expect(control).toMatch(/_excluded/);
    expect(control).not.toMatch(/props\.onRefresh\(\)/);
  });

  it('leaves the browser a way to refresh, since pull to refresh is not one', () => {
    expect(code('lib/queryClient.ts')).toMatch(
      /refetchOnWindowFocus:\s*Platform\.OS === 'web'/,
    );
  });
});

describe('reminders', () => {
  it('is unavailable on web, where the scheduler does not exist', () => {
    // appOwnership is null in a browser, so the Expo Go check alone said
    // reminders were available there. The permission half of
    // expo-notifications does work on web, so the row raised a real browser
    // permission prompt and flipped to "On" for a feature that can never fire.
    expect(code('lib/notifications.ts')).toMatch(/Platform\.OS !== 'web'/);
  });

  it('is actually consulted by the screen that offers the switch', () => {
    // It was imported here and never read, so the guard existed and did
    // nothing. Matching an `if` rather than the bare name, because an unused
    // import matches the name too, which is exactly how this went unnoticed.
    expect(code('app/(tabs)/profile.tsx')).toMatch(/if \(!REMINDERS_AVAILABLE\)/);
  });
});
