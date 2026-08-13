import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card } from '../../components/ui/Common';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { safeFetch } from '../../lib/fetchUtils';

type AlertItem = {
  id: string;
  type: string;
  severity: string;
  description: string;
  createdAt: string;
  student?: { name?: string };
};

export function CoachAlerts() {
  const [items, setItems] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await safeFetch('/api/coach/alerts');
      setItems(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Unable to load alerts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const resolve = async (id: string) => {
    try {
      await safeFetch(`/api/alerts/${id}/resolve`, { method: 'PATCH' });
      setItems((current) => current.filter((item) => item.id !== id));
      toast.success('Alert resolved');
    } catch (err: any) {
      toast.error(err.message || 'Unable to resolve alert.');
    }
  };

  if (loading) return <LoadingState message="Loading alerts..." className="min-h-[400px]" />;
  if (error) return <ErrorState message={error} onRetry={load} className="min-h-[400px]" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black font-display tracking-tight text-[#0A0A0A]">Active Alerts</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Unresolved support signals for students assigned to you.</p>
      </div>
      <Card className="rounded-3xl">
        {items.length === 0 ? (
          <div className="p-12 text-center"><CheckCircle2 className="mx-auto mb-4 h-11 w-11 text-green-600" /><p className="font-bold text-gray-800">No active alerts.</p></div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((item) => (
              <div key={item.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600"><AlertCircle className="h-5 w-5" /></div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-gray-950">{item.student?.name || 'Student'}</span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-600">{item.severity}</span>
                      <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-bold uppercase text-orange-700">{item.type}</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{item.description}</p>
                    <p className="mt-1 text-xs text-gray-400">{new Date(item.createdAt).toLocaleString()}</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => resolve(item.id)} className="self-start text-green-700"><CheckCircle2 className="h-4 w-4" /> Resolve</Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
