import { cache, Suspense } from 'react';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { getSharedTable } from '@/lib/shareTableServer';
import { dayLabel, shareHeadline } from '@/lib/shareTable';
import SharedTableView from '@/components/ui/SharedTableView';

type Props = { params: Promise<{ code: string; tableId: string }> };

// One read for the link preview and for the page itself
const loadTable = cache((code: string, tableId: string) => getSharedTable(code, tableId).catch(() => null));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code, tableId } = await params;
  // Links in the metadata (the picture above all) are written on the same host the link was opened on: the one chat apps
  // can reach. Left to Next, it may pick a deployment address that asks for a Vercel login.
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const metadataBase = host ? new URL((h.get('x-forwarded-proto') ?? 'https') + '://' + host) : undefined;
  const t = await loadTable(code, tableId);
  if (!t || !t.open) return { title: 'Mesa · Meeple Loop', metadataBase };
  const title = shareHeadline(t);
  const description = [t.eventName, dayLabel(t.date), `${t.startTime}–${t.endTime}`, t.location].filter(Boolean).join(' · ');
  // The link's picture comes from opengraph-image.tsx next to this file
  return { metadataBase, title, description, openGraph: { title, description } };
}

export default async function SharedTablePage({ params }: Props) {
  const { code, tableId } = await params;
  const preview = await loadTable(code, tableId);
  return (
    <Suspense fallback={<div className="p-8 text-center">Cargando...</div>}>
      <SharedTableView code={code} tableId={tableId} preview={preview} />
    </Suspense>
  );
}
