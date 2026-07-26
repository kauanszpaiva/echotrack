import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Represents a missing/invalid Supabase browser configuration.
 * IMPORTANT: we do NOT throw at module-load time. A throw here would happen
 * before React mounts (this module is imported by useAuth → App → main), which
 * no ErrorBoundary can catch, producing a blank white page. Instead we expose
 * `supabaseConfigError` so `main.tsx` can render an actionable screen.
 */
export class SupabaseConfigError extends Error {
  isConfigError = true;
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseConfigError';
  }
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function detectConfigError(): SupabaseConfigError | null {
  if (!supabaseUrl || !supabaseAnonKey) {
    return new SupabaseConfigError(
      'Missing Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY ' +
        '(in .env.local locally, or in the Vercel project environment variables) and redeploy.',
    );
  }
  try {
    new URL(supabaseUrl);
  } catch {
    return new SupabaseConfigError('VITE_SUPABASE_URL must be a valid URL.');
  }
  return null;
}

/** Non-null when the Supabase browser config is missing or invalid. */
export const supabaseConfigError = detectConfigError();

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
//
// When the config is invalid we still export a `supabase` binding (so importers
// don't crash at load), but any use of it throws the config error. In practice
// main.tsx short-circuits to the config screen before the app can use it.
export const supabase: SupabaseClient = supabaseConfigError
  ? (new Proxy({} as SupabaseClient, {
      get() {
        throw supabaseConfigError;
      },
    }))
  : createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        storage: customStorage,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
