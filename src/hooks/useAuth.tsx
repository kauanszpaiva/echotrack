import { createContext, useContext, useState, useEffect } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';

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

function toAppUser(user: SupabaseUser): User {
  const metadata = user.user_metadata ?? {};
  const appMetadata = (user.app_metadata ?? {}) as { role?: string };
  return {
    id: user.id,
    email: user.email ?? '',
    name: metadata.full_name ?? metadata.name ?? user.email?.split('@')[0] ?? 'User',
    // Role is authoritative in app_metadata (admin-only, not user-editable).
    // Fall back to user_metadata only for legacy accounts, then STUDENT.
    role: appMetadata.role ?? metadata.role ?? 'STUDENT',
  };
}

function toLoginError(error: { message?: string }) {
  const message = error.message?.toLowerCase() ?? '';
  if (message.includes('email not confirmed')) {
    return new Error('Please verify your email address before signing in.');
  }
  if (message.includes('invalid login credentials')) {
    return new Error('Invalid email or password. Please check your details and try again.');
  }
  return new Error(error.message || 'Unable to sign in. Please try again.');
}

export function AuthProvider({ children }: { children: any }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) console.error('Session check failed:', error.message);
      setUser(data.session?.user ? toAppUser(data.session.user) : null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setUser(session?.user ? toAppUser(session.user) : null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      if (!data.user) throw new Error('Supabase did not return a user session.');
      setUser(toAppUser(data.user));
    } catch (e: any) {
      console.error('Login error:', e);
      throw toLoginError(e);
    }
  };

  const loginWithProvider = async (provider: 'google' | 'microsoft' | 'apple') => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider === 'microsoft' ? 'azure' : provider,
        options: { redirectTo: `${window.location.origin}/dashboard-redirect` },
      });
      if (error) throw error;
    } catch (error) {
      console.error('OAuth login error:', error);
      throw error;
    }
  };

  const logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('Logout error:', error.message);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithProvider, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
