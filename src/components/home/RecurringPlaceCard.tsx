import { instagramLink, placeAddressText, whatsappLink, type RecurringPlace } from '@/lib/recurringPlaces';

const iconButton = 'inline-flex items-center justify-center w-9 h-9 rounded-full text-white hover:opacity-85';

function WhatsAppIcon() {
  return (
    <svg viewBox='0 0 24 24' width='20' height='20' fill='currentColor' aria-hidden='true'>
      <path d='M12.04 2a9.9 9.9 0 0 0-8.5 14.96L2 22l5.2-1.5A9.9 9.9 0 1 0 12.04 2Zm0 18.1c-1.5 0-2.9-.4-4.1-1.1l-.3-.2-3 .9.9-2.9-.2-.3a8.2 8.2 0 1 1 6.7 3.6Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.6 1 2.8.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.7 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.2-.3-.2-.5-.3Z' />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox='0 0 24 24' width='20' height='20' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      <rect x='3' y='3' width='18' height='18' rx='5' />
      <circle cx='12' cy='12' r='4' />
      <circle cx='17.5' cy='6.5' r='1' fill='currentColor' stroke='none' />
    </svg>
  );
}

/** The icons that open the place's WhatsApp and Instagram: each shows only if the place has that contact. */
export function PlaceContacts({ place }: { place: RecurringPlace }) {
  const wa = whatsappLink(place.whatsapp);
  const ig = instagramLink(place.instagram);
  if (!wa && !ig) return null;
  return (
    <div className='flex items-center gap-2'>
      {wa && (
        <a href={wa} target='_blank' rel='noopener noreferrer' aria-label={`WhatsApp de ${place.name}`} title='Escribir por WhatsApp'
          className={`${iconButton} bg-green-600`}>
          <WhatsAppIcon />
        </a>
      )}
      {ig && (
        <a href={ig} target='_blank' rel='noopener noreferrer' aria-label={`Instagram de ${place.name}`} title='Ver el Instagram'
          className={`${iconButton} bg-gradient-to-tr from-yellow-500 via-pink-600 to-purple-600`}>
          <InstagramIcon />
        </a>
      )}
    </div>
  );
}

/**
 * A place where people play every week: its days and hours as options, where it is, and how to get in touch (there is no registration).
 * "Ver en el mapa" takes to the map of the app, with this place in the middle (only when it has an address: the pin is the city otherwise).
 */
export default function RecurringPlaceCard({ place, onShowOnMap }: { place: RecurringPlace; onShowOnMap: (place: RecurringPlace) => void }) {
  return (
    <div className='border border-gray-700 rounded-xl p-3 bg-gray-900 space-y-2'>
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <p className='font-semibold text-gray-100'>{place.name}</p>
          <p className='text-sm text-gray-400'>📍 {placeAddressText(place)}</p>
        </div>
        <span className='shrink-0 text-xs px-2 py-0.5 rounded-full bg-teal-900/60 text-teal-300 border border-teal-700'>🔁 Se juega siempre</span>
      </div>
      <ul className='space-y-1.5'>
        {place.schedules.map((s) => (
          <li key={`${s.days}-${s.time}`} className='text-sm rounded-lg border border-gray-700 bg-gray-800/60 px-2.5 py-1.5'>
            <span className='font-medium text-gray-100'>📅 {s.days}</span>
            <span className='text-gray-300'> · {s.time}</span>
            {s.note && <span className='block text-xs text-gray-400'>{s.note}</span>}
          </li>
        ))}
      </ul>
      {place.note && <p className='text-xs text-gray-400'>{place.note}</p>}
      <div className='flex flex-wrap items-center gap-3'>
        <PlaceContacts place={place} />
        {place.address && (
          <button type='button' onClick={() => onShowOnMap(place)} className='text-xs text-indigo-400 hover:underline'>
            🗺️ Ver en el mapa
          </button>
        )}
      </div>
      <p className='text-xs text-gray-500'>Sin inscripción en la app: coordiná directamente con el lugar.</p>
    </div>
  );
}
