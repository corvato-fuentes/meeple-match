import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken } from '@/lib/firestore';
import { createBackup, listBackups, restoreBackup } from '@/lib/eventBackup';

// Admin-only: list, manually create, or restore an event's snapshots.
export async function POST(request: NextRequest) {
  const { code, adminToken, action, id } = await request.json().catch(() => ({}));
  if (!code || !adminToken || !action) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  const ok = await verifyAdminToken(code, adminToken);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    if (action === 'list') return NextResponse.json({ backups: await listBackups(code) });
    if (action === 'create') {
      await createBackup(code, 'manual', { force: true });
      return NextResponse.json({ backups: await listBackups(code) });
    }
    if (action === 'restore' && id) {
      await restoreBackup(code, String(id));
      return NextResponse.json({ restored: true, backups: await listBackups(code) });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('admin backups failed', err);
    return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
  }
}
