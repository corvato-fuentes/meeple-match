import { NextResponse } from 'next/server';
import { syncEventPush, isValidEventCode, type SyncResult } from '@/lib/pushServer';
import { rateLimited, clientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

// Per server instance: calls for the same event never overlap. One that arrives while a sync is
// running just marks it "dirty" so it runs once more afterwards — that second pass sees whatever
// changed in the meantime, and a burst of calls costs two runs at most. (Across instances the
// ledger's transactional claims already prevent double sends.)
const state = new Map<string, { running: boolean; dirty: boolean }>();

async function runSync(code: string): Promise<{ queued: boolean; result?: SyncResult }> {
  const s = state.get(code) ?? { running: false, dirty: false };
  state.set(code, s);
  if (s.running) { s.dirty = true; return { queued: true }; }
  s.running = true;
  let result: SyncResult | undefined;
  try {
    do {
      s.dirty = false;
      result = await syncEventPush(code);
    } while (s.dirty);
  } finally {
    s.running = false;
  }
  return { queued: false, result };
}

/**
 * Sends whatever push notification is due for an event (table offers, confirmations, reminders).
 * Called by the app right after something that could change what players should hear about.
 * It trusts nothing from the caller: recipients and texts are derived from the stored event state.
 * The limit is generous because a whole venue can sit behind one IP, but it stops a flood.
 */
export async function POST(request: Request) {
  if (rateLimited(`sync:${clientIp(request)}`, 300, 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  const body = await request.json().catch(() => null) as { code?: string } | null;
  if (!body || !isValidEventCode(body.code)) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    const { queued, result } = await runSync(body.code);
    return NextResponse.json({ ok: true, queued, subscribers: result?.subscribers });
  } catch (err) {
    console.error('[push] sync failed', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
