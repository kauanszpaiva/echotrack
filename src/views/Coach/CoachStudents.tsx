import { useEffect, useMemo, useState } from 'react';
import { Search, Users } from 'lucide-react';
import { Card } from '../../components/ui/Common';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { safeFetch } from '../../lib/fetchUtils';

type CoachStudent = {
  id: string;
  name: string;
  email: string;
  studentProfile?: {
    pathway?: { id: string; name: string } | null;
  } | null;
};

export function CoachStudents() {
  const [students, setStudents] = useState<CoachStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pathway, setPathway] = useState('ALL');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await safeFetch('/api/coach/students');
      setStudents(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Unable to load students.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const pathways = useMemo(() => {
    const values = new Map<string, string>();
    students.forEach((student) => {
      const item = student.studentProfile?.pathway;
      if (item?.id && item.name) values.set(item.id, item.name);
    });
    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [students]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return students.filter((student) => {
      const matchesText = !needle || student.name.toLowerCase().includes(needle) || student.email.toLowerCase().includes(needle);
      const matchesPathway = pathway === 'ALL' || student.studentProfile?.pathway?.id === pathway;
      return matchesText && matchesPathway;
    });
  }, [students, query, pathway]);

  if (loading) return <LoadingState message="Loading students..." className="min-h-[400px]" />;
  if (error) return <ErrorState message={error} onRetry={load} className="min-h-[400px]" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black font-display tracking-tight text-[#0A0A0A]">My Students</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Students assigned to your coaching roster.</p>
      </div>

      <Card className="p-4 sm:p-5 rounded-3xl">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or email"
              className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-[#FF7A00]"
            />
          </label>
          <select
            value={pathway}
            onChange={(event) => setPathway(event.target.value)}
            className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#FF7A00]"
          >
            <option value="ALL">All pathways</option>
            {pathways.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState title="No students found" message="No students match the current filters." icon={Users} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filtered.map((student) => (
            <Card key={student.id} className="p-5 rounded-3xl">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-50 font-black text-[#FF7A00]">
                  {student.name?.[0]?.toUpperCase() || 'S'}
                </div>
                <div className="min-w-0">
                  <h2 className="truncate font-bold text-gray-950">{student.name}</h2>
                  <p className="truncate text-sm text-gray-500">{student.email}</p>
                  <span className="mt-3 inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">
                    {student.studentProfile?.pathway?.name || 'No pathway assigned'}
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
