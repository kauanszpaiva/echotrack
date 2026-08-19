import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, FileText, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Card } from '../../components/ui/Common';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { downloadFile, safeFetch } from '../../lib/fetchUtils';

type CoachReport = {
  id: string;
  status: string;
  weeklyTopic?: string | null;
  needsSupport?: boolean;
  submittedAt?: string | null;
  createdAt: string;
  student?: { name?: string; email?: string };
  cycle?: { name?: string };
};

export function CoachReports() {
  const [reports, setReports] = useState<CoachReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await safeFetch('/api/coach/reports');
      setReports(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Unable to load reports.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return reports.filter((report) => {
      const matchesText = !needle || report.student?.name?.toLowerCase().includes(needle) || report.weeklyTopic?.toLowerCase().includes(needle);
      const matchesStatus = status === 'ALL' || report.status === status || (status === 'SUPPORT' && report.needsSupport);
      return matchesText && matchesStatus;
    });
  }, [reports, query, status]);

  const markReviewed = async (id: string) => {
    setReviewingId(id);
    try {
      await safeFetch(`/api/reports/${id}/review`, { method: 'PATCH' });
      setReports((current) => current.map((report) => report.id === id ? { ...report, status: 'REVIEWED' } : report));
      toast.success('Report marked as reviewed');
    } catch (err: any) {
      toast.error(err.message || 'Unable to review report.');
    } finally {
      setReviewingId(null);
    }
  };

  const exportPdf = async (id: string) => {
    try {
      await downloadFile(`/api/reports/export-pdf?id=${id}`, `EchoTrack_Report_${id}.pdf`);
    } catch (err: any) {
      toast.error(err.message || 'Unable to download PDF.');
    }
  };

  if (loading) return <LoadingState message="Loading reports..." className="min-h-[400px]" />;
  if (error) return <ErrorState message={error} onRetry={load} className="min-h-[400px]" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black font-display tracking-tight text-[#0A0A0A]">Reports</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Review weekly reports from students assigned to you.</p>
      </div>

      <Card className="p-4 sm:p-5 rounded-3xl">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search student or topic" className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-[#FF7A00]" />
          </label>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#FF7A00]">
            <option value="ALL">All reports</option>
            <option value="SUBMITTED">Pending review</option>
            <option value="REVIEWED">Reviewed</option>
            <option value="SUPPORT">Needs support</option>
          </select>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState title="No reports found" message="No reports match the current filters." icon={FileText} />
      ) : (
        <div className="space-y-4">
          {filtered.map((report) => (
            <Card key={report.id} className={`p-5 rounded-3xl ${report.needsSupport ? 'border-red-200' : ''}`}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-bold text-gray-950">{report.student?.name || 'Student'}</h2>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${report.status === 'REVIEWED' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{report.status}</span>
                    {report.needsSupport && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">Needs support</span>}
                  </div>
                  <p className="mt-1 truncate text-sm text-gray-600">{report.weeklyTopic || 'No weekly topic'}</p>
                  <p className="mt-1 text-xs text-gray-400">{report.cycle?.name || 'Report cycle'} · {new Date(report.submittedAt || report.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => exportPdf(report.id)}>PDF</Button>
                  {report.status === 'SUBMITTED' && <Button variant="outline" size="sm" disabled={reviewingId === report.id} onClick={() => markReviewed(report.id)}>{reviewingId === report.id ? 'Saving...' : 'Mark reviewed'}</Button>}
                  <Link to={`/coach/reports/${report.id}`}><Button size="sm">Open <ArrowRight className="h-4 w-4" /></Button></Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
