/**
 * Attaching a picture to a meal.
 *
 * The interesting behaviour is not the upload, it is everything around it: a
 * camera roll photo is several megabytes and the server refuses anything over
 * 1000 KB, so the resize is the feature working rather than an optimisation.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import type { ReactNode } from 'react';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { MealPhoto } from '../components/MealPhoto';
import { api } from '../lib/api';
import { ThemeProvider } from '../theme';

jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    api: { put: jest.fn(), delete: jest.fn() },
    getAccessToken: () => 'test-token',
  };
});

const mockedApi = api as unknown as { put: jest.Mock; delete: jest.Mock };
const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;
const manipulator = ImageManipulator as jest.Mocked<typeof ImageManipulator>;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/** What a phone camera actually hands back: far too big for the server. */
const hugeLandscape = {
  canceled: false,
  assets: [{ uri: 'file:///DCIM/huge.jpg', width: 4032, height: 3024 }],
};

const LOG_ID = '01a0-aaaa';

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.put.mockResolvedValue({ data: { id: LOG_ID, has_photo: true } });
  mockedApi.delete.mockResolvedValue({ data: undefined });
  picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true } as never);
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true } as never);
  picker.launchCameraAsync.mockResolvedValue({ canceled: true, assets: [] } as never);
  picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] } as never);
  manipulator.manipulateAsync.mockResolvedValue({ uri: 'file:///resized.jpg' } as never);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

describe('with no photo yet', () => {
  it('invites one without insisting', () => {
    const { getByText } = render(<MealPhoto logId={LOG_ID} hasPhoto={false} />, { wrapper });

    expect(getByText(/Optional/)).toBeTruthy();
    expect(getByText('Take a photo')).toBeTruthy();
  });

  it('shrinks a camera photo before sending it', async () => {
    picker.launchCameraAsync.mockResolvedValue(hugeLandscape as never);
    const { getByText } = render(<MealPhoto logId={LOG_ID} hasPhoto={false} />, { wrapper });

    fireEvent.press(getByText('Take a photo'));

    await waitFor(() => expect(manipulator.manipulateAsync).toHaveBeenCalled());
    const [uri, actions, options] = manipulator.manipulateAsync.mock.calls[0];
    expect(uri).toBe('file:///DCIM/huge.jpg');
    // Landscape, so the width is what gets pinned.
    expect(actions).toEqual([{ resize: { width: 1280 } }]);
    expect(options).toMatchObject({ compress: 0.7 });
  });

  it('pins the height instead when the photo is portrait', async () => {
    picker.launchCameraAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///DCIM/tall.jpg', width: 3024, height: 4032 }],
    } as never);
    const { getByText } = render(<MealPhoto logId={LOG_ID} hasPhoto={false} />, { wrapper });

    fireEvent.press(getByText('Take a photo'));

    await waitFor(() => expect(manipulator.manipulateAsync).toHaveBeenCalled());
    expect(manipulator.manipulateAsync.mock.calls[0][1]).toEqual([{ resize: { height: 1280 } }]);
  });

  it('leaves an already small photo alone rather than scaling it up', async () => {
    picker.launchCameraAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///small.jpg', width: 800, height: 600 }],
    } as never);
    const { getByText } = render(<MealPhoto logId={LOG_ID} hasPhoto={false} />, { wrapper });

    fireEvent.press(getByText('Take a photo'));

    await waitFor(() => expect(manipulator.manipulateAsync).toHaveBeenCalled());
    expect(manipulator.manipulateAsync.mock.calls[0][1]).toEqual([]);
  });

  it('uploads the resized file, not the original', async () => {
    picker.launchCameraAsync.mockResolvedValue(hugeLandscape as never);
    const { getByText } = render(<MealPhoto logId={LOG_ID} hasPhoto={false} />, { wrapper });

    fireEvent.press(getByText('Take a photo'));

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalled());
    const [url, form] = mockedApi.put.mock.calls[0];
    expect(url).toBe(`/logs/${LOG_ID}/photo`);
    expect(form).toBeInstanceOf(FormData);
  });

  it('sends nothing when the picker is dismissed', async () => {
    const { getByText } = render(<MealPhoto logId={LOG_ID} hasPhoto={false} />, { wrapper });

    fireEvent.press(getByText('Take a photo'));

    await waitFor(() => expect(picker.launchCameraAsync).toHaveBeenCalled());
    expect(manipulator.manipulateAsync).not.toHaveBeenCalled();
    expect(mockedApi.put).not.toHaveBeenCalled();
  });

  it('explains itself when camera permission is refused', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false } as never);
    const { getByText } = render(<MealPhoto logId={LOG_ID} hasPhoto={false} />, { wrapper });

    fireEvent.press(getByText('Take a photo'));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('asks for library permission, not camera, when choosing', async () => {
    const { getByText } = render(<MealPhoto logId={LOG_ID} hasPhoto={false} />, { wrapper });

    fireEvent.press(getByText('Choose'));

    await waitFor(() => expect(picker.requestMediaLibraryPermissionsAsync).toHaveBeenCalled());
    expect(picker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('with a photo already attached', () => {
  it('offers to retake and to remove', () => {
    const { getByText, queryByText } = render(<MealPhoto logId={LOG_ID} hasPhoto />, { wrapper });

    expect(getByText('Retake')).toBeTruthy();
    expect(getByText('Remove')).toBeTruthy();
    expect(queryByText('Take a photo')).toBeNull();
  });

  it('confirms before removing, because there is no undo', () => {
    const { getByText } = render(<MealPhoto logId={LOG_ID} hasPhoto />, { wrapper });

    fireEvent.press(getByText('Remove'));

    expect(Alert.alert).toHaveBeenCalled();
    // Not deleted on the strength of one tap.
    expect(mockedApi.delete).not.toHaveBeenCalled();
  });

  it('deletes once the confirmation is accepted', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      const destructive = buttons?.find((b) => b.style === 'destructive');
      destructive?.onPress?.();
    });
    const { getByText } = render(<MealPhoto logId={LOG_ID} hasPhoto />, { wrapper });

    fireEvent.press(getByText('Remove'));

    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith(`/logs/${LOG_ID}/photo`));
  });
});
