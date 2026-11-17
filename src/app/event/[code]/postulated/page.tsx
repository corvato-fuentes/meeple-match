'use client';
import RedirectToMesas from '@/components/ui/RedirectToMesas';

// This screen moved into "Explorar mesas" (/mesas): the old address keeps working.
export default function PostulatedTablesPage() {
  return <RedirectToMesas filtro='for-you' />;
}
