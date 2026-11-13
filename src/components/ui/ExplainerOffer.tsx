'use client';
import { ActionButton } from '@/components/ui/WaitingTableInfo';
import { explainEndFor } from '@/lib/explainOnly';
import { minSeats } from '@/lib/seats';
import type { Game, Table } from '@/lib/types';

/**
 * The answers to "can you explain this table?", for a table the algorithm built that is still waiting for its explainer. Besides
 * saying no, the explainer chooses: explain and play (they take a seat, as always), or only explain (no seat, the table holds
 * them just for the explanation and they are free afterwards).
 */
export default function ExplainerOffer({ table, game, disabled, saving, onAnswer }: {
  table: Table;
  game: Game | undefined;
  disabled?: boolean;
  saving?: boolean;
  /** `onlyExplain` is only meaningful with `accept`. */
  onAnswer: (accept: boolean, onlyExplain?: boolean) => void;
}) {
  const until = explainEndFor(table, game);
  const needed = game ? minSeats(game) : 2;
  return (
    <div className='space-y-2'>
      <div className='grid grid-cols-2 gap-2'>
        <ActionButton tone='neutral' onClick={() => onAnswer(false)} disabled={disabled}>❌ No puedo explicarlo</ActionButton>
        <ActionButton tone='amber' onClick={() => onAnswer(true, false)} disabled={disabled}>
          {saving ? 'Guardando...' : '✅ Explico y juego'}
        </ActionButton>
      </div>
      <ActionButton tone='indigo' onClick={() => onAnswer(true, true)} disabled={disabled}>🎓 Solo explico (hasta las {until})</ActionButton>
      <p className='text-[11px] text-gray-500 leading-snug'>
        «Solo explico»: no ocupás un lugar y quedás libre después de las {until} para otra mesa. La mesa se confirma cuando se juntan {needed} jugadores sin contarte.
      </p>
    </div>
  );
}
