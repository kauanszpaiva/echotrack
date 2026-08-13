import React, { useState, useEffect } from 'react';
import { Card, Button } from '../../components/ui/Common';
import { LoadingState, ErrorState, EmptyState } from '../../components/ui/States';
import { safeFetch, downloadFile } from '../../lib/fetchUtils';
import { useAuth } from '../../hooks/useAuth';
import { Users, FileText, Target, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

export function CoachDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<any>({ students: [], reports: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'PENDING' | 'REVIEWED'>('PENDING');

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
        console.log('[Coach] Loading dashboard data...');
        const [dashData, reportsData] = await Promise.all([
          safeFetch('/api/coach/dashboard'),
          safeFetch('/api/coach/reports')
        ]);
        
        console.log('[Coach] Dashboard data received');
        setData({ ...dashData, reports: reportsData });
    } catch (e: any) {
        console.error('Failed to load Coach dashboard', e);
        setError(e.message || 'Something went wrong while loading your dashboard.');
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleExportPDF = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    try {
      await downloadFile(`/api/reports/export-pdf?id=${id}`, `Report_${id}.pdf`);
      toast.success('PDF download started');
    } catch(err) {
      toast.error('Failed to download PDF');
    }
  };

  const handleExportDOCX = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    try {
      await downloadFile(`/api/reports/export-docx?id=${id}`, `Report_${id}.docx`);
      toast.success('DOCX download started');
    } catch(err) {
      toast.error('Failed to download DOCX');
    }
  };

  if (loading) return <LoadingState message="Fetching coach analytics..." className="min-h-[400px]" />;
  if (error) return <ErrorState message={error} onRetry={fetchData} className="min-h-[400px]" />;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black font-display tracking-tight text-[#0A0A0A]">Coach Dashboard</h1>
        <p className="text-[#6B7280] text-sm mt-1">Review student progress and scheduled follow-ups.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6">
           <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-[#EFF6FF] text-[#2563EB] rounded-xl flex items-center justify-center">
                 <Users className="w-6 h-6" />
              </div>
              <div>
                 <p className="text-xs text-[#6B7280] uppercase tracking-widest font-bold">My Cohort</p>
                 <p className="text-2xl font-black">{data.students.length}</p>
              </div>
           </div>
        </Card>
        
        <Card className="p-6">
           <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-[#F0FDF4] text-[#16A34A] rounded-xl flex items-center justify-center">
                 <FileText className="w-6 h-6" />
              </div>
              <div>
                 <p className="text-xs text-[#6B7280] uppercase tracking-widest font-bold">Pending Review</p>
                 <p className="text-2xl font-black">{data.reports.filter((r:any) => r.status === 'SUBMITTED').length}</p>
              </div>
           </div>
        </Card>

        <Card className="p-6">
           <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-[#FEF2F2] text-[#DC2626] rounded-xl flex items-center justify-center">
                 <Target className="w-6 h-6" />
              </div>
              <div>
                 <p className="text-xs text-[#6B7280] uppercase tracking-widest font-bold">High Priority</p>
                 <p className="text-2xl font-black">{data.reports.filter((r:any) => r.needsSupport && r.status === 'SUBMITTED').length}</p>
              </div>
           </div>
        </Card>
      </div>

      <Card className="p-6">
         <div className="flex flex-wrap justify-between items-center gap-2 mb-6">
            <h2 className="text-xl font-bold">Weekly Performance Reports</h2>
            <Link to="/coach/reports" className="text-xs text-[#FF7A00] font-bold hover:underline">View All History</Link>
         </div>

         <div className="flex gap-6 border-b border-[#E5E7EB] mb-6 overflow-x-auto">
            <button 
               onClick={() => setActiveTab('PENDING')} 
               className={`pb-3 text-sm font-bold border-b-2 transition-all whitespace-nowrap ${
                 activeTab === 'PENDING' ? 'border-[#FF7A00] text-[#FF7A00]' : 'border-transparent text-[#6B7280] hover:text-gray-900'
               }`}
            >
               Pending Review ({data.reports.filter((r:any) => r.status === 'SUBMITTED').length})
            </button>
            <button 
               onClick={() => setActiveTab('REVIEWED')} 
               className={`pb-3 text-sm font-bold border-b-2 transition-all whitespace-nowrap ${
                 activeTab === 'REVIEWED' ? 'border-[#FF7A00] text-[#FF7A00]' : 'border-transparent text-[#6B7280] hover:text-gray-900'
               }`}
            >
               Reviewed History ({data.reports.filter((r:any) => r.status === 'REVIEWED').length})
            </button>
         </div>

         <div className="space-y-4">
            {data.reports
               .filter((r: any) => r.status === (activeTab === 'PENDING' ? 'SUBMITTED' : 'REVIEWED'))
               .slice(0, 10).map((r: any) => (
              <div key={r.id} className={`p-5 border rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center transition-all gap-4 ${
                  r.needsSupport && activeTab === 'PENDING' ? 'border-red-200 bg-red-50 hover:border-red-300' : 'border-[#E5E7EB] bg-white hover:border-[#FF7A00]'
              }`}>
                 <div>
                    <h3 className="font-bold flex items-center gap-2 text-lg">
                      {r.student.name}
                      {r.needsSupport && activeTab === 'PENDING' && <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] uppercase font-bold rounded">Needs Support</span>}
                      {r.status === 'REVIEWED' && <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] uppercase font-bold rounded">Reviewed</span>}
                    </h3>
                    <p className="text-sm text-[#6B7280] mt-1">
                        Topic: <span className="text-gray-900 font-medium">{r.weeklyTopic || 'No topic specified'}</span> • Cycle: {r.cycle?.name}
                    </p>
                 </div>
                 <div className="flex flex-col md:flex-row items-start md:items-center gap-4 w-full md:w-auto">
                    <div className="flex gap-3 text-sm border-l pl-4 border-gray-200">
                       <div><span className="text-gray-400 text-[10px] uppercase font-bold block">Energy</span> <span className="font-medium">{r.energy}/5</span></div>
                       <div><span className="text-gray-400 text-[10px] uppercase font-bold block">Mood</span> <span className="font-medium">{r.mood}/5</span></div>
                       <div><span className="text-gray-400 text-[10px] uppercase font-bold block">Attend.</span> <span className="font-medium">{r.attendance}%</span></div>
                    </div>
                    <div className="flex gap-2">
                       <Button variant="outline" className="text-xs px-3 h-8" onClick={(e) => handleExportPDF(r.id, e)}>PDF</Button>
                       <Button variant="outline" className="text-xs px-3 h-8" onClick={(e) => handleExportDOCX(r.id, e)}>DOCX</Button>
                    </div>
                    <Link to={`/coach/reports/${r.id}`} className="w-full md:w-auto mt-2 md:mt-0">
                        <Button variant={activeTab === 'PENDING' ? 'default' : 'outline'} size="sm" className="gap-2 w-full">
                            {activeTab === 'PENDING' ? 'Review & Feedback' : 'View Details'} <ArrowRight className="w-4 h-4" />
                        </Button>
                    </Link>
                 </div>
              </div>
            ))}
            {data.reports.filter((r: any) => r.status === (activeTab === 'PENDING' ? 'SUBMITTED' : 'REVIEWED')).length === 0 && (
                <EmptyState 
                  title={activeTab === 'PENDING' ? "No pending reports" : "No recent reviewed reports"} 
                  message={activeTab === 'PENDING' ? "You're all caught up! No student reports need your attention right now." : "You haven't reviewed any reports recently."}
                  className="py-16"
                />
            )}
         </div>
      </Card>
    </div>
  );
}
