import { cache, Suspense } from 'react';
import type { Metadata } from 'next';
import { getSharedTable } from '@/lib/shareTableServer';
import { dayLabel, shareHeadline } from '@/lib/shareTable';
import SharedTableView from '@/components/ui/SharedTableView';

type Props = { params: Promise<{ code: string; tableId: string }> };

// One read for the link preview and for the page itself
const loadTable = cache((code: string, tableId: string) => getSharedTable(code, tableId).catch(() => null));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code, tableId } = await params;
  const t = await loadTable(code, tableId);
  if (!t || !t.open) return { title: 'Mesa · Meeple Loop' };
  const title = shareHeadline(t);
  const description = [t.eventName, dayLabel(t.date), `${t.startTime}–${t.endTime}`, t.location].filter(Boolean).join(' · ');
  // The link's picture comes from opengraph-image.tsx next to this file
  return { title, description, openGraph: { title, description } };
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
