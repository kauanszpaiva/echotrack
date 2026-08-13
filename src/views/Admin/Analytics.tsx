import { useState, useEffect, useCallback } from 'react';
import { Card } from '../../components/ui/Common';
import { LoadingState, ErrorState } from '../../components/ui/States';
import { safeFetch } from '../../lib/fetchUtils';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

export function Analytics() {
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // A failed request used to be logged to the console and nothing else, so the
  // page sat on "Loading analytics..." forever with no way to retry.
  const load = useCallback(() => {
    setError(null);
    setStats(null);
    safeFetch('/api/admin/analytics')
      .then(data => setStats(data))
      .catch(e => {
        console.error('Failed to load analytics', e);
        setError(e.message || 'Something went wrong while loading analytics.');
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} className="min-h-[400px]" />;
  if (!stats) return <LoadingState message="Loading analytics..." className="min-h-[400px]" />;

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];
  const alertDistribution = stats.alertDistribution ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black font-display tracking-tight text-[#0A0A0A]">Analytics</h1>
        <p className="text-[#6B7280] text-sm mt-1">Platform metrics overview</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 sm:p-6">
          <p className="text-xs sm:text-sm font-bold text-gray-500">Total Students</p>
          <p className="text-2xl sm:text-3xl font-black mt-2 text-[#0A0A0A]">{stats.totalStudents}</p>
        </Card>
        <Card className="p-4 sm:p-6">
          <p className="text-xs sm:text-sm font-bold text-gray-500">Submission Rate</p>
          <p className="text-2xl sm:text-3xl font-black mt-2 text-brand-orange">{stats.submissionRate}%</p>
        </Card>
        <Card className="p-4 sm:p-6">
          <p className="text-xs sm:text-sm font-bold text-gray-500">Needs Support</p>
          <p className="text-2xl sm:text-3xl font-black mt-2 text-red-600">{stats.studentsNeedingSupport}</p>
        </Card>
        <Card className="p-4 sm:p-6">
          <p className="text-xs sm:text-sm font-bold text-gray-500">Active Alerts</p>
          <p className="text-2xl sm:text-3xl font-black mt-2 text-amber-500">{stats.activeAlerts}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-4 sm:p-6">
          <h2 className="font-bold text-lg mb-4">Submission Trend (Last 30 Days)</h2>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.recent30DaySubmissions}>
                <defs>
                  <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ff6b00" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#ff6b00" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="date" tick={{fontSize: 12}} stroke="#9CA3AF" tickMargin={10} />
                <YAxis tick={{fontSize: 12}} stroke="#9CA3AF" />
                <RechartsTooltip />
                <Area type="monotone" dataKey="count" stroke="#ff6b00" strokeWidth={3} fillOpacity={1} fill="url(#colorCount)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4 sm:p-6">
          <h2 className="font-bold text-lg mb-4">Alert Distribution</h2>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                {/* `outerRadius` in px would overflow a phone-width card; a
                    percentage keeps the pie inside its container at any width. */}
                <Pie data={alertDistribution} dataKey="count" nameKey="type" cx="50%" cy="50%" outerRadius="70%" label>
                  {alertDistribution.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}
