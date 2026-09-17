import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import axios from 'axios';

import {
  api,
  clearTokens,
  getRefreshToken,
  hydrateTokens,
  setAuthFailureHandler,
  setTokens,
} from '../lib/api';
import type { TokenPair, User } from '../lib/types';

type Credentials = { email: string; password: string };

type AuthValue = {
  /** False until the stored token pair has been read back from the keystore. */
  ready: boolean;
  signedIn: boolean;
  /**
   * True between creating an account and finishing the one time setup.
   *
   * Timezone decides which calendar day every meal and every streak lands in,
   * and it defaults to Asia/Karachi on the server. Left to a banner on the
   * Profile tab, someone who never opens that tab logs a run of days into the
   * wrong ones before finding out, and those days cannot be re-bucketed after
   * the fact. So it is asked once, at the start, when it is still free.
   */
  needsSetup: boolean;
  completeSetup: () => void;
  signIn: (creds: Credentials) => Promise<void>;
  signUp: (creds: Credentials) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Deliberately not persisted. It marks this session as brand new, and a
  // reinstall that restores a token belongs straight in the app, not back
  // through a setup screen for an account that has already been configured.
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    let active = true;

    void (async () => {
      let pair: TokenPair | null = null;
      try {
        pair = await hydrateTokens();
      } catch {
        // A keystore read failure just means we start signed out.
      }
      if (!active) return;

      // Open the app on what the keystore said, and let the check below run
      // behind it. Waiting on the network here would put the request timeout
      // in front of every cold start, which is a long blank spinner on a
      // phone that happens to be offline.
      setToken(pair?.access_token ?? null);
      setReady(true);
      if (!pair) return;

      // A stored token is not the same as a live session. The account can be
      // gone, or the whole token family revoked, and until something asks the
      // server the app carries on believing it is signed in: it routes to the
      // tabs, so no sign in screen is reachable, and every request underneath
      // fails. Asking once on boot is what turns that into a trip to login.
      try {
        await api.get('/me');
      } catch (error) {
        // Only a refusal ends the session. A timeout means we could not ask,
        // which is not the same answer as being told no, and signing someone
        // out because their train went into a tunnel would be worse than
        // letting them keep a session that may well still be good.
        const refused = axios.isAxiosError(error) && error.response?.status === 401;
        if (!refused) return;
        await clearTokens();
        if (active) setToken(null);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  // When a refresh fails the client clears the keystore, then calls this so the
  // router gate can move the user back to login.
  useEffect(() => {
    setAuthFailureHandler(() => {
      setToken(null);
      queryClient.clear();
    });
    return () => setAuthFailureHandler(null);
  }, [queryClient]);

  const adopt = useCallback(
    async (pair: TokenPair) => {
      await setTokens(pair);
      queryClient.clear();
      setToken(pair.access_token);
    },
    [queryClient],
  );

  const signIn = useCallback(
    async (creds: Credentials) => {
      const response = await api.post<TokenPair>('/auth/login', creds);
      await adopt(response.data);
    },
    [adopt],
  );

  const signUp = useCallback(
    async (creds: Credentials) => {
      const response = await api.post<TokenPair>('/auth/register', creds);
      await adopt(response.data);
      setNeedsSetup(true);
    },
    [adopt],
  );

  const signOut = useCallback(async () => {
    const refresh = getRefreshToken();
    if (refresh) {
      try {
        await api.post('/auth/logout', { refresh_token: refresh });
      } catch {
        // Signing out locally matters more than the server acknowledging it.
      }
    }
    await clearTokens();
    setToken(null);
    setNeedsSetup(false);
    queryClient.clear();
  }, [queryClient]);

  const completeSetup = useCallback(() => setNeedsSetup(false), []);

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      signedIn: token !== null,
      needsSetup,
      completeSetup,
      signIn,
      signUp,
      signOut,
    }),
    [ready, token, needsSetup, completeSetup, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside an AuthProvider');
  return value;
}

export function useLogin() {
  const { signIn } = useAuth();
  return useMutation({ mutationFn: signIn });
}

export function useRegister() {
  const { signUp } = useAuth();
  return useMutation({ mutationFn: signUp });
}

export function useMe() {
  const { signedIn } = useAuth();
  return useQuery({
    queryKey: ['me'],
    enabled: signedIn,
    queryFn: async () => {
      const response = await api.get<User>('/me');
      return response.data;
    },
  });
}

/** What the password endpoint takes, named as the server names it. */
export type PasswordChange = {
  current_password: string;
  new_password: string;
};

/**
 * Swap one password for another.
 *
 * No sign out and no token juggling afterwards. The tokens on this device were
 * issued to a session that is still the same session, so ending it would punish
 * someone for doing the responsible thing, and the caller is standing on the
 * Profile tab rather than at a login screen.
 *
 * A 403 means the current password was wrong, which is the only failure worth
 * telling apart, and the dialog that calls this is what says so.
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: async (change: PasswordChange) => {
      await api.put('/me/password', change);
    },
  });
}

/**
 * Close the account for good.
 *
 * The local sign out runs whatever the server said, because once the account is
 * gone the tokens on this device are worthless, and leaving them in the
 * keystore would park the user in the tabs with every request failing. That is
 * the exact trap this app already fell into once.
 */
export function useDeleteAccount() {
  const { signOut } = useAuth();
  return useMutation({
    mutationFn: async (password: string) => {
      await api.delete('/me', { data: { password } });
    },
    onSuccess: () => {
      void signOut();
    },
  });
}
