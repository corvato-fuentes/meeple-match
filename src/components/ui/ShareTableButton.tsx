'use client';
import { useState } from 'react';
import { shareHeadline, shareInfoOf, shareLink, shareMessage } from '@/lib/shareTable';
import type { Game, MeepleEvent, Table } from '@/lib/types';

/**
 * Sharing a table that still has room, two ways:
 *  - "Compartir": the phone's share sheet (WhatsApp and the rest) with a message that says there is room, when and where,
 *    and a link to the table; where sharing isn't available it copies both.
 *  - "Historia de Instagram": a vertical picture made for a story, shared as a file so Instagram offers "Historia". A story
 *    can't carry a link in its text, so the link is copied for the story's link sticker.
 * The link carries no ticket.
 */
export default function ShareTableButton({ code, table, game, event }: {
  code: string;
  table: Table;
  game: Pick<Game, 'minPlayers' | 'maxPlayers'>;
  event: Pick<MeepleEvent, 'name' | 'date' | 'location'>;
}) {
  const [copied, setCopied] = useState(false);
  // The story picture, once made: a second tap shares it at once (some phones only share from the tap itself)
  const [storyFile, setStoryFile] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [note, setNote] = useState('');

  async function share() {
    const url = shareLink(window.location.origin, code, table.id);
    const info = shareInfoOf(table, game, event);
    // The link goes inside the message (not as a separate field), so apps don't show it twice
    const text = shareMessage(info, event.name, url);
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

  function download(file: File) {
    const href = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = href;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 5000);
  }

  async function shareStory() {
    if (preparing) return;
    setNote('');
    // The link is copied first, inside the tap, for the story's link sticker
    const linkCopied = navigator.clipboard
      ? navigator.clipboard.writeText(shareLink(window.location.origin, code, table.id)).then(() => true, () => false)
      : Promise.resolve(false);
    let file = storyFile;
    if (!file) {
      setPreparing(true);
      try {
        const res = await fetch(`/event/${code}/mesa/${table.id}/story`);
        if (!res.ok) throw new Error('story');
        file = new File([await res.blob()], `mesa-${table.gameName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`, { type: 'image/png' });
        setStoryFile(file);
      } catch {
        setNote('No se pudo preparar la imagen. Probá de nuevo.');
        return;
      } finally {
        setPreparing(false);
      }
    }
    const stickerHint = (await linkCopied) ? 'Link copiado: pegalo con la pegatina de enlace de tu historia.' : '';
    if (typeof navigator.canShare !== 'function' || !navigator.canShare({ files: [file] })) {
      download(file); // this phone/browser can't share files: the picture goes to the downloads
      setNote(`Imagen descargada. ${stickerHint}`.trim());
      return;
    }
    try {
      await navigator.share({ files: [file] });
      setNote(stickerHint);
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'AbortError') return; // they closed the sheet
      if (name === 'NotAllowedError') setNote('La imagen está lista: tocá de nuevo para compartirla.');
      else { download(file); setNote(`Imagen descargada. ${stickerHint}`.trim()); }
    }
  }

  const button = 'w-full border border-gray-700 rounded-xl py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50';
  return (
    <div className="space-y-1.5">
      <button type="button" onClick={share} className={button}>
        {copied ? '✓ Link copiado' : '📤 Compartir esta mesa'}
      </button>
      <button type="button" onClick={shareStory} disabled={preparing} className={button}>
        {preparing ? 'Preparando imagen...' : storyFile ? '📸 Compartir la historia' : '📸 Historia de Instagram'}
      </button>
      {note && <p className="text-[11px] text-gray-400 text-center">{note}</p>}
    </div>
  );
}
