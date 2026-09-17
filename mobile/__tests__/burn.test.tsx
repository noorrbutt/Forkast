/**
 * Entering what you burned today.
 *
 * It used to be a card sitting permanently on the dashboard, holding a field
 * and two buttons. A dashboard answers how today is going, and a form on it is
 * not an answer: it takes the same visual weight as the numbers around it and
 * is empty almost every time you look at the screen. It is asked for now, by
 * tapping the burned figure, so these exercise it as a dialog.
 *
 * Still mostly input handling, which is where this goes wrong in practice: a
 * number that will not save, a save button live when there is nothing to save,
 * or a draft silently replaced while the user is typing.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { BurnDialog } from '../components/BurnDialog';
import { AuthProvider } from '../hooks/useAuth';
import { api, hydrateTokens } from '../lib/api';

jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    api: { get: jest.fn(), put: jest.fn(), delete: jest.fn() },
    hydrateTokens: jest.fn(),
    clearTokens: jest.fn().mockResolvedValue(undefined),
    setTokens: jest.fn().mockResolvedValue(undefined),
    getRefreshToken: jest.fn(() => null),
    setAuthFailureHandler: jest.fn(),
  };
});

const mockedHydrate = hydrateTokens as jest.Mock;

const mockedApi = api as unknown as {
  get: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      // gcTime 0 so no collection timer outlives the test. The default five
      // minutes leaves a handle open and Jest warns that it could not exit,
      // which in CI is a hang rather than a warning.
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  // AuthProvider, because useBurnToday is gated on being signed in like every
  // other query hook. Without a session the query never runs, which is exactly
  // the behaviour the gate exists for.
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

const entry = (calories: number) => ({
  id: '01a0-aaaa',
  day: '2026-09-16',
  calories,
  updated_at: '2026-09-16T10:00:00Z',
});

const onDismiss = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedHydrate.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
  mockedApi.get.mockResolvedValue({ data: null });
  mockedApi.put.mockImplementation(async (_url: string, body: { calories: number }) => ({
    data: entry(body.calories),
  }));
  mockedApi.delete.mockResolvedValue({ data: undefined });
});

describe('with nothing entered yet', () => {
  it('invites a number without insisting on one', async () => {
    const { getByText } = render(<BurnDialog visible onDismiss={onDismiss} />, { wrapper });

    await waitFor(() => expect(getByText(/Optional/)).toBeTruthy());
  });

  // The button stays pressable with the field empty. Disabling it until the
  // form is valid hides the affordance behind the action it invites, which the
  // style guide names outright, so an empty press is answered in words.
  it('stays pressable on an empty field, and says what is missing', async () => {
    const { getByText, getByPlaceholderText, queryByText } = render(
      <BurnDialog visible onDismiss={onDismiss} />,
      { wrapper },
    );
    await waitFor(() => expect(getByPlaceholderText('e.g. 420')).toBeTruthy());

    // Nothing to answer before it has been asked for.
    expect(queryByText(/Enter a whole number/)).toBeNull();

    fireEvent.press(getByText('Save'));

    expect(mockedApi.put).not.toHaveBeenCalled();
    expect(getByText(/Enter a whole number/)).toBeTruthy();
  });

  it('saves a typed number', async () => {
    const { getByText, getByPlaceholderText } = render(<BurnDialog visible onDismiss={onDismiss} />, { wrapper });
    await waitFor(() => expect(getByPlaceholderText('e.g. 420')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('e.g. 420'), '420');
    fireEvent.press(getByText('Save'));

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledWith('/burn', { calories: 420 }));
  });

  it('accepts zero, which is a real answer rather than an empty one', async () => {
    const { getByText, getByPlaceholderText } = render(<BurnDialog visible onDismiss={onDismiss} />, { wrapper });
    await waitFor(() => expect(getByPlaceholderText('e.g. 420')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('e.g. 420'), '0');
    fireEvent.press(getByText('Save'));

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledWith('/burn', { calories: 0 }));
  });
});

describe('input handling', () => {
  it('strips anything that is not a digit as it is typed', async () => {
    const { getByPlaceholderText } = render(<BurnDialog visible onDismiss={onDismiss} />, { wrapper });
    const input = await waitFor(() => getByPlaceholderText('e.g. 420'));

    fireEvent.changeText(input, '4a2-0.');

    expect(input.props.value).toBe('420');
  });

  it('refuses a number past the plausible ceiling, before any round trip', async () => {
    const { getByText, getByPlaceholderText } = render(<BurnDialog visible onDismiss={onDismiss} />, { wrapper });
    const input = await waitFor(() => getByPlaceholderText('e.g. 420'));

    fireEvent.changeText(input, '99999');
    fireEvent.press(getByText('Save'));

    expect(mockedApi.put).not.toHaveBeenCalled();
    expect(getByText(/between 0 and 10,000/)).toBeTruthy();
  });
});

describe('with a value already stored', () => {
  beforeEach(() => {
    mockedApi.get.mockResolvedValue({ data: entry(300) });
  });

  it('prefills with what was saved', async () => {
    const { getByPlaceholderText } = render(<BurnDialog visible onDismiss={onDismiss} />, { wrapper });

    await waitFor(() => expect(getByPlaceholderText('e.g. 420').props.value).toBe('300'));
  });

  it('offers to update rather than save', async () => {
    const { getByText } = render(<BurnDialog visible onDismiss={onDismiss} />, { wrapper });

    await waitFor(() => expect(getByText('Update')).toBeTruthy());
  });

  it('will not resend an unchanged value', async () => {
    const { getByText } = render(<BurnDialog visible onDismiss={onDismiss} />, { wrapper });
    await waitFor(() => expect(getByText('Update')).toBeTruthy());

    fireEvent.press(getByText('Update'));

    expect(mockedApi.put).not.toHaveBeenCalled();
  });

  it('sends a changed value', async () => {
    const { getByText, getByPlaceholderText } = render(<BurnDialog visible onDismiss={onDismiss} />, { wrapper });
    await waitFor(() => expect(getByText('Update')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('e.g. 420'), '500');
    fireEvent.press(getByText('Update'));

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledWith('/burn', { calories: 500 }));
  });

  it('does not overwrite what is being typed when the query settles', async () => {
    const { getByPlaceholderText } = render(<BurnDialog visible onDismiss={onDismiss} />, { wrapper });
    const input = await waitFor(() => getByPlaceholderText('e.g. 420'));

    fireEvent.changeText(input, '777');

    // The stored value arriving late must not clobber the draft.
    await waitFor(() => expect(input.props.value).toBe('777'));
  });

  it('can take the entry back entirely', async () => {
    const { getByText } = render(<BurnDialog visible onDismiss={onDismiss} />, { wrapper });
    await waitFor(() => expect(getByText('Remove it')).toBeTruthy());

    fireEvent.press(getByText('Remove it'));

    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith('/burn/2026-09-16'));
  });
});
