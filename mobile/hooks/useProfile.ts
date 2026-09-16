import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../lib/api';
import type { Goal, User } from '../lib/types';

type ProfilePatch = {
  goal?: Goal;
  timezone?: string;
  daily_calorie_target?: number | null;
};

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: ProfilePatch) => {
      const response = await api.patch<User>('/me', patch);
      return response.data;
    },
    onSuccess: (user) => {
      queryClient.setQueryData(['me'], user);
      // The plan generator reads the goal, so any cached plan advice is stale now.
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
      // The dashboard measures today against the target, so it is stale too.
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
