'use client';
import { useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

/**
 * The old table screens (recomendadas, postuladas, explorar) now live in "Explorar mesas". Links that already went out — a
 * notification, a saved address — land here and move on, keeping the ticket.
 */
export default function RedirectToMesas({ filtro }: { filtro?: string }) {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const params = new URLSearchParams();
    if (filtro) params.set('filtro', filtro);
    const ticket = searchParams.get('ticket');
    if (ticket) params.set('ticket', ticket);
    const query = params.toString();
    router.replace(`/event/${code}/mesas${query ? '?' + query : ''}`);
  }, [code, filtro, router, searchParams]);
  return <div className="p-8 text-center">Cargando...</div>;
}
