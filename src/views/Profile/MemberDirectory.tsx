import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, MapPin, Briefcase } from 'lucide-react';
import { Input, Select } from '../../components/ui/Common';
import { LoadingState, ErrorState, EmptyState } from '../../components/ui/States';
import { safeFetch } from '../../lib/fetchUtils';
import type { DirectoryMember } from '../../types';
import { TitleBadges } from './helpers';

interface StaffGroup {
  key: string;
  label: string;
  description: string;
  people: DirectoryMember[];
}

interface DirectoryResponse {
  /** The intake cycle this learning community belongs to, if assigned. */
  cohort: { id: string; name: string } | null;
  communityId: string | null;
  communityName: string | null;
  communities: { id: string; name: string; cohort?: { id: string; name: string } | null }[];
  /** Students in the viewer's own learning community. */
  members: DirectoryMember[];
  /** Students in the cohort's other learning community. */
  peers: DirectoryMember[];
  /** Cohort staff, grouped by operating function. */
  staff: StaffGroup[];
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
          {data?.cohort
            ? `${data.cohort.name}${data.communityName ? ` · ${data.communityName}` : ''} — published profiles across your cohort.`
            : 'Published profiles from your learning community. Publish yours to appear here.'}
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
            label="Learning community"
            placeholder="All learning communities"
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
      ) : !data || (data.members.length === 0 && data.peers.length === 0 && data.staff.length === 0) ? (
        <EmptyState
          icon={Users}
          title="No published profiles yet"
          message={
            search
              ? 'Nobody matches that search.'
              : 'Once people in your learning community publish their profiles, they will show up here.'
          }
        />
      ) : (
        <div className="space-y-10">
          <Group
            title={data.communityName || 'My learning community'}
            subtitle="Students in your learning community"
            people={data.members}
            emptyMessage={search ? 'No members match that search.' : 'No members have published a profile yet.'}
          />

          {/* A cohort runs two learning communities; the sibling only appears
              once this one has been assigned to a cohort. */}
          {data.peers.length > 0 && (
            <Group
              title="Across the cohort"
              subtitle="Students in the cohort's other learning community"
              people={data.peers}
              emptyMessage=""
            />
          )}

          {data.staff.map((group) => (
            <Group
              key={group.key}
              title={group.label}
              subtitle={group.description}
              people={group.people}
              emptyMessage=""
            />
          ))}
        </div>
      )}
    </div>
  );
}

// `key` is declared explicitly because this project has no @types/react, so TS
// does not special-case it as a reserved JSX attribute.
function Group({
  title,
  subtitle,
  people,
  emptyMessage,
}: {
  title: string;
  subtitle: string;
  people: DirectoryMember[];
  emptyMessage: string;
  key?: string;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="text-lg font-bold text-[#0A0A0A]">{title}</h2>
        <span className="text-xs font-bold text-gray-400 tabular-nums">{people.length}</span>
      </div>
      <p className="text-sm text-gray-500 -mt-3 mb-5">{subtitle}</p>

      {people.length === 0 ? (
        emptyMessage ? <p className="text-sm text-gray-400 py-2">{emptyMessage}</p> : null
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {people.map((person) => <MemberCard key={person.id} member={person} />)}
        </div>
      )}
    </section>
  );
}

// `key` is declared explicitly because this project has no @types/react, so TS
// does not special-case it as a reserved JSX attribute.
function MemberCard({ member }: { member: DirectoryMember; key?: string }) {
  return (
    <Link
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
            <TitleBadges titles={member.titles} />
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
}
