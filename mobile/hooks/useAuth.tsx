import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

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
  signIn: (creds: Credentials) => Promise<void>;
  signUp: (creds: Credentials) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    hydrateTokens()
      .then((pair) => {
        if (!active) return;
        setToken(pair?.access_token ?? null);
      })
      .catch(() => {
        // A keystore read failure just means we start signed out.
      })
      .finally(() => {
        if (active) setReady(true);
      });
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
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthValue>(
    () => ({ ready, signedIn: token !== null, signIn, signUp, signOut }),
    [ready, token, signIn, signUp, signOut],
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
