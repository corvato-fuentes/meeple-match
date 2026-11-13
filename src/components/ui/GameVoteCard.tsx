'use client';
import { bggSearchUrl } from '@/lib/bgg';
import { roundUp5 } from '@/lib/timeUtils';
import type { KnowledgeLevel } from '@/components/ui/KnowledgeLevelPicker';
import type { Game, GameComplexity, InterestLevel } from '@/lib/types';

const COMPLEXITY_LABEL: Record<GameComplexity, string> = {
  light: 'Liviano',
  medium: 'Intermedio',
  heavy: 'Pesado',
};

const KNOWLEDGE_LABEL: Record<KnowledgeLevel, string> = {
  explains: '🎓 Sabés explicarlo',
  knows: '👍 Sabés jugarlo',
  never: '🆕 Nunca lo jugaste',
};

export default function GameVoteCard({
  game, interest, isOwn, ownerLabel, onSetInterest, knowledgeLevel, onEditKnowledge, repeat, onToggleRepeat,
}: {
  game: Game;
  interest: InterestLevel | undefined;
  isOwn: boolean;
  ownerLabel: string;
  onSetInterest: (level: InterestLevel | null) => void;
  knowledgeLevel: KnowledgeLevel;
  onEditKnowledge: () => void;
  /** Would play a second table of this game too (only offered where the player can change it). */
  repeat?: boolean;
  onToggleRepeat?: () => void;
}) {
  const copyCount = ownerLabel.split(',').length;
  const href = game.bggUrl ?? bggSearchUrl(game.name);
  return (
    <div className="border border-gray-700 rounded-xl px-3 py-3 bg-gray-800">
      <a href={href} target="_blank" rel="noopener noreferrer"
        title="Ver en BoardGameGeek"
        className="flex items-center justify-center gap-1.5 text-center font-semibold text-indigo-300 hover:underline">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/bgg-icon.png" alt="" className="w-4 h-4 shrink-0" />
        <span>{game.name}</span>
      </a>
      {isOwn && <p className="text-center text-[11px] text-indigo-400 mt-0.5">lo traés vos</p>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={game.imageUrl || '/cover-placeholder.png'} alt=""
        className="w-full h-44 mt-2 rounded-md object-contain bg-gray-900 border border-gray-700" />
      <div className="mt-2 text-center">
        <p className="text-xs text-gray-400">
          {game.minPlayers}–{game.maxPlayers}p · {roundUp5(game.durationMinutes)}min ·{COMPLEXITY_LABEL[game.complexity]}
          {copyCount > 1 && <span className="ml-1.5 text-[10px] bg-indigo-900 text-indigo-300 px-1 rounded">🧩 {copyCount} copias</span>}
        </p>
        {!isOwn && <p className="text-[11px] text-gray-500 mt-0.5">Trae: {ownerLabel}</p>}
      </div>
      <div className="flex gap-1 mt-2">
        {(['yes', 'no'] as InterestLevel[]).map((level) => {
          const active = interest === level;
          const cls = active
            ? level === 'yes' ? 'bg-blue-900 border-blue-600 text-blue-300'
              : 'bg-gray-700 border-gray-500 text-gray-300'
            : 'border-gray-700 text-gray-500 hover:bg-gray-800';
          return (
            <button key={level}
              onClick={() => onSetInterest(active ? null : level)}
              className={'flex-1 py-1.5 rounded-lg border transition-colors flex flex-col items-center gap-0.5 leading-tight ' + cls}>
              <span className="text-sm">{level === 'yes' ? '👍' : '👎'}</span>
              <span className="text-[10px]">{level === 'yes' ? 'Quiero jugarlo' : 'No me interesa'}</span>
            </button>
          );
        })}
      </div>
      {interest === 'yes' && onToggleRepeat && (
        <button type="button" onClick={onToggleRepeat} aria-pressed={!!repeat}
          className={'w-full mt-2 py-1.5 rounded-lg border text-xs flex items-center justify-center gap-1.5 ' +
            (repeat ? 'bg-indigo-900/60 border-indigo-600 text-indigo-200' : 'border-gray-700 text-gray-500 hover:bg-gray-800')}>
          <span>🔁</span>
          <span>{repeat ? 'Jugarías una segunda mesa (tocá para quitarlo)' : 'Jugarías también una segunda mesa'}</span>
        </button>
      )}
      {(interest === 'yes' || knowledgeLevel !== 'never') && (
        <div className="flex items-center justify-between text-xs text-gray-400 mt-2">
          {/* "Nunca lo jugué" is what a game is until the person says otherwise (nothing is stored for it), so a voted game with
              no answer asks the question instead of stating it */}
          <span>{knowledgeLevel === 'never' ? '❔ ¿Qué tan bien lo conocés?' : KNOWLEDGE_LABEL[knowledgeLevel]}</span>
          <button onClick={onEditKnowledge} className="text-indigo-400 hover:underline">{knowledgeLevel === 'never' ? '✏️ Elegir' : '✏️ Editar'}</button>
        </div>
      )}
    </div>
  );
}
