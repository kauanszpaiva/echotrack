import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.',
  );
}

try {
  new URL(supabaseUrl);
} catch {
  throw new Error('VITE_SUPABASE_URL must be a valid URL.');
}

// Custom storage wrapper to respect the "Remember me" user preference.
// If "Remember me" is false, we store the session in sessionStorage (expires on browser close).
// If "Remember me" is true (the default), we store the session in localStorage.
const customStorage = {
  getItem: (key: string) => {
    const rememberMe = localStorage.getItem('supabase_remember_me') !== 'false';
    const storage = rememberMe ? localStorage : sessionStorage;
    return storage.getItem(key);
  },
  setItem: (key: string, value: string) => {
    const rememberMe = localStorage.getItem('supabase_remember_me') !== 'false';
    const storage = rememberMe ? localStorage : sessionStorage;
    storage.setItem(key, value);
  },
  removeItem: (key: string) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
};

// The anon key is intentionally safe to expose to the browser when Row Level
// Security is enabled. Never put a Supabase service-role key in a VITE_ variable.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storage: customStorage,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
