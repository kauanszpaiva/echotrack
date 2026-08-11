import { useEffect } from 'react';
import { X } from 'lucide-react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mar 2025". Dates are stored at midnight UTC, so read them in UTC too. */
export function monthYear(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function dateRange(start?: string | null, end?: string | null, isCurrent?: boolean): string {
  const from = monthYear(start);
  const to = isCurrent ? 'Present' : monthYear(end);
  if (!from && !to) return '';
  if (!from) return to;
  return to ? `${from} — ${to}` : from;
}

/** Total span of a position, the way LinkedIn shows it: "1 yr 4 mos". */
export function duration(start?: string | null, end?: string | null, isCurrent?: boolean): string {
  if (!start) return '';
  const from = new Date(start);
  const to = isCurrent || !end ? new Date() : new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return '';

  const months = Math.max(
    0,
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) + 1,
  );
  const years = Math.floor(months / 12);
  const remainder = months % 12;

  const parts: string[] = [];
  if (years) parts.push(`${years} yr${years > 1 ? 's' : ''}`);
  if (remainder) parts.push(`${remainder} mo${remainder > 1 ? 's' : ''}`);
  return parts.join(' ');
}

/** ISO timestamp → the "YYYY-MM" value an <input type="month"> expects. */
export function toMonthInput(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const joinParts = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');

export const Textarea = ({ label, value, onChange, rows = 4, hint, ...props }: any) => (
  <div className="flex flex-col">
    {label && (
      <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-2 ml-1">
        {label}
        {props.required && <span className="text-[#FF7A00] ml-1">*</span>}
      </label>
    )}
    <textarea
      value={value ?? ''}
      rows={rows}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-6 py-4 rounded-2xl border border-gray-100 focus:border-[#FFB273] focus:ring-4 focus:ring-orange-50/50 outline-none transition-all placeholder:text-gray-200 text-gray-900 font-medium resize-y"
      {...props}
    />
    {hint && <p className="text-xs text-gray-400 mt-2 ml-1">{hint}</p>}
  </div>
);

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: any;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // Stop the page behind the dialog from scrolling while it is open.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100 sticky top-0 bg-white rounded-t-3xl">
          <h3 className="text-lg font-bold text-[#0A0A0A]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-50 hover:text-gray-900 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-8 py-6">{children}</div>
      </div>
    </div>
  );
}

/** A titled profile block with an optional action in the top-right corner. */
export function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: any;
  children: any;
}) {
  return (
    <section className="bg-white rounded-3xl border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-[#0A0A0A]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
