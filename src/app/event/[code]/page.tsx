'use client';
import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getEvent, getGames, addPlayer, addGame, setGameOwner, getPlayers, getPlayerByTicketCode, findPlayerByContact,
  autoMergeDuplicates,
} from '@/lib/firestore';
import { runTableGeneration } from '@/lib/tableGeneration';
import { computeEventStatus } from '@/lib/timeUtils';
import { generateUniqueTicketCode } from '@/lib/ticketCode';
import { uploadPaymentProof } from '@/lib/paymentProof';
import { savePlayerEvent } from '@/lib/myEvents';
import { searchBgg, getBggGameDetails, isBggUrl, type BggSearchResult } from '@/lib/bgg';
import TimeWheelPicker from '@/components/ui/TimeWheelPicker';
import VotingHelp from '@/components/ui/VotingHelp';
import KnowledgeLevelPicker, { type KnowledgeLevel } from '@/components/ui/KnowledgeLevelPicker';
import GameVoteCard from '@/components/ui/GameVoteCard';
import type { MeepleEvent, Game, GameComplexity, InterestLevel, DraftGame } from '@/lib/types';

type Step = 'loading' | 'closed' | 'reaccess' | 1 | 2 | 3;

const STORAGE_KEY = (code: string) => 'mm_ticket_' + code;

const COMPLEXITY_LABEL: Record<GameComplexity, string> = {
  light: 'Liviano',
  medium: 'Intermedio',
  heavy: 'Pesado',
};

export default function EventPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();

  const [step, setStep] = useState<Step>('loading');
  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [playerCount, setPlayerCount] = useState(0);
  const [ticketInput, setTicketInput] = useState('');
  const [ticketError, setTicketError] = useState('');
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [showVoted, setShowVoted] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [alias, setAlias] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [arrivalTime, setArrivalTime] = useState('');
  const [departureTime, setDepartureTime] = useState('');
  const [contactError, setContactError] = useState('');
  const [existingTicket, setExistingTicket] = useState<string | null>(null);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [paymentProofPreview, setPaymentProofPreview] = useState<string | null>(null);

  const [myGames, setMyGames] = useState<DraftGame[]>([]);
  const [newGame, setNewGame] = useState<DraftGame>({
    name: '', bggUrl: null, imageUrl: null, minPlayers: 2, maxPlayers: 4,
    durationMinutes: 60, complexity: 'medium',
    perPlayerMinutes: null, setupMinutes: null, explanationMinutes: null,
  });
  const [newGameKnowledgeLevel, setNewGameKnowledgeLevel] = useState<KnowledgeLevel | null>(null);
  // What BGG itself suggested, kept separate from newGame's live values so a per-field hint can
  // disappear the moment the organizer edits away from it, without losing the rest of the BGG data.
  const [bggSuggested, setBggSuggested] = useState<{ perPlayerMinutes: number } | null>(null);
  // Walks the "add a new game" fields one group at a time instead of dumping the whole form at
  // once. Only applies to adding — editing an existing game still shows everything flat.
  const [addGameStep, setAddGameStep] = useState(1);
  const [canExplainIds, setCanExplainIds] = useState<number[]>([]);
  const [playedOwnIds, setPlayedOwnIds] = useState<number[]>([]);
  const [bggResults, setBggResults] = useState<BggSearchResult[]>([]);
  const [bggOpen, setBggOpen] = useState(false);
  const [bggLoading, setBggLoading] = useState(false);
  const skipBggSearchRef = useRef(false);
  const [canExplainOtherIds, setCanExplainOtherIds] = useState<string[]>([]);
  const [playedOtherIds, setPlayedOtherIds] = useState<string[]>([]);
  const [knowledgePromptGameId, setKnowledgePromptGameId] = useState<string | null>(null);
  const [editingGameIndex, setEditingGameIndex] = useState<number | null>(null);
  const [interests, setInterests] = useState<Record<string, InterestLevel>>({});

  useEffect(() => {
    if (skipBggSearchRef.current) { skipBggSearchRef.current = false; return; }
    const query = newGame.name.trim();
    if (query.length < 3) { setBggResults([]); setBggOpen(false); return; }
    const handle = setTimeout(async () => {
      setBggLoading(true);
      try {
        const results = await searchBgg(query);
        setBggResults(results);
        setBggOpen(results.length > 0);
      } catch (err) {
        console.error(err);
        setBggResults([]);
      } finally {
        setBggLoading(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [newGame.name]);

  async function selectBggResult(result: BggSearchResult) {
    skipBggSearchRef.current = true;
    setBggOpen(false);
    setBggResults([]);
    try {
      const details = await getBggGameDetails(result.id);
      // BGG only gives one lump playtime figure, with no breakdown for setup/explanation — dividing
      // it across max players is just a starting point for "time per player" the organizer can adjust.
      const suggestedPerPlayer = Math.max(1, Math.ceil(details.durationMinutes / Math.max(1, details.boxMaxPlayers)));
      setNewGame((g) => ({
        ...g,
        name: result.name,
        bggUrl: details.bggUrl,
        imageUrl: details.imageUrl,
        minPlayers: details.minPlayers,
        maxPlayers: details.maxPlayers,
        durationMinutes: details.durationMinutes,
        complexity: details.complexity,
        perPlayerMinutes: suggestedPerPlayer,
      }));
      setBggSuggested({ perPlayerMinutes: suggestedPerPlayer });
      setAddGameStep(1);
    } catch (err) {
      console.error(err);
      skipBggSearchRef.current = true;
      setNewGame((g) => ({ ...g, name: result.name }));
    }
  }

  useEffect(() => {
    async function init() {
      const saved = localStorage.getItem(STORAGE_KEY(code));
      if (saved) { router.replace('/event/' + code + '/me?ticket=' + saved); return; }
      const ev = await getEvent(code);
      if (!ev || computeEventStatus(ev.date, ev.startTime, ev.endTime) === 'closed') { setStep('closed'); return; }
      const [gs, players] = await Promise.all([getGames(code), getPlayers(code)]);
      setEvent(ev);
      setGames(gs);
      setPlayerCount(players.length);
      setArrivalTime(ev.startTime);
      setDepartureTime(ev.endTime);
      setStep('reaccess');
    }
    init();
  }, [code, router]);

  async function handleReaccess(e: React.FormEvent) {
    e.preventDefault();
    setTicketError('');
    const player = await getPlayerByTicketCode(code, ticketInput.toUpperCase());
    if (!player) { setTicketError('Código no encontrado. Verificá y volvé a intentar.'); return; }
    localStorage.setItem(STORAGE_KEY(code), player.ticketCode);
    if (event) savePlayerEvent({ code, ticketCode: player.ticketCode, name: event.name, date: event.date, playerName: player.name });
    router.push('/event/' + code + '/me?ticket=' + player.ticketCode);
  }

  async function handleStep1Next() {
    setContactError('');
    setExistingTicket(null);
    if (event?.settings.maxPlayers != null && playerCount >= event.settings.maxPlayers) {
      setContactError('El evento ya alcanzó su capacidad máxima. No se pueden agregar más inscriptos.');
      return;
    }
    setCheckingDuplicate(true);
    const existing = await findPlayerByContact(code, email.trim() || null, phone.trim() || null);
    setCheckingDuplicate(false);
    if (existing) {
      setContactError('Ya hay alguien registrado con ese email o teléfono.');
      setExistingTicket(existing.ticketCode);
      return;
    }
    // This component never remounts between steps — without this, a search left over from
    // a previous visit to step 2 (before going back to step 1) would still be sitting in the form.
    cancelEditGame();
    setStep(2);
  }

  function addGameToList() {
    if (!newGame.name) return;
    // No flat duration input anymore — falls back to a pessimistic estimate (setup + explanation +
    // per-player time × max players) so the game still has a usable durationMinutes for display/legacy code.
    const estimatedDurationMinutes = (newGame.setupMinutes ?? 0) + (newGame.explanationMinutes ?? 0) + (newGame.perPlayerMinutes ?? 0) * newGame.maxPlayers;
    const gameToSave: DraftGame = { ...newGame, durationMinutes: estimatedDurationMinutes || newGame.durationMinutes };
    if (editingGameIndex != null) {
      const idx = editingGameIndex;
      const updated = [...myGames];
      updated[idx] = gameToSave;
      setMyGames(updated);
      const without = (ids: number[]) => ids.filter((i) => i !== idx);
      setCanExplainIds((ids) => (newGameKnowledgeLevel === 'explains' ? [...without(ids), idx] : without(ids)));
      setPlayedOwnIds((ids) => (newGameKnowledgeLevel === 'knows' ? [...without(ids), idx] : without(ids)));
      setEditingGameIndex(null);
    } else {
      const limit = event?.settings.maxGamesPerPlayer;
      if (limit != null && myGames.length >= limit) return;
      const index = myGames.length;
      setMyGames([...myGames, gameToSave]);
      // Their knowledge level for it is captured in the same step (the owner is assumed to want
      // to play their own game — see handleSubmit).
      if (newGameKnowledgeLevel === 'explains') setCanExplainIds((ids) => [...ids, index]);
      if (newGameKnowledgeLevel === 'knows') setPlayedOwnIds((ids) => [...ids, index]);
    }
    setNewGame({ name: '', bggUrl: null, imageUrl: null, minPlayers: 2, maxPlayers: 4, durationMinutes: 60, complexity: 'medium', perPlayerMinutes: null, setupMinutes: null, explanationMinutes: null });
    setNewGameKnowledgeLevel(null);
    setBggSuggested(null);
    setAddGameStep(1);
  }

  function editGame(index: number) {
    skipBggSearchRef.current = true;
    setNewGame(myGames[index]);
    setEditingGameIndex(index);
    setNewGameKnowledgeLevel(canExplainIds.includes(index) ? 'explains' : playedOwnIds.includes(index) ? 'knows' : 'never');
  }

  function cancelEditGame() {
    setEditingGameIndex(null);
    setNewGame({ name: '', bggUrl: null, imageUrl: null, minPlayers: 2, maxPlayers: 4, durationMinutes: 60, complexity: 'medium', perPlayerMinutes: null, setupMinutes: null, explanationMinutes: null });
    setNewGameKnowledgeLevel(null);
    setBggSuggested(null);
    setAddGameStep(1);
  }

  function removeGame(index: number) {
    const reindex = (ids: number[]) => ids.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i));
    setMyGames(myGames.filter((_, i) => i !== index));
    setCanExplainIds(reindex);
    setPlayedOwnIds(reindex);
    if (editingGameIndex === index) cancelEditGame();
  }

  function goToStep3() {
    setInterests({});
    setStep(3);
  }

  function knowledgeLevelForOther(gameId: string): KnowledgeLevel {
    if (canExplainOtherIds.includes(gameId)) return 'explains';
    if (playedOtherIds.includes(gameId)) return 'knows';
    return 'never';
  }

  function setKnowledgeLevelForOther(gameId: string, level: KnowledgeLevel) {
    setCanExplainOtherIds((cur) => {
      const without = cur.filter((id) => id !== gameId);
      return level === 'explains' ? [...without, gameId] : without;
    });
    setPlayedOtherIds((cur) => {
      const without = cur.filter((id) => id !== gameId);
      return level === 'knows' ? [...without, gameId] : without;
    });
  }

  // Voting 👍 for the first time prompts the knowledge-level popup right away — more meaningful in
  // the moment than an always-visible picker on every card, most of which you'll never vote yes on.
  function handleSetInterest(gameId: string, level: InterestLevel) {
    const wasYes = interests[gameId] === 'yes';
    setInterests((cur) => {
      const next = { ...cur };
      if (cur[gameId] === level) delete next[gameId]; else next[gameId] = level;
      return next;
    });
    if (level === 'yes' && !wasYes) setKnowledgePromptGameId(gameId);
  }

  function handlePaymentProofChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPaymentProofFile(file);
    setPaymentProofPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  async function handleSubmit() {
    if (!event || submitting) return;
    setSubmitting(true);
    const displayName = alias.trim() || `${firstName.trim()} ${lastName.trim()}`.trim();
    const maxPlayers = event.settings.maxPlayers;
    if (maxPlayers != null && playerCount >= maxPlayers) { alert('El evento está completo.'); setSubmitting(false); return; }
    const ticketCode = await generateUniqueTicketCode(code);
    const paymentProofUrl = paymentProofFile ? await uploadPaymentProof(code, ticketCode, paymentProofFile) : null;
    const savedGameIds: string[] = [];
    const canExplainGameIds: string[] = [];
    const playedOwnGameIds: string[] = [];
    const finalInterests = { ...interests };
    for (let i = 0; i < myGames.length; i++) {
      const g = myGames[i];
      const gameId = await addGame(code, { ...g, ownerPlayerId: '__pending__', ownerName: displayName });
      savedGameIds.push(gameId);
      if (canExplainIds.includes(i)) canExplainGameIds.push(gameId);
      if (playedOwnIds.includes(i)) playedOwnGameIds.push(gameId);
      // Whoever brings a game is assumed to want to play it.
      finalInterests[gameId] = 'yes';
    }
    await addPlayer(code, {
      name: displayName, firstName: firstName.trim(), lastName: lastName.trim(), alias: alias.trim() || null,
      email: email.trim() || null, phone: phone.trim() || null, arrivalTime, departureTime, ticketCode,
      bringGameIds: savedGameIds, interests: finalInterests, canExplain: [...canExplainGameIds, ...canExplainOtherIds],
      playedGameIds: [...playedOwnGameIds, ...playedOtherIds],
      repeatGameIds: [] as string[],
      paymentProofUrl,
    } as Parameters<typeof addPlayer>[1]).then((playerId) =>
      Promise.all(savedGameIds.map((gameId) => setGameOwner(code, gameId, playerId)))
    );
    // Games already brought by someone else (same BGG link) get linked as extra copies of one game,
    // now that this player's votes exist so they can be folded onto the primary copy.
    if (myGames.some((g) => g.bggUrl)) {
      await autoMergeDuplicates(code, 'bggUrl').catch(() => {});
    }
    // Fire-and-forget: don't make the player wait on the scheduling algorithm to see their ticket.
    runTableGeneration(code, event).catch(() => {});
    if (email.trim()) {
      fetch('/api/email/send-ticket', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, ticketCode }),
      }).catch(() => {});
    }
    localStorage.setItem(STORAGE_KEY(code), ticketCode);
    savePlayerEvent({ code, ticketCode, name: event.name, date: event.date, playerName: displayName });
    router.push('/event/' + code + '/me?ticket=' + ticketCode);
  }

  if (step === 'loading') return <div className="p-8 text-center">Cargando...</div>;

  const isFull = event?.settings.maxPlayers != null && playerCount >= event.settings.maxPlayers;

  if (step === 'closed') return (
    <div className="p-8 text-center text-gray-400 space-y-4">
      <p>Este evento no está disponible.</p>
      <Link href="/" className="inline-block text-indigo-400 hover:underline text-sm">← Volver al inicio</Link>
    </div>
  );

  if (step === 'reaccess') return (
    <main className="max-w-sm mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-1">{event?.name}</h1>
      <p className="text-gray-400 mb-1 text-sm">{event?.date} · {event?.location}</p>
      {event?.mapUrl && (
        <a href={event.mapUrl} target="_blank" rel="noopener noreferrer"
          className="text-indigo-400 text-sm hover:underline inline-block mb-7">
          📍 Ver ubicación en el mapa
        </a>
      )}
      {!event?.mapUrl && <div className="mb-8" />}
      {event?.settings.registrationBannerUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={event.settings.registrationBannerUrl} alt="" className="w-full rounded-xl mb-6" />
      )}
      <div className="space-y-3">
        {!showCodeInput && (
          isFull ? (
            <div className="border border-amber-800 bg-amber-950/30 rounded-xl px-4 py-3 text-sm text-amber-300">
              🚫 Este evento ya alcanzó su capacidad máxima ({playerCount}/{event?.settings.maxPlayers}). No se pueden agregar más inscriptos.
            </div>
          ) : (
            <button onClick={() => setStep(1)} className="w-full bg-indigo-600 text-white rounded-xl py-3 font-semibold hover:bg-indigo-700">
              Registrarme
            </button>
          )
        )}
        {!showCodeInput ? (
          <button type="button" onClick={() => setShowCodeInput(true)}
            className="w-full border border-indigo-500 text-indigo-400 rounded-xl py-2 font-medium hover:bg-indigo-950">
            Ya me registré — tengo mi código
          </button>
        ) : (
          <form onSubmit={handleReaccess} className="space-y-2">
            <input autoFocus className="w-full border border-gray-700 bg-gray-900 rounded-xl px-3 py-2 text-center tracking-widest uppercase font-mono"
              placeholder="MI CÓDIGO" value={ticketInput}
              onChange={(e) => setTicketInput(e.target.value.trim().toUpperCase().slice(0, 6))} />
            {ticketError && <p className="text-red-400 text-sm">{ticketError}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => { setShowCodeInput(false); setTicketInput(''); setTicketError(''); }}
                className="flex-1 border border-gray-700 rounded-xl py-2 text-sm">
                ← Atrás
              </button>
              <button type="submit" className="flex-1 bg-indigo-600 text-white rounded-xl py-2 font-semibold hover:bg-indigo-700">
                Continuar →
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );

  if (step === 1) return (
    <main className="max-w-sm mx-auto px-4 py-12">
      <p className="text-xs text-gray-500 mb-1">Paso 1 de 3</p>
      <h2 className="text-xl font-bold mb-6">¿Quién sos?</h2>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Nombre</label>
            <input className="w-full border border-gray-700 bg-gray-900 rounded-xl px-3 py-2" value={firstName}
              onChange={(e) => setFirstName(e.target.value)} placeholder="Nombre" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Apellido</label>
            <input className="w-full border border-gray-700 bg-gray-900 rounded-xl px-3 py-2" value={lastName}
              onChange={(e) => setLastName(e.target.value)} placeholder="Apellido" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Alias (opcional)</label>
          <input className="w-full border border-gray-700 bg-gray-900 rounded-xl px-3 py-2" value={alias}
            onChange={(e) => setAlias(e.target.value)} placeholder="Cómo te dicen — se muestra en vez del nombre" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input type="email" className="w-full border border-gray-700 bg-gray-900 rounded-xl px-3 py-2" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="opcional" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Teléfono</label>
            <input type="tel" className="w-full border border-gray-700 bg-gray-900 rounded-xl px-3 py-2" value={phone}
              onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-gray-500 -mt-2">El teléfono es obligatorio para este evento.</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Llegás</label>
            <TimeWheelPicker value={arrivalTime} onChange={setArrivalTime}
              minTime={event?.startTime} maxTime={event?.endTime} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Te vas</label>
            <TimeWheelPicker value={departureTime} onChange={setDepartureTime}
              minTime={event?.startTime} maxTime={event?.endTime} />
          </div>
        </div>
        {event?.settings.paymentRequired && (
          <div className="border border-indigo-800 bg-indigo-950/30 rounded-xl p-3 space-y-2">
            <p className="text-sm font-medium">💸 Comprobante de pago</p>
            {event.settings.paymentInfo && (
              <p className="text-xs text-gray-300 whitespace-pre-wrap">{event.settings.paymentInfo}</p>
            )}
            <p className="text-xs text-gray-500">Subí una foto del comprobante de la transferencia para confirmar tu lugar.</p>
            <input type="file" accept="image/*"
              onChange={handlePaymentProofChange}
              className="w-full text-xs text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-white file:text-sm hover:file:bg-indigo-700" />
            {paymentProofPreview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={paymentProofPreview} alt="Comprobante subido" className="max-h-40 rounded-lg border border-gray-700" />
            )}
          </div>
        )}
        {contactError && (
          <div className="text-sm text-red-400 space-y-1">
            <p>{contactError}</p>
            {existingTicket && (
              <button
                onClick={() => { localStorage.setItem(STORAGE_KEY(code), existingTicket); router.push('/event/' + code + '/me?ticket=' + existingTicket); }}
                className="text-indigo-400 hover:underline">
                Ver mi ticket →
              </button>
            )}
          </div>
        )}
        <button disabled={!firstName.trim() || !lastName.trim() || !arrivalTime || !departureTime || !phone.trim() || (event?.settings.paymentRequired ? !paymentProofFile : false) || checkingDuplicate}
          onClick={handleStep1Next}
          className="w-full bg-indigo-600 text-white rounded-xl py-3 font-semibold hover:bg-indigo-700 disabled:opacity-40">
          {checkingDuplicate ? 'Verificando...' : 'Siguiente →'}
        </button>
      </div>
    </main>
  );


  if (step === 2) {
    const limit = event?.settings.maxGamesPerPlayer;
    const atLimit = limit != null && myGames.length >= limit;
    // Editing an existing game always shows every section flat; adding a new one walks through
    // them one at a time, gated on addGameStep.
    const inStep = (n: number) => editingGameIndex != null || addGameStep === n;
    const timingFilled = newGame.perPlayerMinutes != null && newGame.setupMinutes != null && newGame.explanationMinutes != null;
    return (
      <main className="max-w-sm mx-auto px-4 py-12 text-center">
        <p className="text-xs text-gray-500 mb-1">Paso 2 de 3</p>
        <h2 className="text-xl font-bold mb-2">¿Qué juegos traés?</h2>
        <p className="text-sm text-gray-400 mb-5">
          {limit
            ? ('Podés agregar hasta ' + limit + ' juego' + (limit !== 1 ? 's' : '') + '.')
            : 'Podés agregar todos los que quieras.'}
        </p>
        <div className="flex gap-3 mb-5">
          <button onClick={() => setStep(1)} className="flex-1 border border-gray-700 rounded-xl py-2 text-sm">← Atrás</button>
          <button onClick={goToStep3} className="flex-1 bg-indigo-600 text-white rounded-xl py-2 font-semibold hover:bg-indigo-700">
            {myGames.length === 0 ? 'No llevo juegos →' : 'Siguiente →'}
          </button>
        </div>
        <div className="space-y-2 mb-5 text-left">
          {myGames.map((g, i) => (
            <div key={i} className={'flex items-center justify-between border rounded-xl px-3 py-2 bg-gray-800 ' + (editingGameIndex === i ? 'border-indigo-500' : 'border-gray-700')}>
              <div className="flex items-center gap-2 min-w-0">
                {g.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.imageUrl} alt="" className="w-8 h-8 rounded-md object-cover border border-gray-700 shrink-0" />
                )}
                <div className="min-w-0">
                  <span className="font-medium">{g.name}</span>
                  <span className="text-xs text-gray-500 ml-2">{g.minPlayers}–{g.maxPlayers}p · {g.durationMinutes}min · {COMPLEXITY_LABEL[g.complexity]}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button onClick={() => editGame(i)} className="text-xs text-indigo-400 hover:underline">Editar</button>
                <button onClick={() => removeGame(i)} className="text-xs text-red-400 hover:underline">Quitar</button>
              </div>
            </div>
          ))}
        </div>
        {(!atLimit || editingGameIndex != null) && (
          <div className="space-y-3 border border-gray-700 rounded-xl p-4 bg-gray-800 mb-5 text-left">
            {editingGameIndex != null ? (
              <h3 className="text-base font-semibold text-gray-100 flex items-center gap-2">🎲 {newGame.name}</h3>
            ) : (
            <div className="relative">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input className="w-full border border-gray-700 bg-gray-900 rounded-lg pl-9 pr-3 py-2" placeholder="Buscar en BGG..."
                  value={newGame.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    if (!name) { setBggSuggested(null); setAddGameStep(1); }
                    setNewGame(name ? { ...newGame, name } : { ...newGame, name, imageUrl: null, bggUrl: null });
                  }}
                  onFocus={() => { if (bggResults.length > 0) setBggOpen(true); }}
                  onBlur={() => setTimeout(() => setBggOpen(false), 150)} />
              </div>
              {bggLoading && <p className="text-xs text-gray-500 mt-1">Buscando en BGG...</p>}
              {bggOpen && bggResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                  {bggResults.map((r) => (
                    <button key={r.id} type="button"
                      onMouseDown={(e) => { e.preventDefault(); selectBggResult(r); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-800 flex items-center gap-2">
                      {r.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.imageUrl} alt="" className="w-10 h-10 rounded object-cover border border-gray-700 shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded bg-gray-800 border border-gray-700 shrink-0 flex items-center justify-center text-lg text-gray-600">
                          🎲
                        </div>
                      )}
                      <span className="truncate flex-1">{r.name}</span>
                      {r.year && <span className="text-gray-500 text-xs shrink-0">{r.year}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}
            {newGame.imageUrl && (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={newGame.imageUrl} alt=""
                  className="w-full aspect-[41/50] rounded-md object-contain bg-gray-900 border border-gray-700" />
                <button type="button" onClick={() => { setNewGame({ ...newGame, imageUrl: null, bggUrl: null }); setBggSuggested(null); setAddGameStep(1); }}
                  aria-label="Quitar" title="Quitar"
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-gray-900/80 border border-gray-700 text-gray-300 hover:bg-gray-800 flex items-center justify-center text-sm">
                  ✕
                </button>
              </div>
            )}
            {isBggUrl(newGame.bggUrl) && (
              <a href={newGame.bggUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 text-base font-medium text-indigo-400 hover:underline text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/bgg-icon.png" alt="" className="w-5 h-5 shrink-0" />
                {newGame.name}
              </a>
            )}
            {(isBggUrl(newGame.bggUrl) || editingGameIndex != null) && (
            <>
            <div className="space-y-3">
              {inStep(1) && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-gray-200">⏱️ Tiempo de juego</h3>
                  <div>
                    <label className="text-xs text-gray-400">🛠️ ¿Cuánto tiempo de armado? (min)</label>
                    <input type="number" min={0} className="w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 text-sm"
                      value={newGame.setupMinutes ?? ''} onFocus={(e) => e.target.select()} placeholder="—"
                      onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                      onChange={(e) => setNewGame({ ...newGame, setupMinutes: e.target.value ? +e.target.value : null })} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400">📚 ¿Cuánto tiempo de explicación? (min)</label>
                    <input type="number" min={0} className="w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 text-sm"
                      value={newGame.explanationMinutes ?? ''} onFocus={(e) => e.target.select()} placeholder="—"
                      onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                      onChange={(e) => setNewGame({ ...newGame, explanationMinutes: e.target.value ? +e.target.value : null })} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400">¿Cuánto tiempo por jugador? (min)</label>
                    <div className="relative">
                      <input type="number" min={0}
                        className="w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 pr-28 text-sm" placeholder="—"
                        value={newGame.perPlayerMinutes ?? ''} onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                        onChange={(e) => setNewGame({ ...newGame, perPlayerMinutes: e.target.value ? +e.target.value : null })} />
                      {bggSuggested && newGame.perPlayerMinutes === bggSuggested.perPlayerMinutes && (
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-indigo-400 pointer-events-none whitespace-nowrap">Recomendación BGG</span>
                      )}
                    </div>
                  </div>
                  {editingGameIndex == null && (
                    <button type="button" onClick={() => setAddGameStep(2)} disabled={!timingFilled}
                      className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40">
                      Siguiente →
                    </button>
                  )}
                </div>
              )}
            </div>
            {inStep(2) && (
              <>
              <h3 className={'text-sm font-semibold text-gray-200' + (editingGameIndex != null ? ' pt-3 border-t border-gray-700' : '')}>🎮 Preferencias</h3>
              <div>
                <label className="text-xs text-gray-400 block mb-1">¿Qué tan bien lo conocés?</label>
                <KnowledgeLevelPicker value={newGameKnowledgeLevel} onChange={setNewGameKnowledgeLevel} />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">🤝 ¿Prestás tu copia aunque no juegues esa mesa?</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setNewGame({ ...newGame, lendable: true })}
                    className={'flex-1 py-1.5 rounded-lg border text-sm font-medium ' + (newGame.lendable === true ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-700 text-gray-400 hover:bg-gray-800')}>
                    Sí
                  </button>
                  <button type="button" onClick={() => setNewGame({ ...newGame, lendable: false })}
                    className={'flex-1 py-1.5 rounded-lg border text-sm font-medium ' + (newGame.lendable === false ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-700 text-gray-400 hover:bg-gray-800')}>
                    No
                  </button>
                </div>
              </div>
              </>
            )}
            {inStep(2) && (
            <div className="flex gap-2">
              {editingGameIndex != null ? (
                <button onClick={cancelEditGame} className="flex-1 border border-gray-700 rounded-lg py-2 text-sm font-medium">
                  Cancelar
                </button>
              ) : (
                <button type="button" onClick={() => setAddGameStep(1)} className="text-xs text-gray-500 hover:text-gray-300 px-2">← Volver</button>
              )}
              <button onClick={addGameToList}
                disabled={!newGame.name.trim() || newGame.perPlayerMinutes == null || newGame.setupMinutes == null || newGame.explanationMinutes == null || newGameKnowledgeLevel == null || newGame.lendable == null}
                className="flex-1 bg-gray-700 rounded-lg py-2 text-sm font-medium hover:bg-gray-600 disabled:opacity-40">
                {editingGameIndex != null ? 'Guardar cambios' : '+ Agregar juego'}
              </button>
            </div>
            )}
            </>
            )}
          </div>
        )}
        {atLimit && editingGameIndex == null && (
          <p className="text-amber-400 text-sm mb-5">
            {'Alcanzaste el límite de ' + limit + ' juego' + (limit !== 1 ? 's' : '') + ' para este evento.'}
          </p>
        )}
      </main>
    );
  }

  if (step === 3) {
    const isEmpty = games.length === 0;
    // Merged duplicates (admin marked two entries as copies of the same game) only get one
    // votable row — the primary — combining every copy's owner name into a single label.
    const primaryGames = games.filter((g) => !g.groupId || g.groupId === g.id);
    const ownerLabel = (g: Game) => games.filter((m) => (m.groupId ?? m.id) === g.id).map((m) => m.ownerName).join(', ');
    // Games already voted on (👍 or 👎) get tucked away so the list shrinks as you go — still
    // reachable under "Ya votados" to change a vote or your knowledge level.
    const unvotedGames = primaryGames.filter((g) => !interests[g.id]);
    const votedGames = primaryGames.filter((g) => !!interests[g.id]);
    const renderGameCard = (g: Game) => (
      <GameVoteCard key={g.id} game={g} interest={interests[g.id]} isOwn={false} ownerLabel={ownerLabel(g)}
        // handleSetInterest toggles by itself when handed the level that's already active
        onSetInterest={(level) => handleSetInterest(g.id, level ?? interests[g.id])}
        knowledgeLevel={knowledgeLevelForOther(g.id)} onEditKnowledge={() => setKnowledgePromptGameId(g.id)} />
    );
    return (
      <main className="max-w-sm mx-auto px-4 py-12">
        <p className="text-xs text-gray-500 mb-1">Paso 3 de 3</p>
        <h2 className="text-xl font-bold mb-2">¿Qué querés jugar? <VotingHelp /></h2>
        {isEmpty
          ? <p className="text-sm text-gray-400 mb-6">
              {playerCount === 0
                ? 'Sos el primero en inscribirte 🎉 Todavía no hay personas registradas.'
                : `Todavía nadie cargó juegos 🎉 Hasta ahora se registraron ${playerCount} persona${playerCount !== 1 ? 's' : ''}.`}
            </p>
          : <p className="text-sm text-gray-400 mb-5">Hasta ahora se registraron {playerCount} persona{playerCount !== 1 ? 's' : ''}.</p>
        }
        {myGames.length > 0 && (
          <div className="space-y-2 mb-6">
            <p className="text-xs text-gray-500 -mb-1">Tus juegos</p>
            {myGames.map((g, i) => (
              <div key={'own-' + i} className="border border-gray-700 rounded-xl px-4 py-3 bg-gray-800">
                <span className="font-medium">{g.name}</span>
                <span className="text-xs text-gray-500 ml-2">{g.minPlayers}–{g.maxPlayers}p · {COMPLEXITY_LABEL[g.complexity]}</span>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2 mb-6">
          {unvotedGames.map(renderGameCard)}
          {unvotedGames.length === 0 && votedGames.length > 0 && (
            <p className="text-sm text-gray-500 text-center py-4">¡Listo, votaste todos los juegos! 🎉</p>
          )}
          {votedGames.length > 0 && (
            <div className="pt-1">
              <button onClick={() => setShowVoted((v) => !v)} className="text-xs text-gray-500 hover:text-gray-300">
                {showVoted ? '▾' : '▸'} Ya votados ({votedGames.length})
              </button>
              {showVoted && <div className="space-y-2 mt-2">{votedGames.map(renderGameCard)}</div>}
            </div>
          )}
        </div>
        <div className="sticky bottom-0 -mx-4 px-4 py-3 flex gap-3 bg-black/80 backdrop-blur-sm border-t border-gray-800 z-10">
          <button onClick={() => setStep(2)} className="flex-1 border border-gray-700 rounded-xl py-2 text-sm">← Atrás</button>
          <button onClick={handleSubmit} disabled={submitting}
            className="flex-1 bg-indigo-600 text-white rounded-xl py-2 font-semibold hover:bg-indigo-700 disabled:opacity-50">
            {submitting ? 'Guardando...' : '¡Listo! →'}
          </button>
        </div>
        {knowledgePromptGameId && (() => {
          const game = games.find((g) => g.id === knowledgePromptGameId);
          if (!game) return null;
          const close = () => setKnowledgePromptGameId(null);
          return (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={close}>
              <div className="max-w-sm w-full bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 text-sm"
                onClick={(e) => e.stopPropagation()}>
                <h3 className="font-semibold text-gray-100">¿Qué tan bien conocés {game.name}?</h3>
                <KnowledgeLevelPicker value={knowledgeLevelForOther(game.id)}
                  onChange={(level) => { setKnowledgeLevelForOther(game.id, level); close(); }} />
                <button onClick={close} className="w-full border border-gray-700 rounded-lg py-2 text-xs text-gray-400 hover:bg-gray-800">
                  Ahora no
                </button>
              </div>
            </div>
          );
        })()}
      </main>
    );
  }

  return null;
}
