import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, MapPin, Briefcase } from 'lucide-react';
import { Input, Select } from '../../components/ui/Common';
import { LoadingState, ErrorState, EmptyState } from '../../components/ui/States';
import { safeFetch } from '../../lib/fetchUtils';
import { ROLE_BADGE } from '../../types';
import type { DirectoryMember } from '../../types';

interface DirectoryResponse {
  communityId: string | null;
  communities: { id: string; name: string }[];
  members: DirectoryMember[];
}

/**
 * Cohort directory. The API scopes results to the viewer's community, so this
 * only has to render what it is given — the picker is for admins, who may hold
 * more than one cohort.
 */
export function MemberDirectory() {
  const [data, setData] = useState<DirectoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [communityId, setCommunityId] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (communityId) params.set('communityId', communityId);
      if (search.trim()) params.set('q', search.trim());
      setData(await safeFetch(`/api/profiles/directory?${params}`));
    } catch (e: any) {
      setError(e.message || 'Failed to load the directory.');
    } finally {
      setLoading(false);
    }
  }, [communityId, search]);

  // Debounce so typing in the search box doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-black font-display tracking-tight text-[#0A0A0A]">Member Directory</h1>
        <p className="text-sm text-gray-500 mt-1">
          Published profiles from your community. Publish yours to appear here.
        </p>
      </div>

      <div className="flex flex-wrap gap-4 items-end">
        <Input
          label="Search"
          value={search}
          onChange={setSearch}
          placeholder="Search by name"
          wrapperClassName="flex-1 min-w-[240px]"
        />
        {(data?.communities.length ?? 0) > 1 && (
          <Select
            label="Community"
            placeholder="All communities"
            options={data!.communities.map((c) => ({ value: c.id, label: c.name }))}
            value={communityId}
            onChange={setCommunityId}
            wrapperClassName="min-w-[220px]"
          />
        )}
      </div>

      {loading ? (
        <LoadingState message="Loading directory" />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !data || data.members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No published profiles yet"
          message={
            search
              ? 'No members match that search.'
              : 'Once members in your community publish their profiles, they will show up here.'
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.members.map((member) => {
            const badge = ROLE_BADGE[member.role];
            return (
              <Link
                key={member.id}
                to={`/profile/${member.id}`}
                className="group bg-white rounded-3xl border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-6 hover:border-[#FFB273] hover:shadow-[0_20px_50px_rgba(0,0,0,0.04)] transition-all"
              >
                <div className="flex items-start gap-4">
                  {member.avatarUrl ? (
                    <img src={member.avatarUrl} alt={member.name}
                      className="w-14 h-14 rounded-2xl object-cover shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-2xl bg-[#0A0A0A] text-white flex items-center justify-center text-xl font-black uppercase shrink-0">
                      {member.name?.[0] || 'U'}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-[#0A0A0A] truncate group-hover:text-[#FF7A00] transition-colors">
                        {member.name}
                      </p>
                      {badge && (
                        <span className={`text-[9px] uppercase font-bold tracking-widest px-1.5 py-0.5 rounded border ${badge.bg} ${badge.text} ${badge.border}`}>
                          {badge.label}
                        </span>
                      )}
                    </div>

                    {member.headline && (
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">{member.headline}</p>
                    )}

                    {member.currentRole && (
                      <p className="flex items-center gap-1.5 text-xs text-gray-500 mt-2">
                        <Briefcase className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">
                          {member.currentRole.title} · {member.currentRole.company}
                        </span>
                      </p>
                    )}

                    {member.location && (
                      <p className="flex items-center gap-1.5 text-xs text-gray-400 mt-1">
                        <MapPin className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{member.location}</span>
                      </p>
                    )}

                    {member.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {member.skills.map((skill) => (
                          <span key={skill} className="px-2.5 py-1 rounded-full bg-[#F5F5F5] text-[11px] font-semibold text-gray-600">
                            {skill}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
