import { dayLabel } from '@/lib/shareTable';
import type { WhenTone } from '@/lib/homeEvents';

const TONE: Record<WhenTone, string> = {
  live: 'bg-green-900 text-green-300',
  soon: 'bg-amber-900 text-amber-300',
  later: 'bg-gray-700 text-gray-300',
  past: 'bg-gray-800 text-gray-500',
};

/**
 * An event as it reads in a card: the flyer as a thumbnail before the text (like the game cards), then the name, how far away it is,
 * the day and hours, and the place. Anything else for the card (who is in, the buttons) goes in as children, below the place.
 */
export default function EventSummary({ name, bannerUrl, date, startTime, endTime, location, when, children }: {
  name: string; bannerUrl?: string | null; date: string; startTime?: string; endTime?: string; location?: string;
  when: { label: string; tone: WhenTone }; children?: React.ReactNode;
}) {
  return (
    <div className='flex gap-3'>
      {bannerUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={bannerUrl} alt={`Panfleto de ${name}`} className='w-16 h-20 rounded object-cover border border-gray-700 bg-gray-900 shrink-0' />
      )}
      <div className='min-w-0 flex-1'>
        <div className='flex items-start justify-between gap-3'>
          <p className='font-semibold leading-snug'>{name}</p>
          {when.label && <span className={'shrink-0 text-xs rounded-full px-2 py-0.5 ' + TONE[when.tone]}>{when.label}</span>}
        </div>
        <div className='mt-1 space-y-0.5 text-xs text-gray-400'>
          {date && <p>📅 {dayLabel(date)}{startTime && endTime ? ` · ${startTime}–${endTime}` : ''}</p>}
          {location && <p>📍 {location}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
