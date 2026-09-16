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
