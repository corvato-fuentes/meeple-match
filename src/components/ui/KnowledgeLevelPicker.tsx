'use client';

export type KnowledgeLevel = 'explains' | 'knows' | 'never';

const OPTIONS: { level: KnowledgeLevel; icon: string; label: string }[] = [
  { level: 'explains', icon: '🎓', label: 'Sé explicarlo' },
  { level: 'knows', icon: '👍', label: 'Sé jugarlo' },
  { level: 'never', icon: '🆕', label: 'Nunca lo jugué' },
];

/** 3-way, mutually exclusive: how well the player already knows this specific game. */
export default function KnowledgeLevelPicker({
  value, onChange,
}: {
  value: KnowledgeLevel | null;
  onChange: (level: KnowledgeLevel) => void;
}) {
  return (
    <div className="flex gap-1 mt-2">
      {OPTIONS.map(({ level, icon, label }) => {
        const active = value === level;
        return (
          <button key={level} type="button" onClick={() => onChange(level)}
            className={'flex-1 py-1.5 rounded-lg border transition-colors flex flex-col items-center gap-0.5 leading-tight ' +
              (active ? 'bg-purple-900 border-purple-600 text-purple-200' : 'border-gray-700 text-gray-500 hover:bg-gray-800')}>
            <span className="text-sm">{icon}</span>
            <span className="text-[10px]">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
