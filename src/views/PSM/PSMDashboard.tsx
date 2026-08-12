import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Clock, Users, FileText, Check, X } from 'lucide-react';
import { Button, Card } from '../../components/ui/Common';
import { LoadingState, ErrorState, EmptyState } from '../../components/ui/States';
import { safeFetch } from '../../lib/fetchUtils';
import { PHASE_SHORT_LABELS } from '../../../shared/phases';

interface Timesheet {
  id: string;
  status: string;
  totalHours: number;
  notes: string | null;
  submittedAt: string | null;
  reviewNote: string | null;
  entries: { id: string; workDate: string; hours: number; description: string | null }[];
  cycle: { id: string; name: string } | null;
  student: { id: string; name: string; email: string };
}

const STATUS_STYLE: Record<string, string> = {
  SUBMITTED: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-600 border-red-200',
  DRAFT: 'bg-gray-50 text-gray-500 border-gray-200',
};

const StatusPill = ({ status }: { status: string }) => (
  <span className={`text-[9px] uppercase font-bold tracking-widest px-2 py-1 rounded border ${STATUS_STYLE[status] ?? STATUS_STYLE.DRAFT}`}>
    {status.toLowerCase()}
  </span>
);

/**
 * The Placement Success Manager view. Deliberately separate from /coach: this
 * is scoped by StudentProfile.psmId, the coach view by coachId, so someone who
 * holds both jobs works each caseload in its own place.
 */
export function PSMDashboard() {
  const [stats, setStats] = useState<{ studentCount: number; pendingTimesheets: number; submittedReports: number } | null>(null);
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [dashboard, queue, caseload] = await Promise.all([
        safeFetch('/api/psm/dashboard'),
        safeFetch('/api/psm/timesheets'),
        safeFetch('/api/psm/students'),
      ]);
      setStats(dashboard);
      setTimesheets(queue.timesheets ?? []);
      setStudents(caseload.students ?? []);
    } catch (e: any) {
      setError(e.message || 'Failed to load your dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const review = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    const note = decision === 'REJECTED'
      ? window.prompt('What needs to change before resubmitting?') ?? ''
      : '';
    if (decision === 'REJECTED' && !note.trim()) return;

    setBusyId(id);
    try {
      await safeFetch(`/api/psm/timesheets/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note }),
      });
      toast.success(decision === 'APPROVED' ? 'Timesheet approved' : 'Sent back to the student');
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to review this timesheet');
    } finally {
      setBusyId('');
    }
  };

  if (loading) return <LoadingState message="Loading your caseload" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const pending = timesheets.filter((t) => t.status === 'SUBMITTED');
  const settled = timesheets.filter((t) => t.status !== 'SUBMITTED');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-black font-display tracking-tight text-[#0A0A0A]">Placement Dashboard</h1>
        <p className="text-[#6B7280] text-xs uppercase tracking-widest mt-1">
          Phase 2 · Corporate Internship
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={Users} label="Students placed" value={stats?.studentCount ?? 0} />
        <Stat icon={Clock} label="Timesheets to review" value={stats?.pendingTimesheets ?? 0} highlight />
        <Stat icon={FileText} label="Reports submitted" value={stats?.submittedReports ?? 0} />
      </div>

      <section>
        <h2 className="text-lg font-bold text-[#0A0A0A] mb-4">Timesheets awaiting review</h2>
        {pending.length === 0 ? (
          <EmptyState icon={Clock} title="Nothing to review" message="Submitted timesheets from your students will appear here." />
        ) : (
          <div className="space-y-4">
            {pending.map((timesheet) => (
              <TimesheetCard
                key={timesheet.id}
                timesheet={timesheet}
                busy={busyId === timesheet.id}
                onReview={review}
              />
            ))}
          </div>
        )}
      </section>

      {settled.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-[#0A0A0A] mb-4">Recently reviewed</h2>
          <div className="space-y-3">
            {settled.slice(0, 10).map((timesheet) => (
              <Card key={timesheet.id} className="p-5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-bold text-[#0A0A0A] truncate">{timesheet.student.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {timesheet.cycle?.name} · {timesheet.totalHours} hrs
                  </p>
                </div>
                <StatusPill status={timesheet.status} />
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-bold text-[#0A0A0A] mb-4">Your students</h2>
        {students.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No students assigned"
            message="Students appear here once an admin sets you as their Placement Success Manager."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {students.map((student) => (
              <Card key={student.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/profile/${student.id}`} className="font-bold text-[#0A0A0A] hover:text-[#FF7A00] transition-colors">
                      {student.name}
                    </Link>
                    <p className="text-xs text-gray-500 mt-1 truncate">{student.email}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {[student.community?.name, student.pathway?.name].filter(Boolean).join(' · ')}
                    </p>
                    {student.coach && (
                      <p className="text-xs text-gray-400 mt-1">Coach: {student.coach.name}</p>
                    )}
                  </div>
                  <span className="text-[9px] uppercase font-bold tracking-widest px-2 py-1 rounded border bg-sky-50 text-sky-600 border-sky-200 shrink-0">
                    {PHASE_SHORT_LABELS[student.phase as keyof typeof PHASE_SHORT_LABELS] ?? student.phase}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const Stat = ({ icon: Icon, label, value, highlight }: any) => (
  <Card className={`p-6 ${highlight && value > 0 ? 'border-[#FFB273]' : ''}`}>
    <div className="flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${highlight && value > 0 ? 'bg-[#FFF4EB] text-[#FF7A00]' : 'bg-gray-50 text-gray-400'}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-2xl font-black text-[#0A0A0A] tabular-nums leading-none">{value}</p>
        <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mt-1.5">{label}</p>
      </div>
    </div>
  </Card>
);

function TimesheetCard({
  timesheet,
  busy,
  onReview,
}: {
  timesheet: Timesheet;
  busy: boolean;
  onReview: (id: string, decision: 'APPROVED' | 'REJECTED') => void;
  key?: string;
}) {
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link to={`/profile/${timesheet.student.id}`} className="font-bold text-[#0A0A0A] hover:text-[#FF7A00] transition-colors">
              {timesheet.student.name}
            </Link>
            <StatusPill status={timesheet.status} />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {timesheet.cycle?.name}
            {timesheet.submittedAt && ` · submitted ${new Date(timesheet.submittedAt).toLocaleDateString()}`}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-black text-[#0A0A0A] tabular-nums leading-none">{timesheet.totalHours}</p>
          <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mt-1">hours</p>
        </div>
      </div>

      {timesheet.entries.length > 0 && (
        <div className="mt-5 border-t border-gray-100 pt-4 space-y-2">
          {timesheet.entries.map((entry) => (
            <div key={entry.id} className="flex items-baseline justify-between gap-4 text-sm">
              <span className="text-gray-500 tabular-nums shrink-0 w-24">
                {new Date(entry.workDate).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' })}
              </span>
              <span className="text-gray-700 flex-1 min-w-0 truncate">{entry.description || '—'}</span>
              <span className="font-semibold text-[#0A0A0A] tabular-nums shrink-0">{entry.hours}h</span>
            </div>
          ))}
        </div>
      )}

      {timesheet.notes && (
        <p className="text-sm text-gray-600 mt-4 whitespace-pre-wrap border-t border-gray-100 pt-4">{timesheet.notes}</p>
      )}

      <div className="flex justify-end gap-3 mt-5">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => onReview(timesheet.id, 'REJECTED')}>
          <X className="w-4 h-4" /> Send back
        </Button>
        <Button size="sm" disabled={busy} onClick={() => onReview(timesheet.id, 'APPROVED')}>
          <Check className="w-4 h-4" /> Approve
        </Button>
      </div>
    </Card>
  );
}
