'use client';
import { useEffect, useState } from 'react';
import { readStore, writeStore } from '@/lib/pwa';
import { timeAgo } from '@/lib/timeAgo';

interface Announcement { id: string; text: string; createdAt: number }

const POLL_MS = 60_000;
const FRESH_MS = 12 * 60 * 60 * 1000; // older announcements stop showing up on their own

/** Ticket page: the organizer's latest announcement, for people who don't have notifications on (or missed the push). */
export default function AnnouncementBanner({ code }: { code: string }) {
  const [latest, setLatest] = useState<Announcement | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [now, setNow] = useState(0); // refreshed with every check, so rendering never reads the clock itself

  useEffect(() => {
    let cancelled = false;
    // Read what was dismissed before, and keep checking for new announcements
    queueMicrotask(() => { if (!cancelled) setDismissedId(readStore(`mm_ann_dismissed_${code}`)); });
    async function load() {
      try {
        const res = await fetch(`/api/announcements?code=${encodeURIComponent(code)}`);
        const json = await res.json() as { announcements?: Announcement[] };
        if (!cancelled) { setLatest(json.announcements?.[0] ?? null); setNow(Date.now()); }
      } catch { /* just try again next time */ }
    }
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [code]);

  if (!latest || latest.id === dismissedId || now - latest.createdAt > FRESH_MS) return null;

  return (
    <section className="border border-amber-600 bg-amber-950/30 rounded-2xl p-4 space-y-2 text-sm" role="status">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-amber-300">📣 Aviso del organizador</p>
        <p className="text-xs text-gray-500">{timeAgo(latest.createdAt, now)}</p>
      </div>
      <p className="text-gray-100 whitespace-pre-wrap break-words">{latest.text}</p>
      <button onClick={() => { writeStore(`mm_ann_dismissed_${code}`, latest.id); setDismissedId(latest.id); }}
        className="text-xs text-gray-400 hover:text-gray-200">
        Entendido
      </button>
    </section>
  );
}
