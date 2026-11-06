import { NextRequest, NextResponse } from 'next/server';
import { clearPaymentProofs } from '@/lib/firestore';
import { verifyAdminTokenServer } from '@/lib/serverAuth';
import { deleteEventPaymentProofs } from '@/lib/cloudinaryAdmin';

// Admin-only: permanently wipes every payment-proof receipt uploaded for an event.
export async function DELETE(request: NextRequest) {
  const { code, adminToken } = await request.json();
  if (!code || !adminToken) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  const ok = await verifyAdminTokenServer(code, adminToken);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const deleted = await deleteEventPaymentProofs(code);
  await clearPaymentProofs(code);
  return NextResponse.json({ deleted });
}
