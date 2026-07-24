import { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { safeFetch } from '../lib/fetchUtils';

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
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

function toLoginError(error: any) {
  if (error?.code === 'ACCOUNT_INACTIVE') {
    return new Error('Account is not active. If you were invited, open your setup link first; otherwise contact an administrator.');
  }

  if (error?.code === 'AUTH_INVALID_CREDENTIALS') {
    return new Error('Invalid email or password. Make sure this account exists in the EchoTrack users table, not only in Supabase Auth.');
  }

  return error;
}

export function AuthProvider({ children }: { children: any }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    safeFetch('/api/auth/session')
      .then(data => setUser(data.user || null))
      .catch(() => {
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const data = await safeFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      setUser(data.user);
    } catch (e: any) {
      console.error('Login error:', e);
      throw toLoginError(e);
    }
  };

  const loginWithProvider = async (provider: 'google' | 'microsoft' | 'apple') => {
    try {
      const { signInWith } = await import('../firebase');
      const result = await signInWith(provider);
      
      const data = await safeFetch('/api/auth/oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: result.idToken }),
      });
      
      setUser(data.user);
    } catch (error: any) {
      if (error.code === 'auth/unauthorized-domain' || error.message?.includes('unauthorized-domain') || error.message?.includes('auth/unauthorized-domain')) {
        const domain = window.location.hostname;
        console.error(`[Firebase] Domain "${domain}" is not authorized.`);
        throw new Error(`Domain not authorized. Please open Firebase Console and add "${domain}" to Authentication -> Settings -> Authorized Domains.`);
      }
      throw error;
    }
  };

  const logout = async () => {
    try {
      await safeFetch('/api/auth/logout', { method: 'POST' });
    } catch(e) {
      console.error('Logout error:', e);
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithProvider, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
