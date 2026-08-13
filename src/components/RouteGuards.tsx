import { Navigate, Outlet, useLocation, Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { canAccess, homePathForRole } from '../lib/access';

function FullScreenLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#FAFAFA]">
      <div className="text-sm text-gray-500">Loading…</div>
    </div>
  );
}

/**
 * Gate for every authenticated route: no Clerk session → /login.
 * Waits for Clerk to finish loading first, so a page refresh restores the
 * session instead of bouncing a signed-in user to the login screen.
 */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/**
 * Role gate. Renders the area only for the listed roles (DEV/PSM/INTERN inherit
 * from ADMIN/COACH/STUDENT via expandRoles).
 *
 * UX only — the API enforces the same rules independently. A user who edits
 * their way past this screen still gets 403 from every endpoint behind it.
 */
export function RequireRole({ roles }: { roles: readonly string[] }) {
  const { user, loading } = useAuth();

  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!canAccess(user.role, roles)) return <Forbidden />;
  return <Outlet />;
}

export function Forbidden() {
  const { user } = useAuth();
  const home = homePathForRole(user?.role);

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#FAFAFA] px-6">
      <div className="max-w-md w-full bg-white border border-[#E5E7EB] rounded-2xl p-5 sm:p-8 text-center">
        <div className="w-12 h-12 rounded-xl bg-[#FEF2F2] text-[#DC2626] flex items-center justify-center mx-auto mb-4">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-[#0A0A0A] mb-2">You don't have access to this area</h1>
        <p className="text-sm text-gray-500 mb-6">
          Your account role ({user?.role || 'unknown'}) isn't permitted here. If you think that's wrong,
          ask an administrator to review your role.
        </p>
        <Link
          to={home}
          className="inline-flex items-center justify-center h-11 px-5 rounded-xl bg-[#050505] text-white text-sm font-semibold hover:bg-[#1a1a1a] transition-colors"
        >
          Back to my dashboard
        </Link>
      </div>
    </div>
  );
}
