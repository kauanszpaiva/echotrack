import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ProtectedRoute } from './components/ProtectedRoute';

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

import { useEffect } from 'react';
import type { ReactNode } from 'react';

function DashboardRedirect() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/login', { replace: true });
      return;
    }
    switch (user.role) {
      case 'ADMIN': navigate('/admin', { replace: true }); break;
      case 'PROGRAM_MANAGER': navigate('/pm', { replace: true }); break;
      case 'INSTRUCTOR': navigate('/instructor', { replace: true }); break;
      case 'COACH': navigate('/coach', { replace: true }); break;
      case 'STUDENT': navigate('/student', { replace: true }); break;
      default: navigate('/login', { replace: true }); break;
    }
  }, [user, loading, navigate]);

  return <div className="flex items-center justify-center min-h-screen bg-[#FAFAFA]"><div className="text-sm text-gray-500">Redirecting…</div></div>;
}

// Sends already-authenticated users away from public auth pages.
function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="flex items-center justify-center min-h-screen bg-[#FAFAFA]"><div className="text-sm text-gray-500">Loading…</div></div>;
  }
  if (user) return <Navigate to="/dashboard-redirect" replace />;
  return <>{children}</>;
}

import { StudentReportWizard } from './views/Student/StudentReportWizard';
import { StudentDashboard } from './views/Student/StudentDashboard';
import { PMDashboard } from './views/PM/PMDashboard';
import { CoachDashboard } from './views/Coach/CoachDashboard';
import { InstructorDashboard } from './views/Instructor/InstructorDashboard';
import { ReportDetail } from './views/Admin/ReportDetail';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" />
        <Routes>
        <Route path="/" element={<Navigate to="/login" />} />
        <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="/signup" element={<PublicOnly><SignUp /></PublicOnly>} />
        <Route path="/setup-account" element={<SetupAccount />} />
        <Route path="/dashboard-redirect" element={<DashboardRedirect />} />

        <Route element={<DashboardLayout />}>
          {/* Admin-only */}
          <Route path="/admin" element={<ProtectedRoute roles={['ADMIN']}><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/staff" element={<ProtectedRoute roles={['ADMIN']}><ProgramManagers /></ProtectedRoute>} />
          <Route path="/admin/pathways" element={<ProtectedRoute roles={['ADMIN']}><Pathways /></ProtectedRoute>} />
          <Route path="/admin/classes" element={<ProtectedRoute roles={['ADMIN']}><Classes /></ProtectedRoute>} />
          <Route path="/admin/communities" element={<ProtectedRoute roles={['ADMIN']}><Communities /></ProtectedRoute>} />
          <Route path="/admin/cycles" element={<ProtectedRoute roles={['ADMIN']}><ReportCycles /></ProtectedRoute>} />
          <Route path="/admin/audit" element={<ProtectedRoute roles={['ADMIN']}><AuditLogs /></ProtectedRoute>} />
          <Route path="/admin/settings" element={<ProtectedRoute roles={['ADMIN']}><Settings /></ProtectedRoute>} />

          {/* Admin + Program Manager (shared admin screens) */}
          <Route path="/admin/users" element={<ProtectedRoute roles={['ADMIN', 'PROGRAM_MANAGER']}><AllUsers /></ProtectedRoute>} />
          <Route path="/admin/reports" element={<ProtectedRoute roles={['ADMIN', 'PROGRAM_MANAGER']}><AllReports /></ProtectedRoute>} />
          <Route path="/admin/targeted-questions" element={<ProtectedRoute roles={['ADMIN', 'PROGRAM_MANAGER']}><TargetedQuestions /></ProtectedRoute>} />
          <Route path="/admin/analytics" element={<ProtectedRoute roles={['ADMIN', 'PROGRAM_MANAGER']}><Analytics /></ProtectedRoute>} />
          <Route path="/admin/reports/:id" element={<ProtectedRoute roles={['ADMIN', 'PROGRAM_MANAGER']}><ReportDetail /></ProtectedRoute>} />

          {/* Program Manager */}
          <Route path="/pm" element={<ProtectedRoute roles={['PROGRAM_MANAGER']}><PMDashboard /></ProtectedRoute>} />
          <Route path="/pm/reports/:id" element={<ProtectedRoute roles={['PROGRAM_MANAGER']}><ReportDetail /></ProtectedRoute>} />

          {/* Coach */}
          <Route path="/coach" element={<ProtectedRoute roles={['COACH']}><CoachDashboard /></ProtectedRoute>} />
          <Route path="/coach/reports/:id" element={<ProtectedRoute roles={['COACH']}><ReportDetail /></ProtectedRoute>} />

          {/* Instructor */}
          <Route path="/instructor" element={<ProtectedRoute roles={['INSTRUCTOR']}><InstructorDashboard /></ProtectedRoute>} />
          <Route path="/instructor/reports/:id" element={<ProtectedRoute roles={['INSTRUCTOR']}><ReportDetail /></ProtectedRoute>} />

          {/* Student */}
          <Route path="/student" element={<ProtectedRoute roles={['STUDENT']}><StudentDashboard /></ProtectedRoute>} />
          <Route path="/student/report" element={<ProtectedRoute roles={['STUDENT']}><StudentReportWizard /></ProtectedRoute>} />
          <Route path="/student/reports/:id" element={<ProtectedRoute roles={['STUDENT']}><ReportDetail /></ProtectedRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  </AuthProvider>
  );
}
