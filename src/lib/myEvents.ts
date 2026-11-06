// Lightweight client-side "remember my events" list — no backend/accounts involved.
// Lets an organizer get back to their admin dashboard from the same browser later.

export interface SavedEvent {
  code: string;
  adminToken: string;
  name: string;
  date: string;
  savedAt: number;
}

const STORAGE_KEY = 'mm_my_events';
const MAX_SAVED = 20;

export function getMyEvents(): SavedEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedEvent[]) : [];
  } catch {
    return [];
  }
}

export function saveMyEvent(entry: Omit<SavedEvent, 'savedAt'>): void {
  if (typeof window === 'undefined') return;
  const events = getMyEvents().filter((e) => e.code !== entry.code);
  events.unshift({ ...entry, savedAt: Date.now() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(0, MAX_SAVED)));
}

export function removeMyEvent(code: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getMyEvents().filter((e) => e.code !== code)));
}

// Same idea, but for the player side — lets a participant get back to their ticket/vote
// page from the same browser later, even after closing the tab or restarting the device.
export interface SavedPlayerEvent {
  code: string;
  ticketCode: string;
  name: string;
  date: string;
  playerName: string;
  savedAt: number;
}

const PLAYER_STORAGE_KEY = 'mm_my_player_events';

export function getMyPlayerEvents(): SavedPlayerEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PLAYER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedPlayerEvent[]) : [];
  } catch {
    return [];
  }
}

export function savePlayerEvent(entry: Omit<SavedPlayerEvent, 'savedAt'>): void {
  if (typeof window === 'undefined') return;
  const events = getMyPlayerEvents().filter((e) => e.code !== entry.code);
  events.unshift({ ...entry, savedAt: Date.now() });
  localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(events.slice(0, MAX_SAVED)));
}

export function removeMyPlayerEvent(code: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(getMyPlayerEvents().filter((e) => e.code !== code)));
}

/** The admin access this browser/app has saved for an event, if any. */
export function findMyAdminEvent(code: string): SavedEvent | null {
  return getMyEvents().find((e) => e.code === code) ?? null;
}

/** The ticket this browser/app has saved for an event, if any. */
export function findMyPlayerEvent(code: string): SavedPlayerEvent | null {
  return getMyPlayerEvents().find((e) => e.code === code) ?? null;
}

/** Pulls the event code and admin token out of a pasted admin link (a full URL or just /admin/CODE/TOKEN). */
export function parseAdminLink(input: string): { code: string; adminToken: string } | null {
  const m = input.trim().match(/\/admin\/([A-Za-z0-9]{3,12})\/([A-Za-z0-9_-]{16,64})/);
  return m ? { code: m[1], adminToken: m[2] } : null;
}
