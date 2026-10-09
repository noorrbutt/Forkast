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

  it('explains itself without naming developer tooling', () => {
    // The row read "Expo Go and the browser cannot schedule them", which names
    // a tool nobody using the app has heard of. Comments may say it; copy may not.
    expect(code('app/(tabs)/profile.tsx')).not.toMatch(/Expo Go/);
  });
});

describe('a row of three buttons', () => {
  /**
   * The photo row overflowed its screen and wrapped.
   *
   * With a photo attached it asks for "Retake", "Choose" and "Remove". At the
   * old 24pt of horizontal padding a side that measured about 360pt against the
   * 342pt a 390pt phone actually offers, so the third button dropped to a second
   * line and left-aligned under the first. It missed by 18pt, which is why it
   * reproduces on an iPhone 14 and not on a Pro Max or in a browser.
   *
   * These guard the fix at the source rather than by re-measuring text, which a
   * test runner cannot do honestly: it has no font metrics.
   */
  it('gives Button a compact padding that is tighter but not zero', () => {
    const source = code('components/ui/Button.tsx');

    expect(source).toMatch(/compact\?: boolean/);
    expect(source).toMatch(/const horizontalPad = compact \? spacing\.lg : spacing\.xl/);
    expect(source).toMatch(/paddingHorizontal: horizontalPad/);
  });

  it('never makes compact mean shorter, which would break the tap target', () => {
    // Button has no minHeight, unlike Chip, so its height is entirely the
    // vertical padding plus the line height. Taking padding off there would
    // drop it under 48pt with nothing to catch it.
    const source = code('components/ui/Button.tsx');
    const vertical = /const verticalPad = [^;]+;/.exec(source);

    expect(vertical).not.toBeNull();
    expect(vertical?.[0]).not.toMatch(/compact/);
  });

  it('applies compact to every button in the photo row', () => {
    // This used to loop over two files, because app/logs/[id].tsx reimplemented
    // the control rather than using MealPhoto, so the fix had to be made twice
    // or the screen the user named first stayed broken. There is one copy now.
    const compacts = code('components/MealPhotoActions.tsx').match(/\bcompact\b/g) ?? [];

    expect(compacts.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps the row wrapping, which is the sanctioned way to degrade', () => {
    // Above the largest non-accessibility text size three labels cannot share a
    // line on any phone at any padding. The guide says wrap, never truncate, so
    // flexWrap has to survive anyone tidying it away once the row fits.
    expect(code('components/MealPhotoActions.tsx')).toMatch(/flexWrap: 'wrap'/);
  });

  it('never truncates a button label', () => {
    // "Maintain" became "Maint..." once already, from exactly this shape of
    // problem solved with flex: 1 and numberOfLines.
    expect(code('components/ui/Button.tsx')).not.toMatch(/numberOfLines/);
  });
});

describe('icons name a destination, never a heading', () => {
  it('puts one on each of the dashboard navigation rows', () => {
    const source = code('app/(tabs)/index.tsx');

    // One row now. The diary row went, because Diary is a tab in the bar,
    // and the plan moved into Home's next card.
    expect(source).toMatch(/icon="map"/);
    expect(source).toMatch(/<NextCard/);
  });

  it('gives every row an icon or none, because a bare row breaks the group edge', () => {
    // ListRow lays the icon out beside the text column, so a row without one
    // starts its label 44pt further left than its neighbours.
    const group = /<ListGroup>[\s\S]*?<\/ListGroup>/.exec(code('app/(tabs)/index.tsx'));

    expect(group).not.toBeNull();
    const rows = group?.[0].match(/<ListRow/g) ?? [];
    const icons = group?.[0].match(/icon="/g) ?? [];
    expect(icons.length).toBe(rows.length);
  });

  it('does not put one back beside the photo label', () => {
    // Section 10's original offence. A ControlLabel labels content you are
    // already looking at and it is not tappable, so nothing goes beside it.
    const source = code('components/MealPhoto.tsx');
    const heading = /<ControlLabel>Photo<\/ControlLabel>/.exec(source);

    expect(heading).not.toBeNull();
    expect(source).not.toMatch(/<Icon[^>]*\/>\s*<ControlLabel>/);
  });

  it('labels a group of controls the same way on both forms', () => {
    // The log form and the meal screen ask the same four questions. They used
    // to draw them at two different ranks, 12/500 on one and 16/600 on the
    // other, which is the rule against two screens solving one problem two
    // ways. Neither may reintroduce a local label to do it.
    for (const screen of ['app/(tabs)/log.tsx', 'app/logs/[id].tsx']) {
      const source = code(screen);
      expect(source).toMatch(/<ControlLabel>Serving size<\/ControlLabel>/);
      expect(source).not.toMatch(/function ControlLabel/);
    }
  });
});

describe('an authenticated image on Android', () => {
  /**
   * The header only reaches Android if the source is an array.
   *
   * This is the third variation of one bug: the same {uri, headers} source
   * works on iOS, is ignored by react-native-web, and is silently stripped by
   * Android. The first two were fixed with a web twin; this one is a shape.
   */
  it('still has a reason to exist: Android reads headers only from an array', () => {
    const android = readDep('react-native/Libraries/Image/Image.android.js');

    // The array branch hoists them onto the native prop.
    expect(android).toMatch(/if \(Array\.isArray\(source_\)\)/);
    expect(android).toMatch(/nativeProps\.headers = sourceHeaders/);

    // And the object branch destructures uri, width and height, never headers.
    const objectBranch = /\} else \{\s*const \{uri, width: sourceWidth, height: sourceHeight\} = source_;/.exec(
      android,
    );
    expect(objectBranch).not.toBeNull();
  });

  it('hands the native platforms an array, not a bare object', () => {
    const source = code('lib/authedImage.ts');

    expect(source).toMatch(/return source \? \[source\] : undefined/);
  });

  it('does not let Avatar rebuild the broken shape in the middle', () => {
    // Avatar used to take a uri and a headers map and reassemble them into the
    // exact plain object the array exists to avoid.
    const source = code('components/ui/Avatar.tsx');

    expect(source).not.toMatch(/\{ uri, headers \}/);
    expect(source).toMatch(/source\?: ImageSourcePropType/);
  });
});

/**
 * A form running the full width of a tablet or a browser is not a design.
 *
 * This is here rather than in a design test because the browser is where it
 * actually bites: on a phone the cap never binds, so the three screens that had
 * forgotten it looked correct on every device anyone tested them on, and only
 * stretched once the same code ran in a window 1,400pt wide.
 *
 * The widths live in `layout` so a screen inherits one rather than remembering
 * to declare it. They were nine separate constants before, which is exactly how
 * three screens ended up without one.
 */
describe('the content column', () => {
  const SCREENS = [
    'app/(auth)/login.tsx',
    'app/(auth)/register.tsx',
    'app/(auth)/welcome.tsx',
    'app/(tabs)/history.tsx',
    'app/(tabs)/index.tsx',
    'app/(tabs)/log.tsx',
    'app/(tabs)/plan.tsx',
    'app/(tabs)/profile.tsx',
    'app/(tabs)/streaks.tsx',
    'app/logs/[id].tsx',
    'app/setup.tsx',
    'app/trends.tsx',
    'components/MapScreen.tsx',
  ];

  it.each(SCREENS)('is capped and centred on %s', (screen) => {
    const source = code(screen);

    expect(source).toMatch(/maxWidth:/);
    expect(source).toMatch(/alignSelf: 'center'/);
  });

  it('takes the width from a token rather than a number per screen', () => {
    // Welcome is the one exception and says why in a comment: centred text
    // wants a shorter measure than the forms use, or the lines come out
    // lopsided.
    for (const screen of SCREENS.filter((s) => !s.includes('welcome'))) {
      // Not anchored to `maxWidth: layout.contentWidth` literally: the
      // dashboard derives its expanded-breakpoint cap from the same token
      // (`layout.contentWidth * 1.75`, see useLayout's own note on why),
      // which is still "the width comes from the shared token" and not a
      // screen inventing its own number -- the thing this test actually
      // guards against.
      expect(code(screen)).toMatch(/maxWidth:[\s\S]{0,80}?layout\.(content|form)Width/);
    }
  });
});

/**
 * Within one ListGroup, either every row carries an icon or none does.
 *
 * Section 10 added this when it allowed a leading icon on a navigation row. The
 * icon box is a sibling of the text column, so a bare row next to an iconned
 * one starts its label 44pt further left and the group visibly loses its edge.
 * The profile screen shipped exactly that: Change password and Delete my
 * account wore glyphs while Sign out, Goal, Timezone and Reminders did not.
 */
describe('icons inside a group of rows', () => {
  const GROUPS = [
    'app/(tabs)/index.tsx',
    'app/(tabs)/profile.tsx',
    'components/ChangePassword.tsx',
    'components/DeleteAccount.tsx',
  ];

  it('never mixes iconned and bare rows in the profile settings', () => {
    // The three components that render into the profile's groups, read
    // together, because the group is assembled across files.
    const source = GROUPS.slice(1).map(code).join('\n');
    const rows = source.match(/<ListRow/g) ?? [];
    const icons = source.match(/^\s*icon="/gm) ?? [];

    expect(rows.length).toBeGreaterThan(0);
    expect(icons).toHaveLength(0);
  });

  it('keeps the dashboard destinations all iconned, which is the other half of the rule', () => {
    const group = /<ListGroup>[\s\S]*?<\/ListGroup>/.exec(code('app/(tabs)/index.tsx'));
    const rows = group?.[0].match(/<ListRow/g) ?? [];
    const icons = group?.[0].match(/icon="/g) ?? [];

    expect(rows.length).toBeGreaterThan(0);
    expect(icons.length).toBe(rows.length);
  });
});

describe('logging a meal from a photo in a browser', () => {
  /**
   * The headline feature, so it is traced to the library rather than assumed.
   *
   * A browser has no camera API in the sense a phone does. expo-image-picker's
   * web build answers both launch calls with a hidden <input type="file">, the
   * camera one merely adding a capture attribute that a desktop browser
   * ignores, and it grants both permissions without asking. So either button
   * ends in a file picker, provided the screen still offers the library one and
   * nothing between the press and the picker is native only.
   */
  it('still has a reason to trust the picker: its web build is a file input', () => {
    const picker = readDep('expo-image-picker/src/ExponentImagePicker.web.ts');

    expect(picker).toMatch(/setAttribute\('type', 'file'\)/);
    // Both permission requests resolve granted, so pickImage never stops at
    // the Alert that react-native-web would silently swallow.
    expect(picker).toMatch(/requestMediaLibraryPermissionsAsync[\s\S]*?permissionGrantedResponse/);
    expect(picker).toMatch(/requestCameraPermissionsAsync\(\)\s*\{\s*return permissionGrantedResponse/);
  });

  it('keeps a library button on the capture screen, not only a camera one', () => {
    const log = code('app/(tabs)/log.tsx');

    expect(log).toMatch(/label="Choose from library"/);
    expect(log).toMatch(/captureAndEstimate\(false\)/);
    expect(code('lib/pickImage.ts')).toMatch(/launchImageLibraryAsync\(/);
  });

  it('resizes with a module that exists in a browser', () => {
    // pickImage re-encodes every pick through the manipulator before upload.
    expect(code('lib/pickImage.ts')).toMatch(/ImageManipulator\.manipulateAsync\(/);
    expect(() =>
      readDep('expo-image-manipulator/src/NativeImageManipulatorModule.web.ts'),
    ).not.toThrow();
  });

  it('sends the estimate request through the upload seam too', () => {
    // The scan posts the same multipart body the attach does, so it needs the
    // same Blob conversion or the server receives "[object Object]".
    const uses = code('hooks/usePhoto.ts').match(/appendFile\(/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
  });
});

describe('the rest of the native only modules', () => {
  it('hides Google on web exactly as on a phone: by the web client id', () => {
    // The browser twin reports ready only when this build was given a client
    // id, and both sign in screens render the button only when ready, so an
    // unconfigured demo never shows a button that cannot work.
    expect(code('lib/googleAuth.web.ts')).toMatch(/ready: googleConfigured/);
    expect(code('app/(auth)/login.tsx')).toMatch(/google\.ready \?/);
    expect(code('app/(auth)/register.tsx')).toMatch(/google\.ready \?/);
  });

  it('never lets a haptic failure escape, since the web build can throw', () => {
    // expo-haptics throws UnavailabilityError where a method is missing, and
    // its web build vibrates through navigator.vibrate where there is one.
    // Every call goes through fire(), which turns either into nothing.
    const source = code('lib/haptics.ts');
    const calls = source.match(/Haptics\.\w+Async\(/g) ?? [];
    const fired = source.match(/fire\(\(\) => Haptics\.\w+Async\(/g) ?? [];

    expect(calls.length).toBeGreaterThan(0);
    expect(fired.length).toBe(calls.length);
  });

  it('keeps tokens out of expo-secure-store on web, which has no web build', () => {
    expect(code('lib/tokenStore.ts')).toMatch(/Platform\.OS !== 'web'/);
    expect(code('lib/milestoneStore.ts')).toMatch(/Platform\.OS === 'web'/);
  });

  it('swaps the map for its list on web, and the map renders in one place', () => {
    // MapCanvas is the only module that imports react-native-maps, and
    // MapScreen is the only thing that imports MapCanvas, so one web twin
    // covers every route that shows a map.
    const web = code('components/MapCanvas.web.tsx');
    expect(web).toMatch(/MAPS_UNAVAILABLE = true/);
    expect(web).not.toMatch(/from 'react-native-maps'/);
  });
});
