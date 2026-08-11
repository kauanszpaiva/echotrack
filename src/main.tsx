import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {ClerkProvider} from '@clerk/clerk-react';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary';
import './index.css';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// A config error (missing Clerk key) — flagged so the ErrorBoundary renders its
// actionable "Configuration required" screen instead of the generic crash UI.
function makeConfigError(): Error {
  const err = new Error(
    'Missing Clerk configuration. Set VITE_CLERK_PUBLISHABLE_KEY ' +
      '(in .env.local locally, or in the Vercel project environment variables) and redeploy.',
  );
  (err as Error & { isConfigError?: boolean }).isConfigError = true;
  return err;
}

const root = createRoot(document.getElementById('root')!);

// If the Clerk browser config is missing, show an actionable screen instead of
// mounting the app (ClerkProvider would otherwise throw and render blank).
root.render(
  <StrictMode>
    {!PUBLISHABLE_KEY ? (
      <ErrorBoundary initialError={makeConfigError()} />
    ) : (
      <ErrorBoundary>
        <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/login">
          <App />
        </ClerkProvider>
      </ErrorBoundary>
    )}
  </StrictMode>,
);
