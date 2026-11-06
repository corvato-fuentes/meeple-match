'use client';

interface Props {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  /** Classes for the chip while selected (background / border / text). */
  activeClass: string;
  /** When set, the count turns into this filled pill while the chip is idle and the count is > 0 —
   *  used to flag the filter that holds something waiting on the player. */
  highlightClass?: string;
}

/** Filter "tag" with a live count — used to switch between the states of a single list. */
export default function FilterChip({ active, onClick, label, count, activeClass, highlightClass }: Props) {
  const pill = highlightClass && count > 0 && !active
    ? highlightClass
    : active ? 'bg-black/25' : 'bg-gray-800 text-gray-300';
  return (
    <button onClick={onClick} aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active ? activeClass : 'border-gray-700 text-gray-400 hover:bg-gray-800'}`}>
      {label}
      <span className={`rounded-full px-1.5 text-[10px] leading-4 font-bold ${pill}`}>{count}</span>
    </button>
  );
}
