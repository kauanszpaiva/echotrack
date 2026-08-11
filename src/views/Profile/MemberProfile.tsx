import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Pencil, Plus, Trash2, Download, Briefcase, GraduationCap, Award,
  MapPin, Link2, Linkedin, Eye, EyeOff, X,
} from 'lucide-react';
import { Button, Input, Select } from '../../components/ui/Common';
import { LoadingState, ErrorState } from '../../components/ui/States';
import { safeFetch, downloadFile } from '../../lib/fetchUtils';
import { useAuth } from '../../hooks/useAuth';
import { ROLE_BADGE, EMPLOYMENT_TYPE_OPTIONS, LOCATION_TYPE_OPTIONS } from '../../types';
import type { MemberProfile as Profile, ProfileMember } from '../../types';
import { Modal, SectionCard, Textarea, dateRange, duration, joinParts, monthYear, toMonthInput } from './helpers';

type ModalKind = 'intro' | 'experience' | 'education' | 'certification' | 'skills' | null;

interface ProfileResponse {
  profile: Profile;
  member: ProfileMember;
  isOwner: boolean;
}

export function MemberProfile() {
  const { userId } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<ModalKind>(null);
  const [editing, setEditing] = useState<any>(null);

  const endpoint = userId && userId !== user?.id ? `/api/profiles/${userId}` : '/api/profiles/me';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await safeFetch(endpoint));
    } catch (e: any) {
      setError(e.message || 'Failed to load this profile.');
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => { load(); }, [load]);

  const closeModal = useCallback(() => { setModal(null); setEditing(null); }, []);

  const afterSave = async (message: string) => {
    closeModal();
    toast.success(message);
    await load();
  };

  const openEditor = (kind: ModalKind, entry: any = null) => { setEditing(entry); setModal(kind); };

  const remove = async (path: string, label: string) => {
    if (!window.confirm(`Remove this ${label}? This cannot be undone.`)) return;
    try {
      await safeFetch(path, { method: 'DELETE' });
      toast.success(`${label[0].toUpperCase()}${label.slice(1)} removed`);
      await load();
    } catch (e: any) {
      toast.error(e.message || `Failed to remove this ${label}`);
    }
  };

  const togglePublished = async () => {
    if (!data) return;
    const next = !data.profile.isPublished;
    try {
      await safeFetch('/api/profiles/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublished: next }),
      });
      toast.success(next ? 'Profile published to your cohort' : 'Profile hidden from the directory');
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to update visibility');
    }
  };

  const downloadResume = async () => {
    if (!data) return;
    try {
      await downloadFile(
        `/api/profiles/${data.member.id}/resume-pdf`,
        `${data.member.name.replace(/[^a-z0-9]+/gi, '_')}_Resume.pdf`,
      );
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate the resume');
    }
  };

  if (loading) return <LoadingState message="Loading profile" />;
  if (error || !data) return <ErrorState message={error || 'Profile unavailable.'} onRetry={load} />;

  const { profile, member, isOwner } = data;
  const badge = ROLE_BADGE[member.role];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {isOwner && !profile.isPublished && (
        <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-2xl bg-[#FFF4EB] border border-orange-100">
          <div className="flex items-start gap-3">
            <EyeOff className="w-5 h-5 text-[#FF7A00] mt-0.5 shrink-0" />
            <div>
              <p className="font-bold text-sm text-[#0A0A0A]">This profile is a draft</p>
              <p className="text-sm text-gray-600 mt-0.5">
                Only you and admins can see it. Publish it to appear in your cohort directory.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={togglePublished}>Publish profile</Button>
        </div>
      )}

      {/* ── Header ── */}
      <section className="bg-white rounded-3xl border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden">
        <div className="h-28 bg-gradient-to-r from-[#FF7A00] to-[#FFB273]" />
        <div className="px-8 pb-8">
          <div className="flex flex-wrap items-end justify-between gap-4 -mt-12">
            {member.avatarUrl ? (
              <img
                src={member.avatarUrl}
                alt={member.name}
                className="w-24 h-24 rounded-2xl object-cover border-4 border-white shadow-md bg-white"
              />
            ) : (
              <div className="w-24 h-24 rounded-2xl bg-[#0A0A0A] text-white border-4 border-white shadow-md flex items-center justify-center text-3xl font-black uppercase">
                {member.name?.[0] || 'U'}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 mb-1">
              <Button variant="outline" size="sm" onClick={downloadResume}>
                <Download className="w-4 h-4" /> Resume PDF
              </Button>
              {isOwner && (
                <>
                  <Button variant="outline" size="sm" onClick={togglePublished}>
                    {profile.isPublished ? <><EyeOff className="w-4 h-4" /> Unpublish</> : <><Eye className="w-4 h-4" /> Publish</>}
                  </Button>
                  <Button size="sm" onClick={() => openEditor('intro')}>
                    <Pencil className="w-4 h-4" /> Edit intro
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-black font-display tracking-tight text-[#0A0A0A]">{member.name}</h1>
              {badge && (
                <span className={`text-[9px] uppercase font-bold tracking-widest px-2 py-1 rounded border ${badge.bg} ${badge.text} ${badge.border}`}>
                  {badge.label}
                </span>
              )}
            </div>

            {profile.headline && <p className="text-lg text-gray-700 mt-2 font-medium">{profile.headline}</p>}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-sm text-gray-500">
              {profile.location && (
                <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" />{profile.location}</span>
              )}
              {(member.community || member.pathway) && (
                <span className="font-medium text-gray-600">
                  {joinParts(member.community?.name, member.pathway?.name)}
                </span>
              )}
            </div>

            {(profile.linkedinUrl || profile.websiteUrl) && (
              <div className="flex flex-wrap items-center gap-4 mt-4">
                {profile.linkedinUrl && (
                  <a href={profile.linkedinUrl} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 text-sm font-semibold text-[#FF7A00] hover:underline">
                    <Linkedin className="w-4 h-4" /> LinkedIn
                  </a>
                )}
                {profile.websiteUrl && (
                  <a href={profile.websiteUrl} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 text-sm font-semibold text-[#FF7A00] hover:underline">
                    <Link2 className="w-4 h-4" /> Website
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── About ── */}
      {(profile.about || isOwner) && (
        <SectionCard
          title="About"
          action={isOwner && (
            <Button variant="ghost" size="sm" onClick={() => openEditor('intro')}>
              <Pencil className="w-4 h-4" />
            </Button>
          )}
        >
          {profile.about
            ? <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{profile.about}</p>
            : <p className="text-sm text-gray-400">Add a short summary of who you are and what you're working toward.</p>}
        </SectionCard>
      )}

      {/* ── Experience ── */}
      <SectionCard
        title="Experience"
        action={isOwner && (
          <Button variant="outline" size="sm" onClick={() => openEditor('experience')}>
            <Plus className="w-4 h-4" /> Add
          </Button>
        )}
      >
        {profile.workExperiences.length === 0 ? (
          <EmptyBlock icon={Briefcase} message={isOwner ? 'Add your first position to start building your profile.' : 'No experience listed yet.'} />
        ) : (
          <ul className="space-y-6">
            {profile.workExperiences.map((entry) => (
              <li key={entry.id} className="flex gap-4">
                <div className="w-11 h-11 rounded-xl bg-[#FFF4EB] text-[#FF7A00] flex items-center justify-center shrink-0">
                  <Briefcase className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-[#0A0A0A]">{entry.title}</p>
                      <p className="text-sm text-gray-600">
                        {joinParts(
                          entry.company,
                          EMPLOYMENT_TYPE_OPTIONS.find((o) => o.value === entry.employmentType)?.label,
                        )}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {joinParts(
                          dateRange(entry.startDate, entry.endDate, entry.isCurrent),
                          duration(entry.startDate, entry.endDate, entry.isCurrent),
                        )}
                      </p>
                      {(entry.location || entry.locationType) && (
                        <p className="text-xs text-gray-400">
                          {joinParts(
                            entry.location,
                            LOCATION_TYPE_OPTIONS.find((o) => o.value === entry.locationType)?.label,
                          )}
                        </p>
                      )}
                    </div>
                    {isOwner && (
                      <RowActions
                        onEdit={() => openEditor('experience', entry)}
                        onDelete={() => remove(`/api/profiles/me/experience/${entry.id}`, 'position')}
                      />
                    )}
                  </div>
                  {entry.description && (
                    <p className="text-sm text-gray-700 leading-relaxed mt-3 whitespace-pre-wrap">{entry.description}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* ── Education ── */}
      <SectionCard
        title="Education"
        action={isOwner && (
          <Button variant="outline" size="sm" onClick={() => openEditor('education')}>
            <Plus className="w-4 h-4" /> Add
          </Button>
        )}
      >
        {profile.education.length === 0 ? (
          <EmptyBlock icon={GraduationCap} message={isOwner ? 'Add your schools, bootcamps, or training programs.' : 'No education listed yet.'} />
        ) : (
          <ul className="space-y-6">
            {profile.education.map((entry) => (
              <li key={entry.id} className="flex gap-4">
                <div className="w-11 h-11 rounded-xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center shrink-0">
                  <GraduationCap className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-[#0A0A0A]">{entry.school}</p>
                      {(entry.degree || entry.fieldOfStudy) && (
                        <p className="text-sm text-gray-600">{joinParts(entry.degree, entry.fieldOfStudy)}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {dateRange(entry.startDate, entry.endDate, entry.isCurrent)}
                      </p>
                    </div>
                    {isOwner && (
                      <RowActions
                        onEdit={() => openEditor('education', entry)}
                        onDelete={() => remove(`/api/profiles/me/education/${entry.id}`, 'education entry')}
                      />
                    )}
                  </div>
                  {entry.description && (
                    <p className="text-sm text-gray-700 leading-relaxed mt-3 whitespace-pre-wrap">{entry.description}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* ── Certifications ── */}
      <SectionCard
        title="Licenses & certifications"
        action={isOwner && (
          <Button variant="outline" size="sm" onClick={() => openEditor('certification')}>
            <Plus className="w-4 h-4" /> Add
          </Button>
        )}
      >
        {profile.certifications.length === 0 ? (
          <EmptyBlock icon={Award} message={isOwner ? 'Add credentials you have earned.' : 'No certifications listed yet.'} />
        ) : (
          <ul className="space-y-6">
            {profile.certifications.map((entry) => (
              <li key={entry.id} className="flex gap-4">
                <div className="w-11 h-11 rounded-xl bg-[#F0FDF4] text-[#16A34A] flex items-center justify-center shrink-0">
                  <Award className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-[#0A0A0A]">{entry.name}</p>
                      {entry.issuer && <p className="text-sm text-gray-600">{entry.issuer}</p>}
                      <p className="text-xs text-gray-400 mt-1">
                        {joinParts(
                          entry.issueDate ? `Issued ${monthYear(entry.issueDate)}` : null,
                          entry.expiryDate ? `Expires ${monthYear(entry.expiryDate)}` : null,
                          entry.credentialId ? `ID ${entry.credentialId}` : null,
                        )}
                      </p>
                      {entry.credentialUrl && (
                        <a href={entry.credentialUrl} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#FF7A00] hover:underline mt-2">
                          <Link2 className="w-3.5 h-3.5" /> Show credential
                        </a>
                      )}
                    </div>
                    {isOwner && (
                      <RowActions
                        onEdit={() => openEditor('certification', entry)}
                        onDelete={() => remove(`/api/profiles/me/certifications/${entry.id}`, 'certification')}
                      />
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* ── Skills ── */}
      <SectionCard
        title="Skills"
        action={isOwner && (
          <Button variant="outline" size="sm" onClick={() => openEditor('skills')}>
            <Pencil className="w-4 h-4" /> Edit
          </Button>
        )}
      >
        {profile.skills.length === 0 ? (
          <p className="text-sm text-gray-400">
            {isOwner ? 'Add the skills you want your cohort and coaches to see.' : 'No skills listed yet.'}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {profile.skills.map((skill) => (
              <span key={skill.id} className="px-3.5 py-1.5 rounded-full bg-[#F5F5F5] text-sm font-semibold text-gray-700">
                {skill.name}
              </span>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Editors ── */}
      <Modal open={modal === 'intro'} title="Edit intro" onClose={closeModal}>
        <IntroForm profile={profile} onCancel={closeModal} onSaved={() => afterSave('Profile updated')} />
      </Modal>
      <Modal open={modal === 'experience'} title={editing ? 'Edit position' : 'Add position'} onClose={closeModal}>
        <ExperienceForm entry={editing} onCancel={closeModal} onSaved={() => afterSave('Position saved')} />
      </Modal>
      <Modal open={modal === 'education'} title={editing ? 'Edit education' : 'Add education'} onClose={closeModal}>
        <EducationForm entry={editing} onCancel={closeModal} onSaved={() => afterSave('Education saved')} />
      </Modal>
      <Modal open={modal === 'certification'} title={editing ? 'Edit certification' : 'Add certification'} onClose={closeModal}>
        <CertificationForm entry={editing} onCancel={closeModal} onSaved={() => afterSave('Certification saved')} />
      </Modal>
      <Modal open={modal === 'skills'} title="Edit skills" onClose={closeModal}>
        <SkillsForm skills={profile.skills.map((s) => s.name)} onCancel={closeModal} onSaved={() => afterSave('Skills saved')} />
      </Modal>
    </div>
  );
}

/* ──────────────────────────── small building blocks ──────────────────────────── */

const EmptyBlock = ({ icon: Icon, message }: { icon: any; message: string }) => (
  <div className="flex items-center gap-3 text-sm text-gray-400 py-2">
    <Icon className="w-5 h-5 shrink-0" />
    <span>{message}</span>
  </div>
);

const RowActions = ({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) => (
  <div className="flex items-center gap-1 shrink-0">
    <button type="button" onClick={onEdit} aria-label="Edit"
      className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-50 hover:text-gray-900 transition-colors">
      <Pencil className="w-4 h-4" />
    </button>
    <button type="button" onClick={onDelete} aria-label="Delete"
      className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors">
      <Trash2 className="w-4 h-4" />
    </button>
  </div>
);

const FormActions = ({ loading, onCancel }: { loading: boolean; onCancel: () => void }) => (
  <div className="flex justify-end gap-3 pt-2">
    <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>Cancel</Button>
    <Button type="submit" disabled={loading}>{loading ? 'Saving…' : 'Save'}</Button>
  </div>
);

/** Wraps the submit/error handling every profile form repeats. */
function useSubmit(onSaved: () => void) {
  const [loading, setLoading] = useState(false);

  const submit = async (path: string, method: string, body: any) => {
    setLoading(true);
    try {
      await safeFetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
    } finally {
      setLoading(false);
    }
  };

  return { loading, submit };
}

/* ────────────────────────────────── forms ────────────────────────────────── */

function IntroForm({ profile, onCancel, onSaved }: { profile: Profile; onCancel: () => void; onSaved: () => void }) {
  const { loading, submit } = useSubmit(onSaved);
  const [form, setForm] = useState({
    headline: profile.headline ?? '',
    about: profile.about ?? '',
    location: profile.location ?? '',
    linkedinUrl: profile.linkedinUrl ?? '',
    websiteUrl: profile.websiteUrl ?? '',
  });
  const set = (key: string) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => { e.preventDefault(); submit('/api/profiles/me', 'PATCH', form); }}
    >
      <Input label="Headline" value={form.headline} onChange={set('headline')} maxLength={160}
        placeholder="Aspiring software engineer · EchoTrack cohort" />
      <Textarea label="About" value={form.about} onChange={set('about')} rows={6} maxLength={4000}
        hint="A short summary of your background, strengths, and what you're working toward." />
      <Input label="Location" value={form.location} onChange={set('location')} maxLength={160}
        placeholder="Boston, MA" />
      <div className="grid sm:grid-cols-2 gap-4">
        <Input label="LinkedIn URL" value={form.linkedinUrl} onChange={set('linkedinUrl')}
          placeholder="linkedin.com/in/you" />
        <Input label="Website" value={form.websiteUrl} onChange={set('websiteUrl')}
          placeholder="yoursite.com" />
      </div>
      <FormActions loading={loading} onCancel={onCancel} />
    </form>
  );
}

function ExperienceForm({ entry, onCancel, onSaved }: { entry: any; onCancel: () => void; onSaved: () => void }) {
  const { loading, submit } = useSubmit(onSaved);
  const [form, setForm] = useState({
    title: entry?.title ?? '',
    company: entry?.company ?? '',
    employmentType: entry?.employmentType ?? '',
    location: entry?.location ?? '',
    locationType: entry?.locationType ?? '',
    startDate: toMonthInput(entry?.startDate),
    endDate: toMonthInput(entry?.endDate),
    isCurrent: entry?.isCurrent ?? false,
    description: entry?.description ?? '',
  });
  const set = (key: string) => (value: any) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit(
          entry ? `/api/profiles/me/experience/${entry.id}` : '/api/profiles/me/experience',
          entry ? 'PATCH' : 'POST',
          { ...form, endDate: form.isCurrent ? null : form.endDate },
        );
      }}
    >
      <Input label="Title" value={form.title} onChange={set('title')} required maxLength={160}
        placeholder="Operations Assistant" />
      <Input label="Company" value={form.company} onChange={set('company')} required maxLength={160}
        placeholder="KSP Dominion Group" />
      <div className="grid sm:grid-cols-2 gap-4">
        <Select label="Employment type" placeholder="Select type" options={EMPLOYMENT_TYPE_OPTIONS}
          value={form.employmentType} onChange={set('employmentType')} />
        <Select label="Location type" placeholder="Select type" options={LOCATION_TYPE_OPTIONS}
          value={form.locationType} onChange={set('locationType')} />
      </div>
      <Input label="Location" value={form.location} onChange={set('location')} maxLength={160}
        placeholder="Boston, MA" />
      <div className="grid sm:grid-cols-2 gap-4">
        <Input label="Start" type="month" value={form.startDate} onChange={set('startDate')} required />
        <Input label="End" type="month" value={form.endDate} onChange={set('endDate')} disabled={form.isCurrent} />
      </div>
      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <input type="checkbox" checked={form.isCurrent}
          onChange={(e) => setForm((f) => ({ ...f, isCurrent: e.target.checked, endDate: e.target.checked ? '' : f.endDate }))}
          className="w-4 h-4 rounded text-[#FF7A00] focus:ring-[#FF7A00] border-gray-300" />
        <span className="text-sm font-semibold text-gray-600">I currently work here</span>
      </label>
      <Textarea label="Description" value={form.description} onChange={set('description')} rows={5} maxLength={4000}
        hint="What you did, what you owned, and anything measurable you achieved." />
      <FormActions loading={loading} onCancel={onCancel} />
    </form>
  );
}

function EducationForm({ entry, onCancel, onSaved }: { entry: any; onCancel: () => void; onSaved: () => void }) {
  const { loading, submit } = useSubmit(onSaved);
  const [form, setForm] = useState({
    school: entry?.school ?? '',
    degree: entry?.degree ?? '',
    fieldOfStudy: entry?.fieldOfStudy ?? '',
    startDate: toMonthInput(entry?.startDate),
    endDate: toMonthInput(entry?.endDate),
    isCurrent: entry?.isCurrent ?? false,
    description: entry?.description ?? '',
  });
  const set = (key: string) => (value: any) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit(
          entry ? `/api/profiles/me/education/${entry.id}` : '/api/profiles/me/education',
          entry ? 'PATCH' : 'POST',
          { ...form, endDate: form.isCurrent ? null : form.endDate },
        );
      }}
    >
      <Input label="School or program" value={form.school} onChange={set('school')} required maxLength={160} />
      <div className="grid sm:grid-cols-2 gap-4">
        <Input label="Degree" value={form.degree} onChange={set('degree')} maxLength={160}
          placeholder="Certificate, BSc, …" />
        <Input label="Field of study" value={form.fieldOfStudy} onChange={set('fieldOfStudy')} maxLength={160} />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Input label="Start" type="month" value={form.startDate} onChange={set('startDate')} />
        <Input label="End" type="month" value={form.endDate} onChange={set('endDate')} disabled={form.isCurrent} />
      </div>
      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <input type="checkbox" checked={form.isCurrent}
          onChange={(e) => setForm((f) => ({ ...f, isCurrent: e.target.checked, endDate: e.target.checked ? '' : f.endDate }))}
          className="w-4 h-4 rounded text-[#FF7A00] focus:ring-[#FF7A00] border-gray-300" />
        <span className="text-sm font-semibold text-gray-600">I'm currently studying here</span>
      </label>
      <Textarea label="Description" value={form.description} onChange={set('description')} rows={4} maxLength={4000} />
      <FormActions loading={loading} onCancel={onCancel} />
    </form>
  );
}

function CertificationForm({ entry, onCancel, onSaved }: { entry: any; onCancel: () => void; onSaved: () => void }) {
  const { loading, submit } = useSubmit(onSaved);
  const [form, setForm] = useState({
    name: entry?.name ?? '',
    issuer: entry?.issuer ?? '',
    issueDate: toMonthInput(entry?.issueDate),
    expiryDate: toMonthInput(entry?.expiryDate),
    credentialId: entry?.credentialId ?? '',
    credentialUrl: entry?.credentialUrl ?? '',
  });
  const set = (key: string) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit(
          entry ? `/api/profiles/me/certifications/${entry.id}` : '/api/profiles/me/certifications',
          entry ? 'PATCH' : 'POST',
          form,
        );
      }}
    >
      <Input label="Name" value={form.name} onChange={set('name')} required maxLength={200}
        placeholder="OSHA 10-Hour General Industry" />
      <Input label="Issuing organization" value={form.issuer} onChange={set('issuer')} maxLength={160} />
      <div className="grid sm:grid-cols-2 gap-4">
        <Input label="Issued" type="month" value={form.issueDate} onChange={set('issueDate')} />
        <Input label="Expires" type="month" value={form.expiryDate} onChange={set('expiryDate')} />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Input label="Credential ID" value={form.credentialId} onChange={set('credentialId')} maxLength={160} />
        <Input label="Credential URL" value={form.credentialUrl} onChange={set('credentialUrl')} />
      </div>
      <FormActions loading={loading} onCancel={onCancel} />
    </form>
  );
}

function SkillsForm({ skills, onCancel, onSaved }: { skills: string[]; onCancel: () => void; onSaved: () => void }) {
  const { loading, submit } = useSubmit(onSaved);
  const [list, setList] = useState<string[]>(skills);
  const [draft, setDraft] = useState('');

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    if (list.length >= 50) return toast.error('A profile can list at most 50 skills');
    if (list.some((s) => s.toLowerCase() === name.toLowerCase())) {
      setDraft('');
      return toast.error(`"${name}" is already on your list`);
    }
    setList((current) => [...current, name]);
    setDraft('');
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => { e.preventDefault(); submit('/api/profiles/me/skills', 'PUT', { skills: list }); }}
    >
      <div className="flex gap-3 items-end">
        <Input
          label="Add a skill"
          value={draft}
          onChange={setDraft}
          wrapperClassName="flex-1"
          maxLength={60}
          placeholder="Customer service"
          // Enter adds a skill rather than submitting the whole form.
          onKeyDown={(e: any) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <Button type="button" variant="outline" onClick={add} className="h-[58px]">
          <Plus className="w-4 h-4" /> Add
        </Button>
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-gray-400">No skills yet. Add a few that describe your strengths.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {list.map((name) => (
            <span key={name} className="flex items-center gap-2 pl-3.5 pr-2 py-1.5 rounded-full bg-[#F5F5F5] text-sm font-semibold text-gray-700">
              {name}
              <button type="button" aria-label={`Remove ${name}`}
                onClick={() => setList((current) => current.filter((s) => s !== name))}
                className="w-5 h-5 rounded-full flex items-center justify-center text-gray-400 hover:bg-white hover:text-red-600 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <FormActions loading={loading} onCancel={onCancel} />
    </form>
  );
}
