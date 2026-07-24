import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { UserRole } from '../types';

/**
 * Gates a route by session and (optionally) role.
 * - While the session is resolving, shows a lightweight loader.
 * - No user → redirect to /login.
 * - User whose role is not allowed → redirect to their own dashboard
 *   (/dashboard-redirect), never render the wrong role's shell.
 */
export function ProtectedRoute({
  roles,
  children,
}: {
  roles?: UserRole[];
  children: ReactNode;
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#FAFAFA]">
        <div className="text-sm text-gray-500">Loading…</div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (roles && !roles.includes(user.role as UserRole)) {
    return <Navigate to="/dashboard-redirect" replace />;
  }

  return <>{children}</>;
}
