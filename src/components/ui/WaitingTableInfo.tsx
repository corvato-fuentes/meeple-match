'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import GameCover from '@/components/ui/GameCover';
import { estimatedDurationRange, estimateAtCurrentSeats } from '@/lib/tableAlgorithm';
import { minSeats } from '@/lib/seats';
import type { Game, GameComplexity, Table } from '@/lib/types';

const COMPLEXITY_LABEL: Record<GameComplexity, string> = { light: 'Liviano', medium: 'Intermedio', heavy: 'Pesado' };

const ACCENT = {
  amber: { title: 'text-amber-300', link: 'text-amber-400' },
  indigo: { title: 'text-indigo-300', link: 'text-indigo-400' },
  purple: { title: 'text-purple-300', link: 'text-purple-400' },
  green: { title: 'text-gray-100', link: 'text-green-400' },
  gray: { title: 'text-gray-400', link: 'text-gray-400' },
} as const;
export type TableAccent = keyof typeof ACCENT;

/**
 * The info block every table that is still waiting (recommended by the algorithm / posted by an owner / just
 * confirmed) shows, on the board and on the player's own pages, so a table reads the same wherever it appears:
 * cover, game, estimated time, who brings it and who explains it (`who`), and how full it is. The seat line spells
 * out that the confirmed count is measured against a MINIMUM — the table can take more people up to the maximum.
 */
export default function WaitingTableInfo({ t, game, accent, who, badge, note, interested, seatWord, onView }: {
  t: Table;
  game: Game | undefined;
  accent: TableAccent;
  /** The "lo trae / lo explica" lines — see `RecommendedWho` and `PostedWho`. */
  who: ReactNode;
  /** Optional state chip shown next to the game name (e.g. "Por aceptar"). */
  badge?: ReactNode;
  /** What this table means for you right now (e.g. "Te ofrecieron esta mesa…"), at the end of the info lines. */
  note?: ReactNode;
  /** People offered the table who haven't answered yet; null when the table has no offer step (posted tables). */
  interested: number | null;
  seatWord: string;
  onView: (kind: 'confirmed' | 'interested') => void;
}) {
  const a = ACCENT[accent];
  const [shortest, longest] = game ? estimatedDurationRange(game) : [null, null];
  const min = game ? minSeats(game) : 0;
  const seatsLeft = game ? Math.max(0, game.maxPlayers - t.playerIds.length) : null;
  // The table reserves the time for every seat taken; with fewer people it would end earlier, and both are shown
  const today = game ? estimateAtCurrentSeats(t, game) : null;
  const missing = game ? Math.max(0, min - t.playerIds.length) : null;
  // One clear line for the seats. Until the table reaches its minimum it says how many are missing and how many fit;
  // after that it says the table is set and how many places are left.
  const seatText = game && seatsLeft != null && missing != null
    ? [
        `${t.playerIds.length} ${seatWord}`,
        missing > 0 ? `faltan ${missing} para confirmar` : t.status === 'confirmed' ? 'mesa confirmada' : 'ya alcanza el mínimo',
        missing > 0
          ? (min >= game.maxPlayers ? `se juega con ${game.maxPlayers}` : `caben hasta ${game.maxPlayers}`)
          : (seatsLeft === 0 ? 'sin lugares libres' : `${seatsLeft} lugar${seatsLeft === 1 ? '' : 'es'} libre${seatsLeft === 1 ? '' : 's'}`),
      ].join(' · ')
    : `${t.playerIds.length} ${seatWord}`;
  return (
    <>
      <div className='flex items-stretch gap-3 min-w-0'>
        {/* The cover takes the whole height of the text column next to it, so there is no empty space under it */}
        <GameCover imageUrl={game?.imageUrl} size='fill' />
        <span className='min-w-0 space-y-0.5'>
          {/* Name and state chip on one line; the schedule sits with the rest of the game's data */}
          <p className='flex flex-wrap items-center gap-x-2 gap-y-1'>
            <span className={`font-semibold ${a.title}`}>{t.gameName}</span>
            {badge}
          </p>
          <p className='text-sm text-gray-500'>
            <span className={`font-medium ${a.link}`}>🕒 {t.startTime}–{t.endTime}</span>
            {game && shortest != null && (
              <> · ⏱ ~{shortest === longest ? shortest : `${shortest}–${longest}`} min · {COMPLEXITY_LABEL[game.complexity]}</>
            )}
          </p>
          {today && (
            <p className='text-xs text-gray-500'>
              ⏳ Con {today.seats} jugadores: ~{today.minutes} min (hasta las {today.endTime}) · la mesa reserva hasta las {t.endTime}
            </p>
          )}
          {who}
          <span className='block pt-1.5 space-y-1'>
        {interested != null && (
          <button onClick={() => onView('interested')} className={`block text-sm ${a.link} hover:underline text-left`}>
            🤔 {interested} interesados →
          </button>
        )}
        <button onClick={() => onView('confirmed')} className={`block text-sm ${a.link} hover:underline text-left`}>
          🪑 {seatText} →
        </button>
        {note && <p className='text-sm text-amber-300 pt-0.5'>{note}</p>}
          </span>
        </span>
      </div>
    </>
  );
}

const Line = ({ children }: { children: ReactNode }) => <p className='text-sm text-gray-400'>{children}</p>;
const Name = ({ children }: { children: ReactNode }) => <span className='text-gray-300'>{children}</span>;

/**
 * Who brings and who explains an algorithm-recommended table. Waiting for an explainer (`awaitingExplainer`), the people
 * who can explain it were all asked at once and nobody has accepted yet — so it says that, not a made-up explainer.
 */
export function RecommendedWho({ t, game, nameOf }: { t: Table; game: Game | undefined; nameOf: (id: string) => string }) {
  const owner = game ? (() => { const n = nameOf(game.ownerPlayerId); return n && n !== '?' ? n : game.ownerName || '?'; })() : null;
  if (t.awaitingExplainer) {
    const asked = (t.candidateIds ?? []).map(nameOf);
    return (
      <>
        {owner && <Line>🎒 Lo trae: <Name>{owner}</Name></Line>}
        <Line>🎓 Pueden explicarla: <Name>{asked.join(', ') || '—'}</Name></Line>
        <p className='text-sm text-amber-300'>
          ⏳ {asked.length === 1 ? `${asked[0]} todavía no confirmó que explica` : 'Todavía no confirmó nadie que la explica'}
        </p>
      </>
    );
  }
  const explainer = nameOf(t.explainerId);
  if (game && owner === explainer) return <Line>🎒🎓 Lo trae, lo explica y juega: <Name>{explainer}</Name></Line>;
  return (
    <>
      {owner && <Line>🎒 Lo trae: <Name>{owner}</Name></Line>}
      <Line>🎓 Lo explica y juega: <Name>{explainer}</Name></Line>
    </>
  );
}

/**
 * Who brings and who explains a table an owner posted: the poster brings it; the explainers are whoever is seated and
 * knows how to teach it (there may be none yet).
 */
export function PostedWho({ t, nameOf, explainerNames }: { t: Table; nameOf: (id: string) => string; explainerNames: string[] }) {
  return (
    <>
      <Line>🎒 Lo trae: <Name>{nameOf(t.explainerId)}</Name></Line>
      <Line>🎓 Lo explica y juega: <Name>{explainerNames.length > 0 ? explainerNames.join(', ') : 'nadie todavía'}</Name></Line>
    </>
  );
}

const BUTTON_TONE = {
  amber: 'bg-amber-600 text-black hover:bg-amber-500',
  indigo: 'bg-indigo-600 text-white hover:bg-indigo-700',
  neutral: 'border border-gray-700 text-gray-300 hover:bg-gray-800',
  done: 'border border-green-800 bg-green-950/30 text-green-300',
  muted: 'border border-gray-700 bg-gray-900/60 text-gray-400',
  warn: 'border border-orange-800 bg-orange-950/20 text-orange-300',
} as const;
export type ButtonTone = keyof typeof BUTTON_TONE;

/**
 * The one big button at the foot of every table card: the action you can take (accept, join, leave…) or, when there
 * is nothing to do, the state you are in (already confirmed, rejected, waiting…) as a button that doesn't respond.
 * Same size and shape for all of them, so every card ends the same way.
 */
export function ActionButton({ tone, onClick, href, disabled, children }: {
  tone: ButtonTone;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const cls = `block w-full text-center text-sm font-medium rounded-lg px-3 py-2 ${BUTTON_TONE[tone]}`;
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  if (onClick) return <button onClick={onClick} disabled={disabled} className={`${cls} disabled:opacity-50`}>{children}</button>;
  return <div role='status' className={cls}>{children}</div>;
}
