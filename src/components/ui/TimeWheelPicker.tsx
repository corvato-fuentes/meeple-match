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
export default function TimeWheelPicker({
  value, onChange, minTime, maxTime,
}: {
  value: string;
  onChange: (value: string) => void;
  minTime?: string; // "HH:MM" — restricts the wheels to this range, e.g. the event's own start/end time
  maxTime?: string;
}) {
  const [rawH, rawM] = (value || '12:00').split(':').map((x) => parseInt(x, 10) || 0);
  const [minH, minM] = (minTime ?? '00:00').split(':').map((x) => parseInt(x, 10) || 0);
  const [maxH, maxM] = (maxTime ?? '23:55').split(':').map((x) => parseInt(x, 10) || 0);

  const minuteFloor = (h: number) => (h === minH ? Math.ceil(minM / MINUTE_STEP) * MINUTE_STEP : 0);
  const minuteCeil = (h: number) => (h === maxH ? Math.floor(maxM / MINUTE_STEP) * MINUTE_STEP : 55);

  const hour = Math.min(maxH, Math.max(minH, rawH));
  const roundedMinute = Math.min(55, Math.round(rawM / MINUTE_STEP) * MINUTE_STEP);
  const minute = Math.min(minuteCeil(hour), Math.max(minuteFloor(hour), roundedMinute));

  const hourItems = Array.from({ length: maxH - minH + 1 }, (_, i) => pad2(minH + i));
  const minuteItems = Array.from(
    { length: (minuteCeil(hour) - minuteFloor(hour)) / MINUTE_STEP + 1 },
    (_, i) => pad2(minuteFloor(hour) + i * MINUTE_STEP)
  );

  function handleHourChange(i: number) {
    const newHour = minH + i;
    const newMinute = Math.min(minuteCeil(newHour), Math.max(minuteFloor(newHour), minute));
    onChange(`${pad2(newHour)}:${pad2(newMinute)}`);
  }

  function handleMinuteChange(i: number) {
    onChange(`${pad2(hour)}:${pad2(minuteFloor(hour) + i * MINUTE_STEP)}`);
  }

  return (
    <div className="flex items-center gap-1 justify-center border border-gray-700 bg-gray-900 rounded-xl py-1">
      <Wheel items={hourItems} index={hour - minH} onChange={handleHourChange} />
      <span className="text-xl font-bold text-gray-500">:</span>
      <Wheel items={minuteItems} index={(minute - minuteFloor(hour)) / MINUTE_STEP} onChange={handleMinuteChange} />
    </div>
  );
}
