import { NextRequest, NextResponse } from 'next/server';
import { AUTO_REASONS, createBackup, type BackupReason } from '@/lib/eventBackup';

// Called by the app right before a destructive step (also from player flows, which have no admin
// token), so it only ever CREATES snapshots — rate-limited by createBackup's cooldown and capped
// by its retention. Reading or restoring needs the admin token (see /api/admin/backups).
export async function POST(request: NextRequest) {
  const { code, reason } = await request.json().catch(() => ({}));
  if (!code || !AUTO_REASONS.includes(reason as BackupReason)) {
    return NextResponse.json({ error: 'Missing or invalid params' }, { status: 400 });
  }
  try {
    const meta = await createBackup(code, reason as BackupReason);
    return NextResponse.json({ created: !!meta });
  } catch (err) {
    console.error('backup failed', err);
    return NextResponse.json({ error: 'Backup failed' }, { status: 500 });
  }
}
