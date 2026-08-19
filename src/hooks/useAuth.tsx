import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useUser, useClerk, useSignIn } from '@clerk/clerk-react';
import { ALL_ROLES } from '../../shared/roles';
import { safeFetch } from '../lib/fetchUtils';

export type OAuthProvider = 'google' | 'microsoft' | 'apple';

export const ENABLED_OAUTH_PROVIDERS: OAuthProvider[] = (
  import.meta.env.VITE_OAUTH_PROVIDERS ?? 'google'
)
  .split(',')
  .map((value: string) => value.trim().toLowerCase())
  .filter((value: string): value is OAuthProvider => value === 'google' || value === 'microsoft' || value === 'apple');

interface User { id: string; email: string; name: string; role: string; }
interface AuthContextType {
  user: User | null;
  loading: boolean;
  authError: string | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithProvider: (provider: OAuthProvider) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  resetPassword: (code: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<User | null>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

function normalizeServerUser(value: any): User {
  const role = typeof value?.role === 'string' && (ALL_ROLES as string[]).includes(value.role) ? value.role : 'STUDENT';
  return { id: String(value?.id || ''), email: String(value?.email || ''), name: String(value?.name || value?.email || 'User'), role };
}

function toLoginError(error: any): Error {
  const clerkError = error?.errors?.[0];
  const code = clerkError?.code ?? error?.code ?? '';
  const message = (clerkError?.longMessage || clerkError?.message || error?.message || '').toLowerCase();
  if (code === 'form_identifier_not_found' || code === 'form_password_incorrect' || message.includes('password is incorrect')) return new Error('Invalid email or password. Please check your details and try again.');
  if (code === 'ACCOUNT_INACTIVE') return new Error('This EchoTrack account is inactive. Contact an administrator.');
  if (code === 'IDENTITY_CONFLICT') return new Error('This sign-in does not match the EchoTrack account record. Contact an administrator.');
  if (code === 'AUTH_PROVIDER_UNAVAILABLE' || code === 'AUTH_NOT_CONFIGURED') return new Error('EchoTrack authentication is temporarily unavailable.');
  if (code === 'strategy_for_user_invalid' || message.includes('does not support') || message.includes('no password')) return new Error('This account signs in with a provider and has no password yet. Use "Forgot / set password" below to create one.');
  if (message.includes('verif')) return new Error('Please verify your email address before signing in.');
  return new Error(clerkError?.longMessage || clerkError?.message || error?.message || 'Unable to sign in. Please try again.');
}

export function AuthProvider({ children }: { children: any }) {
  const { isLoaded, isSignedIn } = useUser();
  const { signOut } = useClerk();
  const { isLoaded: signInLoaded, signIn, setActive } = useSignIn();
  const [user, setUser] = useState<User | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const refreshUser = useCallback(async (): Promise<User | null> => {
    try {
      const data = await safeFetch('/api/auth/session');
      const nextUser = normalizeServerUser(data?.user);
      if (!nextUser.id || !nextUser.email) throw new Error('EchoTrack account record is incomplete.');
      setUser(nextUser);
      setAuthError(null);
      return nextUser;
    } catch (error: any) {
      setUser(null);
      const mapped = toLoginError(error);
      setAuthError(mapped.message);
      throw mapped;
    }
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setUser(null);
      setAuthError(null);
      setSessionReady(true);
      return;
    }
    let cancelled = false;
    setSessionReady(false);
    refreshUser().catch(() => undefined).finally(() => { if (!cancelled) setSessionReady(true); });
    return () => { cancelled = true; };
  }, [isLoaded, isSignedIn, refreshUser]);

  const loading = !isLoaded || !sessionReady;

  const login = async (email: string, password: string) => {
    if (!signInLoaded || !signIn) throw new Error('Authentication is still loading. Please try again.');
    setAuthError(null);
    try {
      const result = await signIn.create({ identifier: email.trim(), password });
      if (result.status === 'complete') {
        setSessionReady(false);
        await setActive({ session: result.createdSessionId });
        await refreshUser();
        setSessionReady(true);
        return;
      }
      if (result.status === 'needs_second_factor') throw new Error('Two-factor authentication is required for this account.');
      throw new Error('Additional verification is required to sign in.');
    } catch (error: any) {
      setSessionReady(true);
      const mapped = toLoginError(error);
      setAuthError(mapped.message);
      throw mapped;
    }
  };

  const requestPasswordReset = async (email: string) => {
    if (!signInLoaded || !signIn) throw new Error('Authentication is still loading. Please try again.');
    try { await signIn.create({ strategy: 'reset_password_email_code', identifier: email.trim() }); }
    catch (error: any) { if (error?.errors?.[0]?.code === 'form_identifier_not_found') return; throw toLoginError(error); }
  };

  const resetPassword = async (code: string, newPassword: string) => {
    if (!signInLoaded || !signIn) throw new Error('Authentication is still loading. Please try again.');
    try {
      const result = await signIn.attemptFirstFactor({ strategy: 'reset_password_email_code', code: code.trim(), password: newPassword });
      if (result.status === 'complete') {
        setSessionReady(false);
        await setActive({ session: result.createdSessionId });
        await refreshUser();
        setSessionReady(true);
        return;
      }
      if (result.status === 'needs_second_factor') throw new Error('Two-factor authentication is required to finish signing in.');
      throw new Error('Could not finish the password reset. Please start again.');
    } catch (error: any) {
      setSessionReady(true);
      const clerkCode = error?.errors?.[0]?.code ?? '';
      if (clerkCode === 'form_code_incorrect' || clerkCode === 'verification_failed') throw new Error('That code is not valid. Check the email and try again.');
      if (clerkCode === 'form_password_pwned' || clerkCode === 'form_password_length_too_short') throw new Error(error?.errors?.[0]?.longMessage || 'Choose a stronger password (at least 8 characters).');
      throw toLoginError(error);
    }
  };

  const loginWithProvider = async (provider: OAuthProvider) => {
    if (!signInLoaded || !signIn) throw new Error('Authentication is still loading. Please try again.');
    const strategy = provider === 'microsoft' ? 'oauth_microsoft' : provider === 'apple' ? 'oauth_apple' : 'oauth_google';
    try { await signIn.authenticateWithRedirect({ strategy, redirectUrl: '/sso-callback', redirectUrlComplete: '/dashboard-redirect' }); }
    catch (error: any) {
      const code = error?.errors?.[0]?.code ?? '';
      if (code.includes('strategy') || code.includes('not_allowed') || code.includes('oauth')) throw new Error(`${provider} sign-in isn't enabled for this workspace yet.`);
      throw toLoginError(error);
    }
  };

  const logout = async () => {
    setUser(null);
    setAuthError(null);
    setSessionReady(true);
    await signOut();
  };

  return <AuthContext.Provider value={{ user, loading, authError, login, loginWithProvider, requestPasswordReset, resetPassword, logout, refreshUser }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
