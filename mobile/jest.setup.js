// Timing, before anything else, because the rest of this file is mocks.
//
// The suite is 23 files of React Native renders on a 4 core machine, and jest
// runs several at once. Under that contention a file that finishes in 25s alone
// takes 115s, and React Native Testing Library's waitFor gives up after 1000ms
// by default, so tests fail for having been starved rather than for being
// wrong. That is worse than a slow suite: it teaches you to re-run and shrug,
// and a real failure then hides among the noise.
//
// The numbers are chosen to be far past any legitimate wait. Nothing here is
// waiting on a network; the slowest thing is a render settling.
jest.setTimeout(30_000);

const { configure } = require('@testing-library/react-native');
configure({ asyncUtilTimeout: 10_000 });

// Test setup for the Expo app.

// Reanimated 4 cannot load in a test runner: it reaches for native worklets at
// import time. It ships a mock that replaces the whole module with inert
// components and pass-through hooks, which is the supported way to test a
// screen that uses it.
//
// The tradeoff is explicit and worth stating: with this mock the animations do
// not actually run, so no test here proves that a spring settles or that a
// number reaches its target. What these tests can prove is that components
// render, that the right values reach them, and that side effects such as
// haptics fire on the right interaction. Whether the motion looks right is a
// question only a device answers.
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// No taptic engine in a test runner, and the real module rejects. The wrapper
// in lib/haptics.ts swallows that by design, so without this mock the tests
// would pass while asserting nothing at all.
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

// No notification service in a test runner, and the real module throws on
// import outside a native host. lib/notifications.ts swallows those failures by
// design, so without this mock the reminder tests would pass while asserting
// nothing at all.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('id'),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', DAILY: 'daily' },
}));

// No camera and no photo library in a test runner, and both modules throw on
// import outside a native host. The permission calls default to granted so the
// tests exercise the path a real user takes; a test that needs a refusal
// overrides these for its own duration.
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchCameraAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn().mockResolvedValue({ uri: 'file:///resized.jpg' }),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

// No Google sign in SDK in a test runner: the module reaches for native code at
// import time, exactly like the two above. The default is a signed in user, so
// the tests exercise the path a real person takes; a test that needs a refusal
// or a cancellation overrides these for its own duration.
//
// `statusCodes` has to carry real values rather than be left empty. The native
// half compares an error's code against SIGN_IN_CANCELLED to decide whether
// backing out is drawn as a failure, and against undefined that comparison is
// true for every error, so every failure would silently become "they changed
// their mind" and the screen would say nothing at all.
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signOut: jest.fn().mockResolvedValue(null),
    signIn: jest.fn().mockResolvedValue({
      type: 'success',
      data: { idToken: 'google-id-token', user: { email: 'sara@gmail.com' } },
    }),
  },
  isSuccessResponse: (response) => response?.type === 'success',
  isErrorWithCode: (error) => typeof error?.code === 'string',
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
}));
