import { Component, type ReactNode } from 'react';

interface Props {
  children?: ReactNode;
  /** Pre-set error to display immediately (e.g. a config error detected before render). */
  initialError?: Error | null;
}

interface State {
  error: Error | null;
}

/**
 * Root error boundary. Renders a readable message instead of a blank white page
 * for two cases: (1) errors thrown while React renders its children, and
 * (2) an `initialError` passed in (e.g. a missing Supabase config detected at
 * startup, which throws too early for a boundary to catch on its own).
 */
export class ErrorBoundary extends Component<Props, State> {
  // Explicit declarations: this project does not install @types/react, so the
  // base Component's props/state typing isn't visible to tsc. Runtime is
  // unaffected (React populates these); this only satisfies the type checker.
  declare props: Props;
  state: State;

  constructor(props: Props) {
    super(props);
    this.state = { error: props.initialError ?? null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('[ErrorBoundary] Uncaught error:', error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isConfigError = (error as { isConfigError?: boolean }).isConfigError === true;

    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA] p-6">
        <div className="max-w-lg w-full rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-widest text-brand-orange mb-2">
            EchoTrack
          </div>
          <h1 className="text-2xl font-black font-display tracking-tight text-[#0A0A0A] mb-3">
            {isConfigError ? 'Configuration required' : 'Something went wrong'}
          </h1>

          {isConfigError ? (
            <div className="text-sm text-gray-600 space-y-3">
              <p>{error.message}</p>
              <p className="text-gray-500">
                In Vercel, set{' '}
                <code className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                  VITE_SUPABASE_URL
                </code>{' '}
                and{' '}
                <code className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                  VITE_SUPABASE_ANON_KEY
                </code>{' '}
                (Production &amp; Preview), then redeploy — these values are baked
                into the build, so a fresh deploy is required.
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-600">
              An unexpected error occurred while loading the app. Try reloading;
              if it persists, contact support.
            </p>
          )}

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="rounded-xl bg-[#0A0A0A] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-black"
            >
              Reload
            </button>
          </div>

          {!isConfigError && (
            <pre className="mt-6 max-h-40 overflow-auto rounded-xl bg-gray-50 p-3 text-xs text-gray-500 whitespace-pre-wrap break-words">
              {error.message}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
