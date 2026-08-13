import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthenticateWithRedirectCallback } from '@clerk/clerk-react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { RequireAuth, RequireRole } from './components/RouteGuards';
import { AREA_ROLES, homePathForRole } from './lib/access';

// Views
import { Login } from './views/Auth/Login';
import { SignUp } from './views/Auth/SignUp';
import { SetupAccount } from './views/Auth/SetupAccount';
import { AdminDashboard } from './views/Admin/AdminDashboard';
import { DashboardLayout } from './views/Layouts/DashboardLayout';

import { ProgramManagers } from './views/Admin/ProgramManagers';
import { AllUsers } from './views/Admin/AllUsers';
import { Pathways } from './views/Admin/Pathways';
import { Classes } from './views/Admin/Classes';
import { Communities } from './views/Admin/Communities';
import { ReportCycles } from './views/Admin/ReportCycles';
import { AllReports } from './views/Admin/AllReports';
import { TargetedQuestions } from './views/Admin/TargetedQuestions';
import { Analytics } from './views/Admin/Analytics';
import { AuditLogs } from './views/Admin/AuditLogs';
import { Settings } from './views/Admin/Settings';
import { ContractPoints } from './views/Admin/ContractPoints';
import { DevPanel } from './views/Dev/DevPanel';
import { StudentReportWizard } from './views/Student/StudentReportWizard';
import { StudentDashboard } from './views/Student/StudentDashboard';
import { PMDashboard } from './views/PM/PMDashboard';
import { CoachDashboard } from './views/Coach/CoachDashboard';
import { InstructorDashboard } from './views/Instructor/InstructorDashboard';
import { ReportDetail } from './views/Admin/ReportDetail';
import { ConductTracker } from './views/Conduct/ConductTracker';
import { MemberProfile } from './views/Profile/MemberProfile';
import { PSMDashboard } from './views/PSM/PSMDashboard';
import { StudentTimesheet } from './views/Student/StudentTimesheet';
import { StudentStanding } from './views/Student/StudentStanding';
import { MemberDirectory } from './views/Profile/MemberDirectory';

function DashboardRedirect() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    navigate(homePathForRole(user?.role), { replace: true });
  }, [user, loading, navigate]);

  return <div>Redirecting...</div>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" />
        <Routes>
          {/* Public */}
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/setup-account" element={<SetupAccount />} />
          <Route
            path="/sso-callback"
            element={
              <AuthenticateWithRedirectCallback
                signInFallbackRedirectUrl="/dashboard-redirect"
                signUpFallbackRedirectUrl="/dashboard-redirect"
              />
            }
          />

          {/* Authenticated. Each area additionally declares which roles may
              enter it; the API enforces the same rules server-side. */}
          <Route element={<RequireAuth />}>
            <Route path="/dashboard-redirect" element={<DashboardRedirect />} />

            <Route element={<DashboardLayout />}>
              {/* Member profiles and the directory — every signed-in role. */}
              <Route path="/profile" element={<MemberProfile />} />
              <Route path="/profile/:userId" element={<MemberProfile />} />
              <Route path="/directory" element={<MemberDirectory />} />

              <Route element={<RequireRole roles={AREA_ROLES.dev} />}>
                <Route path="/dev" element={<DevPanel />} />
              </Route>

              {/* Admin-only */}
              <Route element={<RequireRole roles={AREA_ROLES.admin} />}>
                <Route path="/admin" element={<AdminDashboard />} />
                <Route path="/admin/staff" element={<ProgramManagers />} />
                <Route path="/admin/pathways" element={<Pathways />} />
                <Route path="/admin/classes" element={<Classes />} />
                <Route path="/admin/communities" element={<Communities />} />
                <Route path="/admin/cycles" element={<ReportCycles />} />
                <Route path="/admin/audit" element={<AuditLogs />} />
                <Route path="/admin/settings" element={<Settings />} />
                <Route path="/admin/contract-points" element={<ContractPoints />} />
              </Route>

              {/* Admin areas Program Managers also use (scoped server-side to
                  their own students/staff). */}
              <Route element={<RequireRole roles={AREA_ROLES.adminShared} />}>
                <Route path="/admin/users" element={<AllUsers />} />
                <Route path="/admin/reports" element={<AllReports />} />
                <Route path="/admin/targeted-questions" element={<TargetedQuestions />} />
                <Route path="/admin/analytics" element={<Analytics />} />
                <Route path="/admin/reports/:id" element={<ReportDetail />} />
              </Route>

              <Route element={<RequireRole roles={AREA_ROLES.conduct} />}>
                <Route path="/admin/conduct" element={<ConductTracker />} />
              </Route>

              <Route element={<RequireRole roles={AREA_ROLES.pm} />}>
                <Route path="/pm" element={<PMDashboard />} />
                <Route path="/pm/reports/:id" element={<ReportDetail />} />
              </Route>

              <Route element={<RequireRole roles={AREA_ROLES.coach} />}>
                <Route path="/coach" element={<CoachDashboard />} />
                <Route path="/coach/reports/:id" element={<ReportDetail />} />
              </Route>

              <Route element={<RequireRole roles={AREA_ROLES.psm} />}>
                <Route path="/psm" element={<PSMDashboard />} />
              </Route>

              <Route element={<RequireRole roles={AREA_ROLES.instructor} />}>
                <Route path="/instructor" element={<InstructorDashboard />} />
                <Route path="/instructor/conduct" element={<ConductTracker />} />
                <Route path="/instructor/reports/:id" element={<ReportDetail />} />
              </Route>

              <Route element={<RequireRole roles={AREA_ROLES.student} />}>
                <Route path="/student" element={<StudentDashboard />} />
                <Route path="/student/report" element={<StudentReportWizard />} />
                <Route path="/student/timesheet" element={<StudentTimesheet />} />
                <Route path="/student/standing" element={<StudentStanding />} />
                <Route path="/student/reports/:id" element={<ReportDetail />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
