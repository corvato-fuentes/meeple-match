import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { deleteEventPaymentProofs } from '@/lib/cloudinaryAdmin';

const EXPIRY_DAYS = 7;

// Triggered daily by Vercel Cron (see vercel.json). Deletes events whose date is more than
// EXPIRY_DAYS in the past, along with their subcollections and Cloudinary payment-proof images.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - EXPIRY_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10); // "YYYY-MM-DD", matches MeepleEvent.date format

  const eventsSnap = await adminDb.collection('events').get();
  const expired = eventsSnap.docs.filter((d) => (d.data().date as string) <= cutoffStr);

  for (const eventDoc of expired) {
    await deleteEventPaymentProofs(eventDoc.id).catch(() => {});
    await adminDb.recursiveDelete(eventDoc.ref);
  }

  return NextResponse.json({ deletedEvents: expired.map((d) => d.id) });
}
