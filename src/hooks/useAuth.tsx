import { createContext, useContext } from 'react';
import { useUser, useClerk, useSignIn } from '@clerk/clerk-react';
import { ALL_ROLES } from '../../shared/roles';

type ClerkUserResource = NonNullable<ReturnType<typeof useUser>['user']>;

export type OAuthProvider = 'google' | 'microsoft' | 'apple';

/**
 * Social sign-in buttons to show, e.g. VITE_OAUTH_PROVIDERS="google,microsoft".
 * Defaults to Google only: a button for a connection that isn't enabled in the
 * Clerk dashboard just fails on click, so providers are opt-in per environment.
 */
export const ENABLED_OAUTH_PROVIDERS: OAuthProvider[] = (
  import.meta.env.VITE_OAUTH_PROVIDERS ?? 'google'
)
  .split(',')
  .map((value: string) => value.trim().toLowerCase())
  .filter((value: string): value is OAuthProvider =>
    value === 'google' || value === 'microsoft' || value === 'apple',
  );

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithProvider: (provider: OAuthProvider) => Promise<void>;
  /** Emails a verification code so the user can set (or reset) a password. */
  requestPasswordReset: (email: string) => Promise<void>;
  /** Completes the reset with the emailed code and signs the user in. */
  resetPassword: (code: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

function toAppUser(user: ClerkUserResource): User {
  const role = (user.publicMetadata as { role?: unknown } | null)?.role;
  const email = user.primaryEmailAddress?.emailAddress ?? '';
  return {
    id: user.id,
    email,
    name: user.fullName || user.firstName || email.split('@')[0] || 'User',
    // Role is authoritative in publicMetadata (admin-only, not user-editable)
    // and is used here for navigation only — the API resolves it independently
    // from the verified Clerk user on every request. Unknown values fall back
    // to the least-privileged role, matching the server.
    role: typeof role === 'string' && (ALL_ROLES as string[]).includes(role) ? role : 'STUDENT',
  };
}

function toLoginError(error: any): Error {
  const clerkError = error?.errors?.[0];
  const code = clerkError?.code ?? '';
  const message = (clerkError?.longMessage || clerkError?.message || error?.message || '').toLowerCase();

  if (code === 'form_identifier_not_found' || message.includes('couldn')) {
    return new Error('Invalid email or password. Please check your details and try again.');
  }
  if (code === 'form_password_incorrect' || message.includes('password is incorrect')) {
    return new Error('Invalid email or password. Please check your details and try again.');
  }
  // The account exists but has no password credential — typically because it was
  // created through a social login. Point at the "set a password" flow instead
  // of repeating "wrong password", which would be misleading.
  if (
    code === 'strategy_for_user_invalid' ||
    message.includes('does not support') ||
    message.includes('no password')
  ) {
    return new Error(
      'This account signs in with Google and has no password yet. Use "Forgot / set password" below to create one.',
    );
  }
  if (message.includes('verif')) {
    return new Error('Please verify your email address before signing in.');
  }
  return new Error(clerkError?.longMessage || clerkError?.message || error?.message || 'Unable to sign in. Please try again.');
}

export function AuthProvider({ children }: { children: any }) {
  const { isLoaded, isSignedIn, user: clerkUser } = useUser();
  const { signOut } = useClerk();
  const { isLoaded: signInLoaded, signIn, setActive } = useSignIn();

  const user = isSignedIn && clerkUser ? toAppUser(clerkUser) : null;
  const loading = !isLoaded;

  const login = async (email: string, password: string) => {
    if (!signInLoaded || !signIn) throw new Error('Authentication is still loading. Please try again.');
    try {
      const result = await signIn.create({ identifier: email.trim(), password });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        return;
      }
      if (result.status === 'needs_second_factor') {
        throw new Error('Two-factor authentication is required for this account.');
      }
      throw new Error('Additional verification is required to sign in.');
    } catch (e: any) {
      console.error('Login error:', e);
      throw toLoginError(e);
    }
  };

  /**
   * Sends a verification code to the email address. Clerk allows an account to
   * gain a password this way, so an account created through Google can start
   * signing in with email + password.
   */
  const requestPasswordReset = async (email: string) => {
    if (!signInLoaded || !signIn) throw new Error('Authentication is still loading. Please try again.');
    try {
      await signIn.create({ strategy: 'reset_password_email_code', identifier: email.trim() });
    } catch (e: any) {
      console.error('Password reset request error:', e);
      const code = e?.errors?.[0]?.code ?? '';
      if (code === 'form_identifier_not_found') {
        // Don't confirm whether the address exists.
        return;
      }
      throw toLoginError(e);
    }
  };

  const resetPassword = async (code: string, newPassword: string) => {
    if (!signInLoaded || !signIn) throw new Error('Authentication is still loading. Please try again.');
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code: code.trim(),
        password: newPassword,
      });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        return;
      }
      if (result.status === 'needs_second_factor') {
        throw new Error('Two-factor authentication is required to finish signing in.');
      }
      throw new Error('Could not finish the password reset. Please start again.');
    } catch (e: any) {
      console.error('Password reset error:', e);
      const clerkCode = e?.errors?.[0]?.code ?? '';
      if (clerkCode === 'form_code_incorrect' || clerkCode === 'verification_failed') {
        throw new Error('That code is not valid. Check the email and try again.');
      }
      if (clerkCode === 'form_password_pwned' || clerkCode === 'form_password_length_too_short') {
        throw new Error(
          e?.errors?.[0]?.longMessage || 'Choose a stronger password (at least 8 characters).',
        );
      }
      throw toLoginError(e);
    }
  };

  const loginWithProvider = async (provider: OAuthProvider) => {
    if (!signInLoaded || !signIn) throw new Error('Authentication is still loading. Please try again.');
    const strategy =
      provider === 'microsoft' ? 'oauth_microsoft' : provider === 'apple' ? 'oauth_apple' : 'oauth_google';
    try {
      await signIn.authenticateWithRedirect({
        strategy,
        redirectUrl: '/sso-callback',
        redirectUrlComplete: '/dashboard-redirect',
      });
    } catch (error: any) {
      console.error('OAuth login error:', error);
      // The connection isn't enabled for this Clerk instance — say so plainly
      // instead of surfacing a raw provider error.
      const code = error?.errors?.[0]?.code ?? '';
      if (code.includes('strategy') || code.includes('not_allowed') || code.includes('oauth')) {
        throw new Error(`${provider} sign-in isn't enabled for this workspace yet.`);
      }
      throw toLoginError(error);
    }
  };

  const logout = async () => {
    await signOut();
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, login, loginWithProvider, requestPasswordReset, resetPassword, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
