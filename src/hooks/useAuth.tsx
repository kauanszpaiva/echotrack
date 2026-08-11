import { createContext, useContext } from 'react';
import { useUser, useClerk, useSignIn } from '@clerk/clerk-react';

type ClerkUserResource = NonNullable<ReturnType<typeof useUser>['user']>;

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
  loginWithProvider: (provider: 'google' | 'microsoft' | 'apple') => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

function toAppUser(user: ClerkUserResource): User {
  const role = (user.publicMetadata as { role?: string })?.role;
  const email = user.primaryEmailAddress?.emailAddress ?? '';
  return {
    id: user.id,
    email,
    name: user.fullName || user.firstName || email.split('@')[0] || 'User',
    // Role is authoritative in publicMetadata (admin-only, not user-editable).
    role: role ?? 'STUDENT',
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
      throw new Error('Additional verification is required to sign in.');
    } catch (e: any) {
      console.error('Login error:', e);
      throw toLoginError(e);
    }
  };

  const loginWithProvider = async (provider: 'google' | 'microsoft' | 'apple') => {
    if (!signInLoaded || !signIn) throw new Error('Authentication is still loading. Please try again.');
    const strategy =
      provider === 'microsoft' ? 'oauth_microsoft' : provider === 'apple' ? 'oauth_apple' : 'oauth_google';
    try {
      await signIn.authenticateWithRedirect({
        strategy,
        redirectUrl: '/sso-callback',
        redirectUrlComplete: '/dashboard-redirect',
      });
    } catch (error) {
      console.error('OAuth login error:', error);
      throw error;
    }
  };

  const logout = async () => {
    await signOut();
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithProvider, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
