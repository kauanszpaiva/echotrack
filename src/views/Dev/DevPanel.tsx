import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Button } from '../../components/ui/Common';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabaseClient';
import { safeFetch } from '../../lib/fetchUtils';
import { ROLE_LABELS } from '../../../shared/roles';

const AREAS: { label: string; to: string }[] = [
  { label: 'Admin Dashboard', to: '/admin' },
  { label: 'All Users', to: '/admin/users' },
  { label: 'Program Managers', to: '/admin/staff' },
  { label: 'Analytics', to: '/admin/analytics' },
  { label: 'Report Cycles', to: '/admin/cycles' },
  { label: 'All Reports', to: '/admin/reports' },
  { label: 'Conduct Tracker', to: '/admin/conduct' },
  { label: 'Contract Points', to: '/admin/contract-points' },
  { label: 'Audit Logs', to: '/admin/audit' },
  { label: 'Settings', to: '/admin/settings' },
  { label: 'PM Dashboard', to: '/pm' },
  { label: 'Coach Dashboard', to: '/coach' },
  { label: 'Instructor Dashboard', to: '/instructor' },
  { label: 'Student Dashboard', to: '/student' },
];

export function DevPanel() {
  const { user } = useAuth();
  const [tokenPreview, setTokenPreview] = useState<string>('');
  const [health, setHealth] = useState<string>('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const t = data.session?.access_token ?? '';
      setTokenPreview(t ? `${t.slice(0, 12)}…${t.slice(-6)}` : '(no active session token)');
    });
  }, []);

  const runHealthCheck = async () => {
    setChecking(true);
    setHealth('');
    try {
      const res = await safeFetch('/api/health');
      setHealth(`ok · ${res.time ?? JSON.stringify(res)}`);
    } catch (e: any) {
      setHealth(`error · ${e.message}`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-8 pb-20">
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-gray-400 mb-1">Developer</div>
        <h1 className="text-2xl font-black font-display tracking-tight text-[#0A0A0A]">Dev Panel</h1>
        <p className="text-sm text-gray-500 mt-1">
          Full admin access plus developer diagnostics. Visible to the <span className="font-semibold">Dev</span> role only.
        </p>
      </div>

      <Card className="p-6">
        <h2 className="text-sm font-bold text-[#0A0A0A] mb-4">Session</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-gray-400 font-semibold text-xs uppercase tracking-wide">Name</dt>
            <dd className="text-gray-800 mt-0.5">{user?.name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-400 font-semibold text-xs uppercase tracking-wide">Email</dt>
            <dd className="text-gray-800 mt-0.5">{user?.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-400 font-semibold text-xs uppercase tracking-wide">Role</dt>
            <dd className="text-gray-800 mt-0.5">{user?.role ? (ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] ?? user.role) : '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-400 font-semibold text-xs uppercase tracking-wide">Access token</dt>
            <dd className="text-gray-800 mt-0.5 font-mono text-xs break-all">{tokenPreview}</dd>
          </div>
        </dl>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-[#0A0A0A]">API health</h2>
          <Button size="sm" onClick={runHealthCheck} disabled={checking}>
            {checking ? 'Checking…' : 'Run check'}
          </Button>
        </div>
        {health && <p className="text-sm font-mono text-gray-700">{health}</p>}
      </Card>

      <Card className="p-6">
        <h2 className="text-sm font-bold text-[#0A0A0A] mb-4">Jump to area</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {AREAS.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-gray-700 hover:border-orange-400 hover:bg-orange-50/40 transition-colors"
            >
              {a.label}
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
