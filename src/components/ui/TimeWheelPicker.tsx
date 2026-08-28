'use client';
import { useEffect, useRef } from 'react';

const ITEM_HEIGHT = 36;
const VISIBLE = 5;
const PAD = Math.floor(VISIBLE / 2);
const MINUTE_STEP = 5;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function Wheel({ items, index, onChange }: { items: string[]; index: number; onChange: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastIndexRef = useRef(index);

  // Keeps the wheel in sync when the value changes from outside (not from the user scrolling it)
  useEffect(() => {
    const el = ref.current;
    if (!el || lastIndexRef.current === index) return;
    el.scrollTo({ top: index * ITEM_HEIGHT, behavior: 'auto' });
    lastIndexRef.current = index;
  }, [index]);

  function handleScroll() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ITEM_HEIGHT)));
      el.scrollTo({ top: i * ITEM_HEIGHT, behavior: 'smooth' });
      if (i !== lastIndexRef.current) {
        lastIndexRef.current = i;
        onChange(i);
      }
    }, 100);
  }

  function selectIndex(i: number) {
    lastIndexRef.current = i;
    ref.current?.scrollTo({ top: i * ITEM_HEIGHT, behavior: 'smooth' });
    onChange(i);
  }

  return (
    <div className="relative w-14">
      <div
        ref={ref}
        onScroll={handleScroll}
        className="h-45 overflow-y-auto snap-y snap-mandatory scrollbar-none [&::-webkit-scrollbar]:hidden"
      >
        <div style={{ height: PAD * ITEM_HEIGHT }} />
        {items.map((v, i) => (
          <div
            key={v}
            onClick={() => selectIndex(i)}
            className={
              'snap-center flex items-center justify-center font-mono cursor-pointer select-none transition-colors ' +
              (i === index ? 'text-xl font-bold text-white' : 'text-sm text-gray-500')
            }
            style={{ height: ITEM_HEIGHT }}
          >
            {v}
          </div>
        ))}
        <div style={{ height: PAD * ITEM_HEIGHT }} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-9 border-y border-indigo-500" />
    </div>
  );
}

/** 24h scrollable hour/minute wheel picker (5-min steps), styled like a native mobile time picker */
export default function TimeWheelPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [rawH, rawM] = (value || '12:00').split(':').map((x) => parseInt(x, 10) || 0);
  const hour = Math.min(23, Math.max(0, rawH));
  const minute = Math.min(55, Math.round(rawM / MINUTE_STEP) * MINUTE_STEP);

  const hourItems = Array.from({ length: 24 }, (_, i) => pad2(i));
  const minuteItems = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => pad2(i * MINUTE_STEP));

  return (
    <div className="flex items-center gap-1 justify-center border border-gray-700 bg-gray-900 rounded-xl py-1">
      <Wheel items={hourItems} index={hour} onChange={(i) => onChange(`${pad2(i)}:${pad2(minute)}`)} />
      <span className="text-xl font-bold text-gray-500">:</span>
      <Wheel items={minuteItems} index={minute / MINUTE_STEP} onChange={(i) => onChange(`${pad2(hour)}:${pad2(i * MINUTE_STEP)}`)} />
    </div>
  );
}
