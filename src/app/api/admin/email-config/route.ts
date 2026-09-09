import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken } from '@/lib/firestore';
import { getEmailConfig, setEmailConfig } from '@/lib/emailConfigAdmin';

// Admin-only. GET returns whether email is configured + the sender address (never the password).
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const adminToken = request.nextUrl.searchParams.get('adminToken');
  if (!code || !adminToken) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  const ok = await verifyAdminToken(code, adminToken);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const config = await getEmailConfig(code);
  return NextResponse.json({ configured: !!config, gmailUser: config?.gmailUser ?? null });
}

export async function POST(request: NextRequest) {
  const { code, adminToken, gmailUser, gmailAppPassword } = await request.json();
  if (!code || !adminToken || !gmailUser || !gmailAppPassword) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 });
  }

  const ok = await verifyAdminToken(code, adminToken);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await setEmailConfig(code, { gmailUser, gmailAppPassword });
  return NextResponse.json({ saved: true });
}
