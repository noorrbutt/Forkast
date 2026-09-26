import { useQuery } from '@tanstack/react-query';

import { API_ORIGIN, api } from '../lib/api';
import type { EstimateSource } from '../lib/types';

type HealthResponse = {
  ai_provider: 'fake' | 'groq';
};

export function useEstimatorSource() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const response = await api.get<HealthResponse>(`${API_ORIGIN}/health`);
      return response.data;
    },
    select: ({ ai_provider }): EstimateSource => (ai_provider === 'groq' ? 'ai' : 'local'),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}