import { useCallback, useEffect, useState } from 'react';
import { Award, TriangleAlert, ShieldCheck, Minus } from 'lucide-react';
import { Card } from '../../components/ui/Common';
import { LoadingState, ErrorState, EmptyState } from '../../components/ui/States';
import { safeFetch } from '../../lib/fetchUtils';
import type { ContractStanding, StandingLevel } from '../../lib/contractPoints';

interface StandingResponse {
  enrolled: boolean;
  contract?: { id: string; status: string; signedAt: string | null };
  standing?: ContractStanding;
  openEpicPlan?: { id: string; reason: string; expectations: string; reviewDate: string | null } | null;
  infractions?: { id: string; points: number; summary: string; createdAt: string }[];
}

const LEVEL_COPY: Record<StandingLevel, { label: string; tone: string; icon: any; message: string }> = {
  GOOD: {
    label: 'Good standing',
    tone: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    icon: ShieldCheck,
    message: 'You are meeting the expectations of your performance contract.',
  },
  STIPEND_AT_RISK: {
    label: 'Stipend at risk',
    tone: 'bg-amber-50 border-amber-200 text-amber-800',
    icon: TriangleAlert,
    message: 'Your balance has fallen below the stipend threshold. Talk to your coach about getting back on track.',
  },
  EPIC_RISK: {
    label: 'Performance improvement needed',
    tone: 'bg-red-50 border-red-200 text-red-700',
    icon: TriangleAlert,
    message: 'Your balance has reached the level where a Performance Improvement (EPIC) plan applies. Speak with your coach or Program Manager as soon as you can.',
  },
};

/**
 * The student's view of their Performance Contract. Points are their
 * professional standing: the contract opens with a pool, weeks that meet
 * expectations add to it, and upheld infractions deduct from it.
 */
export function StudentStanding() {
  const [data, setData] = useState<StandingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await safeFetch('/api/student/standing'));
    } catch (e: any) {
      setError(e.message || 'Failed to load your standing.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState message="Loading your standing" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  if (!data?.enrolled || !data.standing) {
    return (
      <EmptyState
        icon={Award}
        title="No performance contract yet"
        message="Your contract appears here once your Program Manager sets it up."
      />
    );
  }

  const s = data.standing;
  const level = LEVEL_COPY[s.level];
  const LevelIcon = level.icon;
  // How full the bank account is, against everything the contract can be worth.
  const pct = Math.min(100, Math.round((s.balance / Math.max(1, s.maximumPoints)) * 100));

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-black font-display tracking-tight text-[#0A0A0A]">Performance Contract</h1>
        <p className="text-[#6B7280] text-xs uppercase tracking-widest mt-1">{s.trackLabel} track</p>
      </div>

      <Card className="p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Current balance</p>
            <p className="text-5xl font-black text-[#0A0A0A] tabular-nums leading-none mt-2">{s.balance}</p>
            <p className="text-sm text-gray-500 mt-2">of {s.maximumPoints} possible points</p>
          </div>
          <span className={`text-[10px] uppercase font-bold tracking-widest px-3 py-1.5 rounded-full border ${level.tone}`}>
            {level.label}
          </span>
        </div>

        <div className="mt-6 h-2.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className={`h-full rounded-full ${s.level === 'GOOD' ? 'bg-emerald-500' : s.level === 'STIPEND_AT_RISK' ? 'bg-amber-500' : 'bg-red-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="grid sm:grid-cols-4 gap-4 mt-8 pt-6 border-t border-gray-100">
          <Figure label="Contract opens at" value={s.basePoints} />
          <Figure label={`Earned (${s.weeksMet} wks)`} value={`+${s.earnedPoints}`} />
          <Figure label="Deducted" value={s.deductedPoints ? `−${s.deductedPoints}` : '0'} />
          <Figure label="Stipend threshold" value={s.stipendThreshold} />
        </div>
      </Card>

      <div className={`flex items-start gap-3 p-5 rounded-2xl border ${level.tone}`}>
        <LevelIcon className="w-5 h-5 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-bold">
            {s.stipendEligible ? 'Stipend eligible' : 'Not currently stipend eligible'}
          </p>
          <p className="text-sm mt-1 opacity-90">{level.message}</p>
        </div>
      </div>

      {data.openEpicPlan && (
        <Card className="p-8 border-red-100">
          <h2 className="text-lg font-bold text-[#0A0A0A]">Your improvement plan</h2>
          <div className="mt-4 space-y-4">
            <Block label="Why it was opened" text={data.openEpicPlan.reason} />
            <Block label="What you need to do" text={data.openEpicPlan.expectations} />
            {data.openEpicPlan.reviewDate && (
              <Block
                label="Review date"
                text={new Date(data.openEpicPlan.reviewDate).toLocaleDateString(undefined, { timeZone: 'UTC' })}
              />
            )}
          </div>
        </Card>
      )}

      <Card className="p-8">
        <h2 className="text-lg font-bold text-[#0A0A0A] mb-1">Point deductions</h2>
        <p className="text-sm text-gray-500 mb-6">Only upheld infractions affect your balance.</p>

        {!data.infractions?.length ? (
          <div className="flex items-center gap-3 text-sm text-gray-400 py-2">
            <Minus className="w-5 h-5" />
            <span>No deductions on your record. Keep it up.</span>
          </div>
        ) : (
          <ul className="space-y-3">
            {data.infractions.map((entry) => (
              <li key={entry.id} className="flex items-baseline justify-between gap-4 pb-3 border-b border-gray-50 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm text-gray-800">{entry.summary}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className="text-sm font-bold text-red-600 tabular-nums shrink-0">−{entry.points}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const Figure = ({ label, value }: { label: string; value: string | number }) => (
  <div>
    <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400">{label}</p>
    <p className="text-xl font-black text-[#0A0A0A] tabular-nums mt-1.5">{value}</p>
  </div>
);

const Block = ({ label, text }: { label: string; text: string }) => (
  <div>
    <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-1">{label}</p>
    <p className="text-sm text-gray-700 whitespace-pre-wrap">{text}</p>
  </div>
);
