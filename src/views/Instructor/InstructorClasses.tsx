import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Search, Users } from 'lucide-react';
import { Card } from '../../components/ui/Common';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { safeFetch } from '../../lib/fetchUtils';

type InstructorClass = {
  id: string;
  name: string;
  schedule?: string | null;
  pathway?: { name?: string } | null;
  _count?: { studentClassEnrollments?: number };
};

export function InstructorClasses() {
  const [classes, setClasses] = useState<InstructorClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await safeFetch('/api/instructor/dashboard');
      setClasses(Array.isArray(data?.classes) ? data.classes : []);
    } catch (err: any) {
      setError(err.message || 'Unable to load classes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return classes.filter((item) => !needle || item.name.toLowerCase().includes(needle) || item.pathway?.name?.toLowerCase().includes(needle));
  }, [classes, query]);

  if (loading) return <LoadingState message="Loading classes..." className="min-h-[400px]" />;
  if (error) return <ErrorState message={error} onRetry={load} className="min-h-[400px]" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black font-display tracking-tight text-[#0A0A0A]">My Classes</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Active instructional classes assigned to your account.</p>
      </div>

      <Card className="p-4 sm:p-5 rounded-3xl">
        <label className="relative block max-w-xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search class or pathway" className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-[#FF7A00]" />
        </label>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState title="No classes assigned" message="Assigned classes will appear here after an administrator links them to your instructor account." icon={BookOpen} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <Card key={item.id} className="p-5 rounded-3xl">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><BookOpen className="h-5 w-5" /></div>
              <h2 className="mt-4 font-bold text-gray-950">{item.name}</h2>
              <p className="mt-1 text-sm text-gray-500">{item.pathway?.name || 'General pathway'}</p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-600">
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1"><Users className="h-3.5 w-3.5" /> {item._count?.studentClassEnrollments ?? 0} students</span>
                {item.schedule && <span className="rounded-full bg-gray-100 px-2.5 py-1">{item.schedule}</span>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
