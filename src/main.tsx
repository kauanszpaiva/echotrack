import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary';
import {supabaseConfigError} from './lib/supabaseClient';
import './index.css';

const root = createRoot(document.getElementById('root')!);

// If the Supabase browser config is missing/invalid, show an actionable screen
// instead of mounting the app (which would otherwise throw and render blank).
root.render(
  <StrictMode>
    {supabaseConfigError ? (
      <ErrorBoundary initialError={supabaseConfigError} />
    ) : (
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    )}
  </StrictMode>,
);
