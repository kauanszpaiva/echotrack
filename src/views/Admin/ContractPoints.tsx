import { useMemo, useState } from 'react';
import { Award, CheckCircle2, Info } from 'lucide-react';
import { Card, Input, Select } from '../../components/ui/Common';
import {
  calculateContractPoints,
  CONTRACT_TRACK_RULES,
  type ContractTrack,
} from '../../lib/contractPoints';

const trackOptions = (Object.entries(CONTRACT_TRACK_RULES) as [ContractTrack, (typeof CONTRACT_TRACK_RULES)[ContractTrack]][])
  .map(([value, rules]) => ({ value, label: rules.label }));

export function ContractPoints() {
  const [track, setTrack] = useState<ContractTrack>('IT');
  const [weeks, setWeeks] = useState('0');
  const rules = CONTRACT_TRACK_RULES[track];
  const numericWeeks = Number(weeks);
  const error = !Number.isInteger(numericWeeks) || numericWeeks < 0 || numericWeeks > rules.durationWeeks
    ? `Enter a whole number between 0 and ${rules.durationWeeks}.`
    : null;
  const result = useMemo(
    () => error ? null : calculateContractPoints(track, numericWeeks),
    [error, numericWeeks, track],
  );

  const updateTrack = (value: ContractTrack) => {
    setTrack(value);
    const nextMaximum = CONTRACT_TRACK_RULES[value].durationWeeks;
    setWeeks(current => String(Math.min(Number(current) || 0, nextMaximum)));
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-orange-50 text-[#FF7A00] flex items-center justify-center">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-black font-display tracking-tight text-[#0A0A0A]">Contract Points</h1>
            <p className="text-[#6B7280] text-sm mt-1">Calculate a student's points from their track and successful weeks.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-6 items-start">
        <Card className="p-7 sm:p-8">
          <h2 className="text-lg font-bold mb-1">Student performance</h2>
          <p className="text-sm text-gray-500 mb-7">Choose a track, then enter the number of weeks expectations were met.</p>
          <div className="space-y-5">
            <Select
              label="Student track"
              value={track}
              onChange={updateTrack}
              options={trackOptions}
              required
            />
            <Input
              label="Weeks met expectations"
              value={weeks}
              onChange={setWeeks}
              type="number"
              inputMode="numeric"
              min={0}
              max={rules.durationWeeks}
              step={1}
              required
              aria-invalid={Boolean(error)}
              aria-describedby="weeks-help"
              className={error ? 'border-red-300 focus:border-red-400 focus:ring-red-50' : ''}
            />
            <div id="weeks-help" className={`flex items-start gap-2 text-xs ${error ? 'text-red-600' : 'text-gray-500'}`}>
              <Info className="w-4 h-4 shrink-0" />
              <span>{error || `${rules.label} runs for ${rules.durationWeeks} weeks.`}</span>
            </div>
          </div>
        </Card>

        <Card className="bg-gradient-to-br from-[#161616] to-[#292929] text-white p-7 sm:p-8">
          <div className="flex justify-between items-start gap-4 mb-8">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold">Calculated total</p>
              <p className="text-lg font-bold mt-2">{rules.label}</p>
            </div>
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-gray-300">Max {rules.basePoints + rules.durationWeeks * 10}</span>
          </div>

          {result ? (
            <>
              <div className="flex items-end gap-3 mb-8" aria-live="polite">
                <span className="text-6xl sm:text-7xl font-black font-display tracking-tight">{result.totalPoints}</span>
                <span className="text-gray-400 font-medium mb-2">points</span>
              </div>
              <div className="space-y-4 border-t border-white/10 pt-6">
                <div className="flex justify-between text-sm"><span className="text-gray-400">Base points</span><strong>{result.basePoints}</strong></div>
                <div className="flex justify-between text-sm"><span className="text-gray-400">Weeks met expectations</span><strong>{result.weeksMet} / {result.durationWeeks}</strong></div>
                <div className="flex justify-between text-sm"><span className="text-gray-400">Earned points</span><strong>{result.weeksMet} × {result.pointsPerWeek} = {result.earnedPoints}</strong></div>
              </div>
              <div className="mt-7 rounded-2xl bg-emerald-500/10 border border-emerald-400/20 p-4 flex gap-3 text-sm text-emerald-300">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                Total = {result.basePoints} base + {result.earnedPoints} earned points
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-5 text-sm text-red-200" aria-live="polite">
              Correct the weeks entered to calculate contract points.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
