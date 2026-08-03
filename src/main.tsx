import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary';
import {supabaseConfigError} from './lib/supabaseClient';
import './index.css';

const root = createRoot(document.getElementById('root')!);

// A missing/invalid Supabase browser config only disables social sign-in — email
// and password authentication runs against the EchoTrack API — so the app still
// mounts. The login screen explains why the social buttons are unavailable.
if (supabaseConfigError) {
  console.warn(`[Supabase] Social sign-in disabled: ${supabaseConfigError.message}`);
}

root.render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
