'use client';
import { useState } from 'react';
import { shareHeadline, shareInfoOf, shareLink, shareMessage } from '@/lib/shareTable';
import type { Game, Table } from '@/lib/types';

/**
 * "Compartir" on a table that still has room: opens the phone's share sheet (WhatsApp and the rest) with a line that says
 * what is missing and a link to the table; where sharing isn't available it copies both. The link carries no ticket.
 */
export default function ShareTableButton({ code, table, game, eventName, eventDate }: {
  code: string;
  table: Table;
  game: Pick<Game, 'minPlayers' | 'maxPlayers'>;
  eventName: string;
  eventDate: string;
}) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = shareLink(window.location.origin, code, table.id);
    const info = shareInfoOf(table, game, eventDate);
    // The link goes inside the message (not as a separate field), so apps don't show it twice
    const text = shareMessage(info, eventName, url);
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: shareHeadline(info), text });
        return;
      }
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return; // they closed the sheet
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* nothing else to try */ }
  }

  return (
    <button type="button" onClick={share}
      className="w-full border border-gray-700 rounded-xl py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800">
      {copied ? '✓ Link copiado' : '📤 Compartir esta mesa'}
    </button>
  );
}
