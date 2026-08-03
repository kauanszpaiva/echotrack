import { createContext, useContext, useState, useEffect } from 'react';
import { toast } from 'sonner';

import { safeFetch } from '../lib/fetchUtils';
import { supabase, supabaseConfigError } from '../lib/supabaseClient';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  /** True when Supabase is configured, so the social buttons can work. */
  socialLoginAvailable: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  loginWithProvider: (provider: 'google' | 'microsoft' | 'apple') => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

/**
 * EchoTrack accounts live in the `User` table and every protected API route is
 * authorized from the server session cookie (see server/auth.ts). Supabase Auth
 * is used only as a social identity broker: its access token is exchanged for an
 * EchoTrack session, never used as the session itself.
 */
const socialLoginAvailable = !supabaseConfigError;

function toLoginError(error: any) {
  if (error?.code === 'ACCOUNT_INACTIVE') {
    return new Error('Account is not active. If you were invited, open your setup link first; otherwise contact an administrator.');
  }

  if (error?.code === 'AUTH_INVALID_CREDENTIALS') {
    return new Error('Invalid email or password. Please check your details and try again.');
  }

  if (error?.status === 404) {
    return new Error('No EchoTrack account found for this email. Ask an administrator for an invite, or create your account.');
  }

  return error instanceof Error ? error : new Error('Unable to sign in. Please try again.');
}

/** Trades a Supabase access token for the EchoTrack session cookie. */
async function exchangeSupabaseSession(accessToken: string): Promise<User> {
  const data = await safeFetch('/api/auth/supabase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken }),
  });
  return data.user;
}

export function AuthProvider({ children }: { children: any }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const restoreSession = async () => {
      // 1. An existing EchoTrack session cookie is all we need.
      try {
        const data = await safeFetch('/api/auth/session');
        if (!mounted) return;
        if (data.user) {
          setUser(data.user);
          return;
        }
      } catch {
        // No session (401) — fall through to the social sign-in hand-off below.
      }

      if (!socialLoginAvailable) return;

      // 2. Coming back from a social redirect: Supabase has a session but the
      //    server does not yet. Exchange it so the API accepts our requests.
      try {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) return;

        const appUser = await exchangeSupabaseSession(accessToken);
        if (mounted) setUser(appUser);
      } catch (error: any) {
        // The provider account has no matching EchoTrack account (or it is not
        // active). Drop the dangling Supabase session so we do not retry forever.
        await supabase.auth.signOut().catch(() => {});
        if (!mounted) return;

        if (error?.status === 404 && error?.email) {
          window.location.replace(
            `/signup?email=${encodeURIComponent(error.email)}&name=${encodeURIComponent(error.name || '')}`
          );
          return;
        }

        console.error('Social sign-in exchange failed:', error);
        toast.error(toLoginError(error).message);
      }
    };

    restoreSession().finally(() => {
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const login = async (email: string, password: string, rememberMe = true) => {
    try {
      const data = await safeFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, rememberMe }),
      });
      setUser(data.user);
    } catch (e: any) {
      console.error('Login error:', e);
      throw toLoginError(e);
    }
  };

  const loginWithProvider = async (provider: 'google' | 'microsoft' | 'apple') => {
    if (!socialLoginAvailable) {
      throw new Error('Social sign-in is not configured. Use your email and password, or set the Supabase environment variables.');
    }

    // Redirects away from the app; the session hand-off happens on the way back
    // in restoreSession() above.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: provider === 'microsoft' ? 'azure' : provider,
      options: { redirectTo: `${window.location.origin}/dashboard-redirect` },
    });

    if (error) {
      console.error('OAuth login error:', error);
      throw new Error(error.message || `${provider} sign-in failed.`);
    }
  };

  const logout = async () => {
    try {
      await safeFetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.error('Logout error:', e);
    }

    if (socialLoginAvailable) {
      await supabase.auth.signOut().catch(() => {});
    }

    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, socialLoginAvailable, login, loginWithProvider, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
