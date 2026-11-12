'use client';

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const MINUTE_STEP = 5;

/**
 * A time of day in 24 hours ("13:15"), as two lists: hour and minute. The browser's own time field follows the phone's or
 * computer's language and shows "1:15 PM", which is easy to mistake for 01:15 when setting a table's hours.
 * `value` and `onChange` use "HH:MM". A minute that isn't a multiple of 5 stays selectable while the value holds it.
 */
export default function Time24Input({ value, onChange, className = '', label }: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** For screen readers: what time this is ("Hora de inicio"). */
  label?: string;
}) {
  const [h = '00', m = '00'] = value.split(':');
  const minutes = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => String(i * MINUTE_STEP).padStart(2, '0'));
  if (!minutes.includes(m)) minutes.push(m);
  minutes.sort();
  const select = 'border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 text-sm';
  return (
    <span className={'inline-flex items-center gap-1 ' + className}>
      <select aria-label={label ? `${label}: hora` : 'Hora'} value={h} onChange={(e) => onChange(`${e.target.value}:${m}`)} className={select}>
        {HOURS.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <span className="text-gray-500">:</span>
      <select aria-label={label ? `${label}: minutos` : 'Minutos'} value={m} onChange={(e) => onChange(`${h}:${e.target.value}`)} className={select}>
        {minutes.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    </span>
  );
}
