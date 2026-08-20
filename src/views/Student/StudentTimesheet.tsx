import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Clock, Send, Save } from 'lucide-react';
import { Button, Card, Input } from '../../components/ui/Common';
import { LoadingState, ErrorState } from '../../components/ui/States';
import { safeFetch } from '../../lib/fetchUtils';
import { Textarea } from '../Profile/helpers';
import { PHASE_LABELS } from '../../../shared/phases';

interface Entry { workDate: string; hours: string; description: string }

const STATUS_STYLE: Record<string, string> = {
  SUBMITTED: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-600 border-red-200',
  DRAFT: 'bg-gray-50 text-gray-500 border-gray-200',
};

/** ISO timestamp → the "YYYY-MM-DD" a <input type="date"> expects, read in UTC. */
const toDateInput = (value: string) => new Date(value).toISOString().slice(0, 10);

/**
 * Phase 2 timesheet. During the corporate internship a student submits their
 * hours to their Placement Success Manager alongside the weekly status report.
 */
export function StudentTimesheet() {
  const [data, setData] = useState<any>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await safeFetch('/api/student/timesheet');
      setData(result);
      const existing = result.timesheet?.entries ?? [];
      setEntries(existing.map((entry: any) => ({
        workDate: toDateInput(entry.workDate),
        hours: String(entry.hours),
        description: entry.description ?? '',
      })));
      setNotes(result.timesheet?.notes ?? '');
    } catch (e: any) {
      setError(e.message || 'Failed to load your timesheet.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (status: 'DRAFT' | 'SUBMITTED') => {
    setSaving(true);
    try {
      await safeFetch('/api/student/timesheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes, entries }),
      });
      toast.success(status === 'SUBMITTED' ? 'Timesheet submitted' : 'Draft saved');
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save your timesheet');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState message="Loading your timesheet" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  // Phase 1 students have no timesheet — their reports go to their coach.
  if (!data?.required) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card className="p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gray-50 text-gray-300 flex items-center justify-center mx-auto mb-5">
            <Clock className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold text-[#0A0A0A]">Timesheets start in Phase 2</h1>
          <p className="text-sm text-gray-500 mt-2">
            You're in {PHASE_LABELS[data?.phase as keyof typeof PHASE_LABELS] ?? 'Phase 1'}. Your weekly status
            report goes to your coach. Once your internship begins, you'll log hours here and submit them to
            your Placement Success Manager.
          </p>
        </Card>
      </div>
    );
  }

  const status = data.timesheet?.status ?? 'DRAFT';
  const locked = status === 'SUBMITTED' || status === 'APPROVED';
  const total = entries.reduce((sum, entry) => sum + (Number(entry.hours) || 0), 0);

  const update = (index: number, key: keyof Entry) => (value: string) =>
    setEntries((current) => current.map((entry, i) => (i === index ? { ...entry, [key]: value } : entry)));

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black font-display tracking-tight text-[#0A0A0A]">Internship Timesheet</h1>
          <p className="text-[#6B7280] text-xs uppercase tracking-widest mt-1">
            {data.cycle?.name ?? 'No open cycle'}
          </p>
        </div>
        <span className={`text-[9px] uppercase font-bold tracking-widest px-2 py-1 rounded border ${STATUS_STYLE[status]}`}>
          {status.toLowerCase()}
        </span>
      </div>

      {data.missingRecipient ? (
        <div className="p-5 rounded-2xl bg-amber-50 border border-amber-100 text-sm text-amber-800">
          You don't have a Placement Success Manager assigned yet. Ask your Program Manager to set one so your
          timesheet reaches the right person.
        </div>
      ) : data.recipient ? (
        <div className="p-5 rounded-2xl bg-[#FFF4EB] border border-orange-100 text-sm text-gray-700">
          This goes to <span className="font-bold text-[#0A0A0A]">{data.recipient.name}</span>, your Placement
          Success Manager — along with your weekly status report.
        </div>
      ) : null}

      {status === 'REJECTED' && data.timesheet?.reviewNote && (
        <div className="p-5 rounded-2xl bg-red-50 border border-red-100">
          <p className="text-xs font-bold uppercase tracking-widest text-red-600 mb-1">Sent back for changes</p>
          <p className="text-sm text-red-700">{data.timesheet.reviewNote}</p>
        </div>
      )}

      <Card className="p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-[#0A0A0A]">Hours</h2>
          <div className="text-right">
            <span className="text-2xl font-black text-[#0A0A0A] tabular-nums">{Math.round(total * 100) / 100}</span>
            <span className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2">total</span>
          </div>
        </div>

        {entries.length === 0 ? (
          <p className="text-sm text-gray-400 py-2">No hours logged yet. Add a day to get started.</p>
        ) : (
          <div className="space-y-3">
            {entries.map((entry, index) => (
              <div key={index} className="flex flex-wrap gap-3 items-end">
                <Input
                  label={index === 0 ? 'Date' : ''}
                  type="date"
                  value={entry.workDate}
                  onChange={update(index, 'workDate')}
                  disabled={locked}
                  wrapperClassName="w-[170px]"
                />
                <Input
                  label={index === 0 ? 'Hours' : ''}
                  type="number"
                  step="0.25"
                  min="0"
                  max="24"
                  value={entry.hours}
                  onChange={update(index, 'hours')}
                  disabled={locked}
                  wrapperClassName="w-[110px]"
                />
                <Input
                  label={index === 0 ? 'What you worked on' : ''}
                  value={entry.description}
                  onChange={update(index, 'description')}
                  disabled={locked}
                  wrapperClassName="flex-1 min-w-[200px]"
                />
                {!locked && (
                  <button
                    type="button"
                    aria-label="Remove entry"
                    onClick={() => setEntries((current) => current.filter((_, i) => i !== index))}
                    className="w-[58px] h-[58px] rounded-2xl flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {!locked && (
          <Button
            variant="outline"
            className="mt-5"
            onClick={() => setEntries((current) => [...current, { workDate: '', hours: '', description: '' }])}
          >
            <Plus className="w-4 h-4" /> Add a day
          </Button>
        )}
      </Card>

      <Card className="p-8">
        <Textarea
          label="Notes for your PSM"
          value={notes}
          onChange={setNotes}
          rows={4}
          disabled={locked}
          hint="Anything your PSM should know — schedule changes, missed days, workplace issues."
        />
      </Card>

      {locked ? (
        <p className="text-sm text-gray-500 text-center">
          {status === 'APPROVED'
            ? 'This timesheet has been approved.'
            : 'Submitted — your PSM will review it shortly.'}
        </p>
      ) : (
        <div className="flex justify-end gap-3">
          <Button variant="outline" disabled={saving} onClick={() => save('DRAFT')}>
            <Save className="w-4 h-4" /> Save draft
          </Button>
          <Button disabled={saving || entries.length === 0} onClick={() => save('SUBMITTED')}>
            <Send className="w-4 h-4" /> Submit to PSM
          </Button>
        </div>
      )}
    </div>
  );
}
