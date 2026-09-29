import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../lib/api';
import type { BiggestStruggle, EatingOutFrequency, Goal, User } from '../lib/types';

type ProfilePatch = {
  goal?: Goal;
  timezone?: string;
  daily_calorie_target?: number | null;
  eating_out_frequency?: EatingOutFrequency | null;
  biggest_struggle?: BiggestStruggle | null;
  first_name?: string;
  last_name?: string;
  email?: string;
};

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: ProfilePatch) => {
      const response = await api.patch<User>('/me', patch);
      return response.data;
    },
    onSuccess: (user, patch) => {
      queryClient.setQueryData(['me'], user);
      // The plan generator reads the goal, so any cached plan advice is stale now.
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
      // The dashboard measures today against the target, so it is stale too.
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });

      /**
       * Timezone decides which calendar day every meal lands in, so changing it
       * re-buckets the whole history. The server computes streaks and the month
       * trend in the account's zone, which means both were still showing
       * figures from the old clock: the user accepted the device zone, watched
       * the dashboard update, and the Streaks tab kept the wrong streak for the
       * rest of the session because nothing told it to refetch.
       */
      if (patch.timezone !== undefined) {
        void queryClient.invalidateQueries({ queryKey: ['streaks'] });
        void queryClient.invalidateQueries({ queryKey: ['trend'] });
      }
    },
  });
}
