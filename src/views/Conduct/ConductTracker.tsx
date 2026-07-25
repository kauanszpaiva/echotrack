import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, MessageSquare, Plus, Search, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '../../components/ui/Common';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useAuth } from '../../hooks/useAuth';
import { safeFetch } from '../../lib/fetchUtils';
import type { ConductEntry, ConductEntryType } from '../../types';

type Student = { id: string; name: string; email: string };

export function ConductTracker() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [entries, setEntries] = useState<ConductEntry[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'INFRACTION' | 'CONVERSATION' | 'PENDING'>('ALL');
  const [query, setQuery] = useState('');

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [entryData, studentData] = await Promise.all([safeFetch('/api/conduct'), safeFetch('/api/conduct/students')]);
      setEntries(entryData); setStudents(studentData);
    } catch (e: any) { setError(e.message || 'Unable to load conduct records.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const visible = useMemo(() => entries.filter((entry) => {
    const matchesFilter = filter === 'ALL' || (filter === 'PENDING' ? entry.status === 'PENDING' : entry.type === filter);
    const text = `${entry.student.name} ${entry.summary} ${entry.author.name}`.toLowerCase();
    return matchesFilter && text.includes(query.toLowerCase());
  }), [entries, filter, query]);
  const approvedPoints = entries.filter((e) => e.type === 'INFRACTION' && e.status === 'APPROVED').reduce((sum, e) => sum + e.points, 0);

  const review = async (entry: ConductEntry, status: 'APPROVED' | 'CLEARED'): Promise<void> => {
    let points = entry.points;
    if (status === 'APPROVED' && entry.type === 'INFRACTION') {
      const response = window.prompt('Final point deduction (1–100)', String(entry.points));
      if (response === null) return;
      points = Number(response);
      if (!Number.isInteger(points) || points < 1 || points > 100) { toast.error('Enter a whole number from 1 to 100.'); return; }
    }
    try {
      const updated = await safeFetch(`/api/conduct/${entry.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, points }) });
      setEntries((current) => current.map((item) => item.id === updated.id ? updated : item));
      toast.success(status === 'APPROVED' ? 'Entry approved.' : 'Entry cleared.');
    } catch (e: any) { toast.error(e.message); }
  };

  if (loading) return <LoadingState message="Loading conduct records..." className="min-h-[400px]" />;
  if (error) return <ErrorState message={error} onRetry={load} className="min-h-[400px]" />;

  return <div className="max-w-7xl mx-auto space-y-6">
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#FF7A00]">Student conduct</p><h1 className="text-3xl font-black font-display tracking-tight">Infraction Points</h1><p className="text-sm text-gray-500 mt-1">Document incidents, conversations, and administrative decisions.</p></div>
      <button onClick={() => setShowForm(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0A0A0A] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#272727]"><Plus className="w-4 h-4" /> New entry</button>
    </div>

    <div className="grid sm:grid-cols-3 gap-4">
      <Metric label="Approved deductions" value={`${approvedPoints} pts`} icon={<ShieldAlert />} tone="orange" />
      <Metric label="Pending admin review" value={String(entries.filter(e => e.status === 'PENDING').length)} icon={<AlertTriangle />} tone="yellow" />
      <Metric label="Conversation notes" value={String(entries.filter(e => e.type === 'CONVERSATION').length)} icon={<MessageSquare />} tone="blue" />
    </div>

    <Card className="p-0 overflow-hidden">
      <div className="p-4 border-b border-gray-200 flex flex-col lg:flex-row gap-3 justify-between">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl overflow-x-auto">
          {(['ALL','INFRACTION','CONVERSATION','PENDING'] as const).map(value => <button key={value} onClick={() => setFilter(value)} className={`px-3 py-2 text-[11px] font-bold rounded-lg whitespace-nowrap ${filter === value ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>{value === 'ALL' ? 'All entries' : value === 'CONVERSATION' ? 'Conversations' : value[0] + value.slice(1).toLowerCase()}</button>)}
        </div>
        <label className="relative"><Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search records" className="w-full lg:w-72 border border-gray-200 rounded-xl py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-orange-200" /></label>
      </div>
      {visible.length === 0 ? <EmptyState title="No conduct entries" message="Entries matching your filters will appear here." icon={ShieldAlert} className="py-16" /> : <div className="divide-y divide-gray-100">{visible.map(entry => <div key={entry.id}><EntryRow entry={entry} isAdmin={isAdmin} onReview={review} /></div>)}</div>}
    </Card>
    {showForm && <EntryForm students={students} isAdmin={isAdmin} onClose={() => setShowForm(false)} onCreated={(entry) => { setEntries(current => [entry, ...current]); setShowForm(false); toast.success(entry.status === 'PENDING' ? 'Submitted for admin review.' : 'Entry logged.'); }} />}
  </div>;
}

function Metric({ label, value, icon, tone }: { label: string; value: string; icon: ReactNode; tone: 'orange'|'yellow'|'blue' }) {
  const colors = { orange: 'bg-orange-50 text-orange-600', yellow: 'bg-amber-50 text-amber-600', blue: 'bg-blue-50 text-blue-600' };
  return <Card className="p-5 flex items-center gap-4"><span className={`w-11 h-11 rounded-xl grid place-items-center [&>svg]:w-5 [&>svg]:h-5 ${colors[tone]}`}>{icon}</span><div><p className="text-2xl font-black">{value}</p><p className="text-xs text-gray-500">{label}</p></div></Card>;
}

function EntryRow({ entry, isAdmin, onReview }: { entry: ConductEntry; isAdmin: boolean; onReview: (e: ConductEntry, s: 'APPROVED'|'CLEARED') => void }) {
  const infraction = entry.type === 'INFRACTION';
  return <article className="p-5 hover:bg-gray-50/70">
    <div className="flex flex-col md:flex-row gap-4 justify-between">
      <div className="flex gap-3 min-w-0"><span className={`w-10 h-10 shrink-0 rounded-xl grid place-items-center ${infraction ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>{infraction ? <ShieldAlert className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{entry.student.name}</h3><Badge status={entry.status} /><span className="text-[10px] font-bold uppercase text-gray-400">{infraction ? 'Conduct Infraction' : 'Logged Conversation'}</span></div><p className="text-sm text-gray-700 mt-2">{entry.summary}</p><p className="text-xs text-gray-500 mt-2"><b>{infraction ? 'Action taken:' : 'Follow-up notes:'}</b> {entry.followUp}</p><p className="text-[11px] text-gray-400 mt-3">Logged by {entry.author.role === 'INSTRUCTOR' ? 'Teacher' : 'Admin'} ({entry.author.name}) · {new Date(entry.createdAt).toLocaleString()}</p></div></div>
      <div className="md:text-right shrink-0"><p className={`text-lg font-black ${infraction ? 'text-red-600' : 'text-gray-500'}`}>{infraction ? `−${entry.points} Points` : '0 Points'}</p>{isAdmin && entry.status === 'PENDING' && <div className="flex gap-2 mt-3"><button onClick={() => onReview(entry, 'CLEARED')} className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100" title="Clear entry"><X className="w-4 h-4" /></button><button onClick={() => onReview(entry, 'APPROVED')} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-600 text-white text-xs font-bold"><Check className="w-4 h-4" /> Approve</button></div>}</div>
    </div>
  </article>;
}
function Badge({ status }: { status: ConductEntry['status'] }) { const styles = { APPROVED: 'bg-green-50 text-green-700', PENDING: 'bg-amber-50 text-amber-700', CLEARED: 'bg-gray-100 text-gray-500' }; return <span className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-wider ${styles[status]}`}>{status === 'PENDING' ? 'Pending admin review' : status}</span>; }

function EntryForm({ students, isAdmin, onClose, onCreated }: { students: Student[]; isAdmin: boolean; onClose: () => void; onCreated: (e: ConductEntry) => void }) {
  const [type, setType] = useState<ConductEntryType>('INFRACTION'); const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); const data = new FormData(event.currentTarget); try { const entry = await safeFetch('/api/conduct', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ studentId: data.get('studentId'), type, points: type === 'INFRACTION' ? Number(data.get('points')) : 0, summary: data.get('summary'), followUp: data.get('followUp') }) }); onCreated(entry); } catch (e: any) { toast.error(e.message); setSaving(false); } };
  return <div className="fixed inset-0 z-[100] bg-black/45 backdrop-blur-sm p-4 grid place-items-center" onMouseDown={e => e.target === e.currentTarget && onClose()}><form onSubmit={submit} className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto"><div className="p-6 border-b flex justify-between"><div><h2 className="text-xl font-black">Log a conduct entry</h2><p className="text-xs text-gray-500 mt-1">Required fields are marked with an asterisk.</p></div><button type="button" onClick={onClose}><X className="w-5 h-5" /></button></div><div className="p-6 space-y-5">
    <Field label="Student *"><select name="studentId" required className="input"><option value="">Select a student</option>{students.map(s => <option key={s.id} value={s.id}>{s.name} — {s.email}</option>)}</select></Field>
    <div><label className="label">Log type *</label><div className="grid grid-cols-2 gap-3"><TypeButton active={type === 'INFRACTION'} onClick={() => setType('INFRACTION')} title="Infraction" detail="Points deducted" /><TypeButton active={type === 'CONVERSATION'} onClick={() => setType('CONVERSATION')} title="Conversation only" detail="No point impact" /></div></div>
    {type === 'INFRACTION' && <Field label="Infraction points *" hint="Minor incidents are typically 5–10 points; major incidents are 15+."><input name="points" required type="number" min="1" max="100" defaultValue="5" className="input" /></Field>}
    <Field label={type === 'INFRACTION' ? 'Incident summary *' : 'Conversation summary *'}><textarea name="summary" required maxLength={2000} rows={3} className="input resize-none" placeholder="Briefly describe what occurred." /></Field>
    <Field label={type === 'INFRACTION' ? 'Action taken / follow-up *' : 'Follow-up notes *'}><textarea name="followUp" required maxLength={2000} rows={3} className="input resize-none" placeholder="Warning given, parent contacted, next steps, or resolution." /></Field>
    {type === 'INFRACTION' && !isAdmin && <p className="text-xs rounded-xl bg-amber-50 text-amber-800 p-3">Teacher-reported infractions remain pending until an administrator approves the final point value.</p>}
  </div><div className="p-5 bg-gray-50 border-t flex justify-end gap-3"><button type="button" onClick={onClose} className="px-4 py-2.5 text-sm font-bold text-gray-600">Cancel</button><button disabled={saving} className="px-5 py-2.5 bg-[#FF7A00] text-white rounded-xl text-sm font-bold disabled:opacity-50">{saving ? 'Saving...' : type === 'INFRACTION' && !isAdmin ? 'Submit for review' : 'Log entry'}</button></div></form></div>;
}
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) { return <label className="block"><span className="label">{label}</span>{children}{hint && <span className="text-[11px] text-gray-400 mt-1.5 block">{hint}</span>}</label>; }
function TypeButton({ active, onClick, title, detail }: { active: boolean; onClick: () => void; title: string; detail: string }) { return <button type="button" onClick={onClick} className={`p-3 rounded-xl border text-left ${active ? 'border-orange-400 bg-orange-50 ring-1 ring-orange-300' : 'border-gray-200'}`}><span className="block text-sm font-bold">{title}</span><span className="text-[11px] text-gray-500">{detail}</span></button>; }
