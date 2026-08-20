import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Users, Link2, Unlink } from 'lucide-react';
import { Button, Card, Input, Select } from '../../components/ui/Common';
import { LoadingState, ErrorState, EmptyState } from '../../components/ui/States';
import { safeFetch } from '../../lib/fetchUtils';
import { PHASE_SHORT_LABELS } from '../../../shared/phases';

interface Cohort {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  phase: string;
  communities: { id: string; name: string; programManager: { id: string; name: string } | null; _count: { studentProfiles: number } }[];
}

interface Placement {
  id: string;
  name: string;
  email: string;
  psm: { id: string; name: string } | null;
  coach: { id: string; name: string } | null;
  community: { id: string; name: string } | null;
  phase: string;
}

/**
 * Cohorts and placement. Both halves exist because nothing else in the app can
 * create a cohort, attach a learning community to one, or assign a student's
 * PSM — without which every student stays in Phase 1 and the Phase 2 report and
 * timesheet flow is unreachable.
 */
export function Cohorts() {
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [unassigned, setUnassigned] = useState<{ id: string; name: string }[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [psms, setPsms] = useState<{ id: string; name: string; role: string }[]>([]);
  const [selectedCohort, setSelectedCohort] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '' });
  const [attach, setAttach] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = selectedCohort ? `?cohortId=${encodeURIComponent(selectedCohort)}` : '';
      const [cohortData, placementData] = await Promise.all([
        safeFetch('/api/admin/cohorts'),
        safeFetch(`/api/admin/placements${params}`),
      ]);
      setCohorts(cohortData.cohorts ?? []);
      setUnassigned(cohortData.unassignedCommunities ?? []);
      setPlacements(placementData.students ?? []);
      setPsms(placementData.psms ?? []);
    } catch (e: any) {
      setError(e.message || 'Failed to load cohorts.');
    } finally {
      setLoading(false);
    }
  }, [selectedCohort]);

  useEffect(() => { load(); }, [load]);

  const create = async (e: any) => {
    e.preventDefault();
    try {
      await safeFetch('/api/admin/cohorts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      toast.success(`Cohort ${form.name} created`);
      setForm({ name: '', startDate: '', endDate: '' });
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create the cohort');
    }
  };

  const setCommunityCohort = async (communityId: string, cohortId: string | null) => {
    try {
      await safeFetch(`/api/admin/communities/${communityId}/cohort`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cohortId }),
      });
      toast.success(cohortId ? 'Learning community attached' : 'Learning community detached');
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update the learning community');
    }
  };

  const setPsm = async (studentId: string, psmId: string) => {
    try {
      await safeFetch(`/api/admin/students/${studentId}/psm`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ psmId: psmId || null }),
      });
      toast.success(psmId ? 'PSM assigned' : 'PSM cleared');
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to assign the PSM');
    }
  };

  if (loading) return <LoadingState message="Loading cohorts" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const psmOptions = psms.map((p) => ({ value: p.id, label: `${p.name}${p.role === 'COACH' ? ' (coach)' : ''}` }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-black font-display tracking-tight text-[#0A0A0A]">Cohorts & Placement</h1>
        <p className="text-[#6B7280] text-xs uppercase tracking-widest mt-1">
          One intake per cycle · two learning communities each
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="p-6 h-fit">
          <h2 className="font-bold text-[#0A0A0A] mb-1">New cohort</h2>
          <p className="text-xs text-[#6B7280] mb-4">
            The start date drives the phase: six months of Learning &amp; Development, then the internship.
          </p>
          <form onSubmit={create} className="space-y-3">
            <Input label="Name" value={form.name} onChange={(v: string) => setForm(f => ({ ...f, name: v }))} required placeholder="Spring 2026" />
            <Input label="Start date" type="date" value={form.startDate} onChange={(v: string) => setForm(f => ({ ...f, startDate: v }))} />
            <Input label="End date" type="date" value={form.endDate} onChange={(v: string) => setForm(f => ({ ...f, endDate: v }))} />
            <Button type="submit" className="w-full" disabled={!form.name}>
              <Plus className="w-4 h-4" /> Create cohort
            </Button>
          </form>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          {cohorts.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No cohorts yet"
              message="Create one, then attach its two learning communities so phase routing can start."
            />
          ) : cohorts.map((cohort) => (
            <Card key={cohort.id} className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-[#0A0A0A]">{cohort.name}</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    {cohort.startDate
                      ? `Starts ${new Date(cohort.startDate).toLocaleDateString(undefined, { timeZone: 'UTC' })}`
                      : 'No start date — students stay in Phase 1 until one is set'}
                  </p>
                </div>
                <span className="text-[9px] uppercase font-bold tracking-widest px-2 py-1 rounded border bg-sky-50 text-sky-600 border-sky-200">
                  {PHASE_SHORT_LABELS[cohort.phase as keyof typeof PHASE_SHORT_LABELS] ?? cohort.phase}
                </span>
              </div>

              <div className="mt-5 space-y-2">
                {cohort.communities.length === 0 ? (
                  <p className="text-sm text-gray-400">No learning communities attached yet.</p>
                ) : cohort.communities.map((community) => (
                  <div key={community.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#FAFAFA]">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#0A0A0A] truncate">{community.name}</p>
                      <p className="text-xs text-gray-400">
                        {community._count.studentProfiles} students
                        {community.programManager && ` · PM ${community.programManager.name}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCommunityCohort(community.id, null)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-red-600 transition-colors shrink-0"
                    >
                      <Unlink className="w-3.5 h-3.5" /> Detach
                    </button>
                  </div>
                ))}
              </div>

              {cohort.communities.length < 2 && unassigned.length > 0 && (
                <div className="flex flex-wrap gap-3 items-end mt-4 pt-4 border-t border-gray-100">
                  <Select
                    label="Attach a learning community"
                    placeholder="Select one"
                    options={unassigned.map((c) => ({ value: c.id, label: c.name }))}
                    value={attach[cohort.id] ?? ''}
                    onChange={(v: string) => setAttach((a) => ({ ...a, [cohort.id]: v }))}
                    wrapperClassName="flex-1 min-w-[200px]"
                  />
                  <Button
                    variant="outline"
                    disabled={!attach[cohort.id]}
                    onClick={() => setCommunityCohort(attach[cohort.id], cohort.id)}
                    className="h-[58px]"
                  >
                    <Link2 className="w-4 h-4" /> Attach
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-bold text-[#0A0A0A]">Placement Success Managers</h2>
            <p className="text-sm text-gray-500 mt-1">
              Phase 2 reports and timesheets route to the student's PSM. Without one they fall back to the coach.
            </p>
          </div>
          {cohorts.length > 0 && (
            <Select
              label="Cohort"
              placeholder="All cohorts"
              options={cohorts.map((c) => ({ value: c.id, label: c.name }))}
              value={selectedCohort}
              onChange={setSelectedCohort}
              wrapperClassName="min-w-[200px]"
            />
          )}
        </div>

        {placements.length === 0 ? (
          <EmptyState icon={Users} title="No students" message="Students appear here once they are enrolled." />
        ) : (
          <Card className="p-2">
            {placements.map((student) => (
              <div key={student.id} className="flex flex-wrap items-center gap-4 p-4 border-b border-gray-50 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[#0A0A0A] truncate">{student.name}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {[student.community?.name, student.coach && `Coach ${student.coach.name}`]
                      .filter(Boolean).join(' · ') || student.email}
                  </p>
                </div>
                <span className="text-[9px] uppercase font-bold tracking-widest px-2 py-1 rounded border bg-gray-50 text-gray-500 border-gray-200 shrink-0">
                  {PHASE_SHORT_LABELS[student.phase as keyof typeof PHASE_SHORT_LABELS] ?? student.phase}
                </span>
                <Select
                  placeholder="No PSM"
                  options={psmOptions}
                  value={student.psm?.id ?? ''}
                  onChange={(v: string) => setPsm(student.id, v)}
                  wrapperClassName="w-[240px]"
                />
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
