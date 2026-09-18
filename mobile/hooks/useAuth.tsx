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

/** What the sign up form collects. The server refuses a blank name, so the
 *  screen trims before it sends rather than letting a space through. */
type Registration = Credentials & { first_name: string; last_name: string };

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
  signUp: (registration: Registration) => Promise<void>;
  /**
   * Trade a Google ID token for a Forkast session.
   *
   * One call for both signing in and signing up, because the phone genuinely
   * cannot tell which it is doing: it holds a token from Google and has no way
   * to know whether an account already exists behind that address. The server
   * decides, and says which it did in the status code: 201 for an account it
   * created, 200 for one it found.
   */
  signInWithGoogle: (idToken: string) => Promise<void>;
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
      // Cleared here too, not just in signOut. A session that dies while the
      // user is still on the setup screen used to leave this flag true with
      // nobody signed in, and the router gate reads it the moment anyone signs
      // back in. See signIn for what that looked like.
      setNeedsSetup(false);
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
      /**
       * Only a brand new account needs setup, and this is the other door.
       *
       * The flag survived a session dying on the setup screen, so signing in to
       * an existing, fully configured account dropped the user on the one time
       * setup questions. Pressing "Skip for now" there sent the goal anyway,
       * which quietly overwrote that account's real goal with Maintain. Setting
       * it false on every sign in means it can only ever be true for the
       * account that just registered in this session.
       */
      setNeedsSetup(false);
    },
    [adopt],
  );

  const signUp = useCallback(
    async (registration: Registration) => {
      const response = await api.post<TokenPair>('/auth/register', registration);
      await adopt(response.data);
      setNeedsSetup(true);
    },
    [adopt],
  );

  const signInWithGoogle = useCallback(
    async (idToken: string) => {
      const response = await api.post<TokenPair>('/auth/google', { id_token: idToken });
      await adopt(response.data);
      /**
       * Setup is asked for only when this Google sign in created the account.
       *
       * Getting this wrong in either direction is a real bug, which is why the
       * server answers it rather than the client guessing. Assume new every
       * time and a returning user is dropped back on the one time questions,
       * where "Skip for now" overwrites their real goal with Maintain -- the
       * exact bug signIn already carries a note about. Assume returning every
       * time and a brand new Google account never gets asked its timezone, so
       * its first week of meals lands in the wrong days and cannot be moved.
       */
      setNeedsSetup(response.status === 201);
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
      signInWithGoogle,
      signOut,
    }),
    [ready, token, needsSetup, completeSetup, signIn, signUp, signInWithGoogle, signOut],
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

/**
 * The second half of "Continue with Google": the part after Google has
 * answered.
 *
 * Split from the part that talks to Google, which lives in lib/googleAuth and
 * is a different file per platform, because everything from the ID token
 * onwards is identical everywhere and there is no reason for two copies of it.
 */
export function useGoogleAuth() {
  const { signInWithGoogle } = useAuth();
  return useMutation({ mutationFn: signInWithGoogle });
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
/**
 * How the account holder proves it is them before the account is destroyed.
 *
 * Two shapes because there are two kinds of account. One with a password sends
 * the password. One created through Google has none, and never had one, so it
 * sends a fresh Google ID token instead, which means going back through
 * Google's own prompt on the spot. The server takes exactly one of the two and
 * refuses a body carrying both.
 *
 * Deleting on the session alone was the third option and is not offered: the
 * threat this guards against is a phone left unlocked on a table, and a session
 * is precisely what whoever picked it up already has.
 */
export type DeleteProof = { password: string } | { id_token: string };

export function useDeleteAccount() {
  const { signOut } = useAuth();
  return useMutation({
    mutationFn: async (proof: DeleteProof) => {
      await api.delete('/me', { data: proof });
    },
    onSuccess: () => {
      void signOut();
    },
  });
}
