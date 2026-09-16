/**
 * The burned calories card.
 *
 * Mostly input handling, which is where this kind of card actually goes wrong:
 * a number that will not save, a save button live when there is nothing to
 * save, or a draft silently replaced while the user is typing.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { BurnCard } from '../components/BurnCard';
import { api } from '../lib/api';

jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    api: { get: jest.fn(), put: jest.fn(), delete: jest.fn() },
  };
});

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
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const entry = (calories: number) => ({
  id: '01a0-aaaa',
  day: '2026-09-16',
  calories,
  updated_at: '2026-09-16T10:00:00Z',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.get.mockResolvedValue({ data: null });
  mockedApi.put.mockImplementation(async (_url: string, body: { calories: number }) => ({
    data: entry(body.calories),
  }));
  mockedApi.delete.mockResolvedValue({ data: undefined });
});

describe('with nothing entered yet', () => {
  it('invites a number without insisting on one', async () => {
    const { getByText } = render(<BurnCard />, { wrapper });

    await waitFor(() => expect(getByText(/Optional/)).toBeTruthy());
  });

  it('keeps save disabled until something is typed', async () => {
    const { getByText, getByPlaceholderText } = render(<BurnCard />, { wrapper });
    await waitFor(() => expect(getByPlaceholderText('e.g. 420')).toBeTruthy());

    fireEvent.press(getByText('Save'));

    expect(mockedApi.put).not.toHaveBeenCalled();
  });

  it('saves a typed number', async () => {
    const { getByText, getByPlaceholderText } = render(<BurnCard />, { wrapper });
    await waitFor(() => expect(getByPlaceholderText('e.g. 420')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('e.g. 420'), '420');
    fireEvent.press(getByText('Save'));

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledWith('/burn', { calories: 420 }));
  });

  it('accepts zero, which is a real answer rather than an empty one', async () => {
    const { getByText, getByPlaceholderText } = render(<BurnCard />, { wrapper });
    await waitFor(() => expect(getByPlaceholderText('e.g. 420')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('e.g. 420'), '0');
    fireEvent.press(getByText('Save'));

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledWith('/burn', { calories: 0 }));
  });
});

describe('input handling', () => {
  it('strips anything that is not a digit as it is typed', async () => {
    const { getByPlaceholderText } = render(<BurnCard />, { wrapper });
    const input = await waitFor(() => getByPlaceholderText('e.g. 420'));

    fireEvent.changeText(input, '4a2-0.');

    expect(input.props.value).toBe('420');
  });

  it('refuses a number past the plausible ceiling, before any round trip', async () => {
    const { getByText, getByPlaceholderText } = render(<BurnCard />, { wrapper });
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
    const { getByPlaceholderText } = render(<BurnCard />, { wrapper });

    await waitFor(() => expect(getByPlaceholderText('e.g. 420').props.value).toBe('300'));
  });

  it('offers to update rather than save', async () => {
    const { getByText } = render(<BurnCard />, { wrapper });

    await waitFor(() => expect(getByText('Update')).toBeTruthy());
  });

  it('will not resend an unchanged value', async () => {
    const { getByText } = render(<BurnCard />, { wrapper });
    await waitFor(() => expect(getByText('Update')).toBeTruthy());

    fireEvent.press(getByText('Update'));

    expect(mockedApi.put).not.toHaveBeenCalled();
  });

  it('sends a changed value', async () => {
    const { getByText, getByPlaceholderText } = render(<BurnCard />, { wrapper });
    await waitFor(() => expect(getByText('Update')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('e.g. 420'), '500');
    fireEvent.press(getByText('Update'));

    await waitFor(() => expect(mockedApi.put).toHaveBeenCalledWith('/burn', { calories: 500 }));
  });

  it('does not overwrite what is being typed when the query settles', async () => {
    const { getByPlaceholderText } = render(<BurnCard />, { wrapper });
    const input = await waitFor(() => getByPlaceholderText('e.g. 420'));

    fireEvent.changeText(input, '777');

    // The stored value arriving late must not clobber the draft.
    await waitFor(() => expect(input.props.value).toBe('777'));
  });

  it('can take the entry back entirely', async () => {
    const { getByText } = render(<BurnCard />, { wrapper });
    await waitFor(() => expect(getByText('Clear')).toBeTruthy());

    fireEvent.press(getByText('Clear'));

    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith('/burn/2026-09-16'));
  });
});
