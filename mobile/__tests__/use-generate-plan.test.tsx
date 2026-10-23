/**
 * useGeneratePlan sends `style` only when the caller gives one, so an old
 * call site that still passes just a goal behaves exactly as it did before
 * Ramadan mode existed.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useGeneratePlan } from '../hooks/usePlans';

jest.mock('../lib/api', () => ({
  api: { post: jest.fn().mockResolvedValue({ data: { id: 'p1' } }) },
}));

import { api } from '../lib/api';

const mockedPost = api.post as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockedPost.mockClear();
});

test('sends only goal when no style is given', async () => {
  const { result } = renderHook(() => useGeneratePlan(), { wrapper });

  await act(async () => {
    await result.current.mutateAsync({ goal: 'cut' });
  });

  expect(mockedPost).toHaveBeenCalledWith('/plans', { goal: 'cut' }, { timeout: 45000 });
});

test('sends style when given, standard', async () => {
  const { result } = renderHook(() => useGeneratePlan(), { wrapper });

  await act(async () => {
    await result.current.mutateAsync({ goal: 'maintain', style: 'standard' });
  });

  expect(mockedPost).toHaveBeenCalledWith(
    '/plans',
    { goal: 'maintain', style: 'standard' },
    { timeout: 45000 },
  );
});

test('sends style ramadan when Ramadan mode is on', async () => {
  const { result } = renderHook(() => useGeneratePlan(), { wrapper });

  await act(async () => {
    await result.current.mutateAsync({ goal: 'bulk', style: 'ramadan' });
  });

  await waitFor(() =>
    expect(mockedPost).toHaveBeenCalledWith(
      '/plans',
      { goal: 'bulk', style: 'ramadan' },
      { timeout: 45000 },
    ),
  );
});
