import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, Card } from '../../components/ui/Common';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { safeFetch } from '../../lib/fetchUtils';

type StudentReport = {
  id: string;
  status: string;
  submittedAt?: string | null;
  createdAt: string;
  cycle?: { name?: string };
};

export function StudentHistory() {
  const [reports, setReports] = useState<StudentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('ALL');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await safeFetch('/api/student/reports');
      setReports((Array.isArray(data) ? data : []).filter((report: StudentReport) => report.status === 'SUBMITTED' || report.status === 'REVIEWED'));
    } catch (err: any) {
      setError(err.message || 'Unable to load report history.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => reports.filter((report) => status === 'ALL' || report.status === status), [reports, status]);

  if (loading) return <LoadingState message="Loading report history..." className="min-h-[400px]" />;
  if (error) return <ErrorState message={error} onRetry={load} className="min-h-[400px]" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black font-display tracking-tight text-[#0A0A0A]">Report History</h1>
          <p className="mt-1 text-sm text-[#6B7280]">Previously submitted weekly reports and review status.</p>
        </div>
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#FF7A00]">
          <option value="ALL">All reports</option>
          <option value="SUBMITTED">Submitted</option>
          <option value="REVIEWED">Reviewed</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No report history yet" message="Submitted weekly reports will appear here." icon={FileText} />
      ) : (
        <div className="space-y-4">
          {visible.map((report) => (
            <Card key={report.id} className="p-5 rounded-3xl">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-bold text-gray-950">{report.cycle?.name || 'Weekly report'}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-gray-500">{new Date(report.submittedAt || report.createdAt).toLocaleDateString()}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${report.status === 'REVIEWED' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{report.status}</span>
                  </div>
                </div>
                <Link to={`/student/reports/${report.id}`}><Button variant="outline" size="sm">View details <ArrowRight className="h-4 w-4" /></Button></Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
