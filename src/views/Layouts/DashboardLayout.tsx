import { useEffect, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
  LayoutDashboard, Building2, UserCog, Layers, BookOpen, ArrowLeft,
  Users, Calendar, FileText, Target, BarChart3, ClipboardList, Settings, LogOut,
  ShieldAlert, Award, Zap, Menu, X
} from 'lucide-react';
import { Logo } from '../../components/Logo';
import { ROLE_BADGE } from '../../types';

export function DashboardLayout() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Below `lg` the sidebar is an off-canvas drawer; from `lg` up it is a
  // permanent column and this state is irrelevant.
  const [navOpen, setNavOpen] = useState(false);

  // Navigating on a phone should reveal the destination, not leave the drawer
  // covering it.
  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNavOpen(false);
    };
    // The drawer scrolls its own overflow; letting the page behind it scroll
    // too is the classic mobile-drawer bug.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [navOpen]);

  // Authentication is enforced by <RequireAuth> above this layout; the checks
  // below only cover the brief moment while Clerk is still loading.
  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-[#FAFAFA]">
      <div className="text-sm text-gray-500">Loading…</div>
    </div>
  );
  if (!user) return null;

  const getSidebarItems = () => {
    const adminItems = [
      { label: 'Dashboard',        href: '/admin',                    icon: LayoutDashboard },
      { label: 'Program Managers', href: '/admin/staff',              icon: Building2 },
      { label: 'All Users',        href: '/admin/users',              icon: UserCog },
      { label: 'Pathways',         href: '/admin/pathways',           icon: Layers },
      { label: 'Classes',          href: '/admin/classes',            icon: BookOpen },
      { label: 'Communities',      href: '/admin/communities',        icon: Users },
      { label: 'Report Cycles',    href: '/admin/cycles',             icon: Calendar },
      { label: 'All Reports',      href: '/admin/reports',            icon: FileText },
      { label: 'Conduct Points',   href: '/admin/conduct',            icon: ShieldAlert },
      { label: 'Questions',        href: '/admin/targeted-questions', icon: Target },
      { label: 'Analytics',        href: '/admin/analytics',          icon: BarChart3 },
      { label: 'Contract Points',  href: '/admin/contract-points',    icon: Award },
      { label: 'Audit Logs',       href: '/admin/audit',              icon: ClipboardList },
      { label: 'Settings',         href: '/admin/settings',           icon: Settings },
    ];
    const pmItems = [
      { label: 'Dashboard',        href: '/pm',                       icon: LayoutDashboard },
      { label: 'Users',            href: '/admin/users',              icon: UserCog },
      { label: 'All Reports',      href: '/admin/reports',            icon: FileText },
      { label: 'Questions',        href: '/admin/targeted-questions', icon: Target },
      { label: 'Analytics',        href: '/admin/analytics',          icon: BarChart3 }
    ];
    const instructorItems = [
      { label: 'Dashboard',      href: '/instructor',          icon: LayoutDashboard },
      { label: 'Conduct Points', href: '/instructor/conduct',  icon: ShieldAlert }
    ];
    const coachItems = [
      { label: 'Dashboard',    href: '/coach',          icon: LayoutDashboard }
    ];
    const studentItems = [
      { label: 'Dashboard',      href: '/student',         icon: LayoutDashboard },
      { label: 'Weekly Report',  href: '/student/report',  icon: FileText }
    ];

    switch (user.role) {
      case 'DEV':
        // DEV = full admin access + a dedicated developer area.
        return [{ label: 'Dev Panel', href: '/dev', icon: Zap }, ...adminItems];
      case 'ADMIN':
        return adminItems;
      case 'PROGRAM_MANAGER':
        return pmItems;
      case 'INSTRUCTOR':
        return instructorItems;
      case 'COACH':
      case 'PSM':
        return coachItems;
      case 'STUDENT':
      case 'INTERN':
        return studentItems;
      default: return [];
    }
  };

  const navItems = getSidebarItems();
  const showBack = location.pathname.split('/').filter(Boolean).length > 1;
  const badge = user?.role ? ROLE_BADGE[user.role] : undefined;

  return (
    <div className="bg-[#FAFAFA] min-h-screen">
      {/* Backdrop for the mobile drawer. Hidden from `lg` up, where the sidebar
          is permanent and never overlays anything. */}
      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-hidden="true"
        />
      )}

      {/* Sidebar: off-canvas drawer below `lg`, fixed column from `lg` up. */}
      <aside
        id="dashboard-nav"
        className={`fixed inset-y-0 left-0 z-50 flex w-[80vw] max-w-[280px] flex-col border-r border-[#E5E7EB] bg-white transition-transform duration-200 ease-out lg:w-[260px] lg:translate-x-0 ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-16 flex items-center justify-between gap-2 pl-4 pr-2 sm:pl-6 border-b border-[#E5E7EB] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#050505] flex items-center justify-center shrink-0">
              <Logo className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-bold font-display text-sm truncate">EchoTrack</span>
              <span className="text-[9px] uppercase tracking-widest text-[#6B7280] truncate">KSP DOMINION GROUP</span>
            </div>
          </div>
          <button
            onClick={() => setNavOpen(false)}
            className="lg:hidden p-2 -mr-1 rounded-lg text-[#6B7280] hover:bg-[#F5F5F5] hover:text-[#0A0A0A] transition-colors"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.href}
                to={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all relative ${
                  isActive
                    ? 'bg-[#FFF4EB] text-[#FF7A00] font-medium'
                    : 'text-[#6B7280] hover:bg-[#F5F5F5] hover:text-[#0A0A0A]'
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
                {isActive && (
                  <div className="absolute right-3 w-1.5 h-1.5 rounded-full bg-[#FF7A00]" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#E5E7EB] shrink-0">
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-[#6B7280] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content. The sidebar is `fixed`, so the column is offset by margin
          — but only from `lg` up, where the sidebar actually occupies space. */}
      <main className="flex flex-col min-h-screen lg:ml-[260px]">
        <header className="h-16 flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 border-b border-[#E5E7EB] bg-white sticky top-0 z-30">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setNavOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-[#6B7280] hover:bg-[#F5F5F5] hover:text-[#0A0A0A] transition-colors shrink-0"
              aria-label="Open navigation"
              aria-expanded={navOpen}
              aria-controls="dashboard-nav"
            >
              <Menu className="w-5 h-5" />
            </button>
            {/* Show back button if we are not on the root dashboard of the current role */}
            {showBack && (
              <button
                onClick={() => navigate(-1)}
                className="flex items-center gap-1.5 text-sm font-medium text-[#6B7280] hover:text-[#0A0A0A] transition-colors shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Back</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* The name is the first thing to give up width on a narrow screen;
                the avatar and role badge stay legible. */}
            <div className="hidden sm:flex flex-col text-right min-w-0">
              <span className="text-sm font-medium leading-none truncate">{user?.name}</span>
              {badge ? (
                <span className={`text-[9px] uppercase font-bold tracking-widest mt-1 px-1.5 py-0.5 rounded border inline-block w-fit ml-auto ${badge.bg} ${badge.text} ${badge.border}`}>
                  {badge.label}
                </span>
              ) : (
                <span className="text-[10px] uppercase tracking-widest text-[#6B7280] mt-1">{user?.role}</span>
              )}
            </div>
            <div className="w-8 h-8 rounded-full bg-[#FFF4EB] text-[#FF7A00] flex items-center justify-center font-bold text-xs uppercase shrink-0">
              {user?.name?.[0] || 'U'}
            </div>
          </div>
        </header>

        {/* `min-w-0` stops a wide child (a table, a chart) from stretching the
            column and giving the whole page a horizontal scrollbar. */}
        <div className="p-4 sm:p-6 lg:p-8 flex-1 min-w-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
