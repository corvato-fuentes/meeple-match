# Meeple Loop — Especificación Técnica Completa

## Visión del Producto

Web app SaaS multi-tenant para gestionar eventos de juegos de mesa. Sin registro de
usuarios. Cualquier club o grupo crea un evento con un link, los jugadores se anotan
escaneando un QR, cargan los juegos que traen, y marcan su wishlist de los juegos
que otros van a traer. El sistema propone mesas automáticamente en tiempo real a
medida que llegan registros. El organizador confirma y ajusta. El resultado se
muestra como un tablero de aeropuerto proyectable el día del evento.

Diseñada para escalar desde grupos de 5 hasta 200+ personas.

---

## Stack Tecnológico

| Capa          | Tecnología                             | Justificación                                           |
|---------------|----------------------------------------|---------------------------------------------------------|
| Frontend      | Next.js 14 (App Router) + TypeScript   | SSR, routing limpio, deploy nativo en Vercel            |
| Estilos       | Tailwind CSS                           | Mobile-first, rápido de construir                       |
| Base de datos | Firebase Firestore (Spark plan)        | Real-time, sin pausing, sin credit card, sin servidor   |
| Auth jugador  | Firebase Anonymous Auth                | Cero fricción — nadie crea cuenta                       |
| Auth admin    | Token secreto de 32 chars en la URL    | Sin login, seguridad suficiente para panel de club      |
| Hosting       | Vercel (Hobby, gratis)                 | Integración nativa Next.js, deploy con git push         |
| PWA           | next-pwa                               | Instalable desde el celular en el evento                |
| Monetización  | Google AdSense + Cafecito/Ko-fi        | Ads pasivos + donaciones de la comunidad                |

> **Supabase descartado**: pausa proyectos tras 7 días de inactividad — incompatible
> con clubs que usan la app una vez al mes.
>
> **BGG (BoardGameGeek)**: la carga de juegos es manual. El jugador puede pegar
> opcionalmente el link de BGG como referencia, pero todos los campos (nombre,
> jugadores, duración, complejidad) se ingresan a mano. No hay integración con
> la API de BGG en el MVP.
>
> **Seguridad admin**: las Firestore Security Rules del MVP son permisivas y
> confían en la oscuridad del `adminToken`. Suficiente para uso de club. Endurecer en Fase 2.
>
> **Límite de juegos por jugador**: configurable por el admin (default: sin límite).
> Evita que un jugador acapare el espacio de la wishlist con docenas de juegos.
> Si se alcanza el límite, el formulario del Paso 2 bloquea agregar más juegos
> y muestra un aviso claro.
>
> **Ludoteca Compartida**: feature postergada a Fase 2. No se implementa en el MVP.

---

## Arquitectura Multi-Tenant

Cada evento es completamente aislado. Un evento genera dos URLs únicas:

- **Jugadores** → `tuapp.com/event/BGJUN26` (impresa en el QR de la entrada)
- **Organizador** → `tuapp.com/admin/BGJUN26/a3f9...32chars` (solo el organizador)

No hay login. El token de 32 caracteres (`crypto.randomUUID()`) actúa como
contraseña del panel admin. Se genera una sola vez y nunca se expone públicamente.

El `shortCode` de 6 caracteres (ej. `BGJUN26`) es legible por humanos, permite
buscar el evento manualmente si el QR falla, y **se usa directamente como ID del
documento en Firestore** — no hay un `eventId` autogenerado separado.

---

## Flujo de Registro del Jugador (3 pasos)

El inventario de juegos se construye orgánicamente: cada inscripto carga los juegos
que trae. No hay carga previa de juegos por parte del organizador.

```
[ QR en la entrada ]
        │
        ▼
Paso 1: Datos básicos
  - Nombre / Apodo
  - Horario de llegada y salida (slider)
        │
        ▼
Paso 2: Juegos que traigo
  - Carga manual: nombre, min/max jugadores, duración estimada, complejidad
  - Campo opcional: link de BGG (solo como referencia, no se autocompleta)
  - Checkbox: "Sé explicarlo"
  - Puede agregar hasta N juegos (N = límite configurado por el admin; sin límite por defecto)
  - Si se alcanza el límite: botón "Agregar juego" deshabilitado con aviso
        │
        ▼
Paso 3: Wishlist
  - Lista de TODOS los juegos cargados hasta ahora por otros jugadores
  - Si no hay juegos de otros aún: muestra solo los propios pre-marcados
    + contador "Ya se inscribieron X / Y personas"
  - Por cada juego: toggle de 3 opciones → ❤️ Quiero jugarlo / 👍 Me sumo si falta / 👎 No me interesa
  - "No me interesa" es una señal explícita — no es lo mismo que no votar
  - Checkbox adicional: "También sé explicar este"
  - Sus propios juegos aparecen pre-marcados como "Quiero jugarlo" (puede cambiar)
        │
        ▼
  Submit → Firestore → redirige a /event/[code]/me (ticket)
```

**Nota**: la wishlist del paso 3 es un snapshot del momento de registro. Si después
llega alguien con un juego nuevo, el jugador puede volver a su ticket y actualizar
sus votos (ver sección "Re-acceso").

### Re-acceso del Jugador (volver después de registrarse)

Al cargar `/event/[code]`, la app **primero intenta leer `sessionStorage`** buscando
un `ticketCode` guardado para este evento. Si lo encuentra, redirige directamente a
`/event/[code]/me` sin pedirle nada al jugador.

Si no hay nada en `sessionStorage`, la app muestra dos opciones:

- **"Registrarme"** → flujo de 3 pasos normal
- **"Ya me registré — tengo mi código"** → campo para ingresar el `ticketCode`

Al ingresar el ticket code manualmente → Firestore query por `ticketCode` dentro
del evento → guarda en `sessionStorage` → redirige a `/event/[code]/me`.

El `ticketCode` se guarda en `sessionStorage` al finalizar el registro y también
al hacer re-acceso manual exitoso. Si el jugador accede desde otro dispositivo,
simplemente ingresa el código manualmente.

El `ticketCode` se muestra prominentemente al terminar el registro:

```
✅ ¡Listo! Tu código es: 7K3P2X
   Guardalo para volver a ver tus mesas
   [Copiar código]  [Captura de pantalla sugerida]
```

Desde `/event/[code]/me`, el jugador ve en tiempo real las mesas que tiene
actualmente asignadas (número de mesa, juego, horario, con quién juega). Esto
le permite decidir qué votar o desvotar al actualizar su wishlist.

El jugador ve el botón **"Actualizar wishlist"** que
muestra la wishlist completa con todas las opciones de voto:
- Juegos ya votados: muestran su voto actual — el jugador puede cambiarlo
- Juegos nuevos (agregados después de su `registeredAt`): marcados visualmente como "¡Nuevo!"
- Juegos donde su voto es vacío: aparecen sin selección

El jugador puede cambiar cualquier voto en cualquier momento desde este flujo.
No puede re-editar datos básicos (nombre, horario).
Submit reemplaza todo el campo `interests` en su documento de Firestore.

**Generación del ticketCode**: 6 caracteres del alfabeto `ACDEFGHJKLMNPQRTUVWXY3479`
(sin caracteres ambiguos: sin 0/O, sin 1/I/L, sin 2/Z, sin 5/S, sin 6/G, sin 8/B).
Verificar unicidad dentro del evento antes de guardar.

**Scoping del ticketCode**: el ticketCode nunca se busca globalmente — siempre se
consulta dentro de `/events/{shortCode}/players`. Dos eventos distintos pueden tener
el mismo ticketCode sin ningún conflicto: un jugador con código "7K3P2X" que ingresa
a `/event/BGJUN26` solo accede a su perfil dentro de ese evento. Sin shortCode del
evento no hay acceso posible.

---

## Ludoteca Compartida

> **Postergada a Fase 2 — no se implementa en el MVP.**

El admin podrá cargar juegos del club que aparecen en la wishlist de todos.
Sin dueño individual, importables desde CSV, reutilizables entre eventos.

---

## Modelo de Datos (Firebase Firestore)

### `/events/{shortCode}` (el shortCode ES el ID del documento en Firestore)
```
adminToken: string          // 32-char UUID, nunca en respuestas públicas
name: string
date: string                // "2026-06-15"
startTime: string           // "14:00"
endTime: string             // "22:00"
location: string
status: "setup" | "open" | "live" | "closed"
settings: {
  bufferMinutes: number     // default 15
  autoGenerate: boolean     // toggle para auto-proponer mesas
  maxPlayers: number | null // null = sin límite de inscriptos
  maxGamesPerPlayer: number | null // null = sin límite de juegos por jugador
}
```

### `/events/{shortCode}/games/{gameId}`
```
name: string
bggUrl: string | null       // link opcional a BGG, solo como referencia
minPlayers: number
maxPlayers: number
durationMinutes: number     // duración pesimista — el jugador la carga al registrarse
complexity: "light" | "medium" | "heavy"
ownerPlayerId: string       // playerId del jugador que lo trajo
ownerName: string
```

### `/events/{shortCode}/players/{playerId}`
```
name: string
arrivalTime: string         // "15:00"
departureTime: string       // "19:00"
registeredAt: Timestamp
ticketCode: string          // 6 chars alfanumérico sin ambiguos (ej. "7K3P2X")
bringGameIds: string[]      // juegos que este jugador trae
interests: {
  [gameId]: "must" | "casual" | "no"  // "no" = explícitamente no interesa
}
canExplain: string[]        // gameIds que sabe explicar
// assignedTableIds se calcula on-the-fly (igual que busyWindows)
```

### `/events/{shortCode}/tables/{tableId}`
```
tableNumber: number
gameId: string
gameName: string
startTime: string           // "16:00"
endTime: string             // "17:30"
explainerId: string         // requerido — el explicador siempre juega en la mesa
playerIds: string[]         // incluye al explainerId
status: "proposed" | "confirmed" | "in-progress" | "completed" | "cancelled"
isManuallyEdited: boolean
batchNumber: number         // en qué lote de auto-generación fue creada
```

> `busyWindows` y `assignedTableIds` por jugador NO se persisten en Firestore.
> Ambos se calculan on-the-fly filtrando las mesas del evento por `playerIds`.
> Evita tener que actualizar N documentos de jugadores cuando una mesa cambia de estado.

---

## Algoritmo de Generación de Mesas

### Inputs
- Lista de jugadores con: horario disponible, juegos que traen, interests (`must`/`casual`/`no`)
- Lista de juegos con: min/max players, duración, complejidad, explicador disponible
- `bufferMinutes` del evento (default 15)

### Priorización de juegos (orden de procesamiento)
1. Juegos con más votos `must` totales
2. En empate: mayor ratio `must / (must + casual)` — los votos `no` no suman ni restan aquí
3. En empate: menor `maxPlayers` (juegos más exclusivos primero, para asegurar cupo)

> Jugadores con voto `no` en un juego nunca son asignados a esa mesa, ni como relleno.

### Para cada juego candidato
1. Reunir jugadores con voto `must` disponibles en alguna ventana horaria común
2. Verificar que al menos uno del grupo tenga `canExplain` para este juego.
   Si ninguno puede explicarlo, descartar esta combinación — la mesa no se arma.
3. Si hay suficientes para `minPlayers` (con explicador incluido): armar la mesa
4. Completar hasta `maxPlayers` con jugadores `casual` disponibles en esa ventana
   (excluyendo los que tienen voto `no`)
5. Asignar como `explainerId` al jugador con `canExplain` que tenga la mayor
   ventana horaria libre. El explicador juega en la mesa.
6. Calcular `startTime` y `endTime` = `startTime + durationMinutes`
7. Marcar a los jugadores como ocupados en esa ventana (en memoria, no en Firestore)
8. Repetir hasta que no queden combinaciones válidas

### Ventana horaria común
- Intersección de `[arrivalTime, departureTime]` de todos los jugadores propuestos
- Debe ser ≥ `durationMinutes + bufferMinutes`
- Se busca la ventana más temprana posible (greedy)

### Reglas de negocio
- Un jugador puede estar en múltiples mesas (en horarios distintos)
- Si un juego no alcanza `minPlayers` con votos `must` + explicador disponible,
  se descarta en ese lote (puede reintentarse si llegan más jugadores)
- El algoritmo se re-ejecuta completo en cada nuevo registro si `autoGenerate: true`
- Las mesas con `isManuallyEdited: true` no se tocan en re-ejecuciones
  _(el admin puede ajustar una mesa a mano; si llega un jugador nuevo y el algoritmo
  re-corre, esa mesa queda intacta para no pisarle el trabajo al organizador)_
- **Limitación conocida**: con `autoGenerate: true` y muchos registros simultáneos
  el algoritmo puede ejecutarse en ráfaga. Aceptado en MVP; agregar debounce en Fase 2.

### Output
- Array de `TableProposal` guardadas en Firestore con `status: "proposed"`
- El admin las revisa y confirma/rechaza/edita desde el panel

---

## Pantallas y Rutas

| Ruta                              | Quién accede   | Descripción                                      |
|-----------------------------------|----------------|--------------------------------------------------|
| `/`                               | Organizador    | Landing + formulario de creación de evento       |
| `/event/[code]`                   | Jugador        | Registro (3 pasos) o re-acceso con ticketCode    |
| `/event/[code]/me`                   | Jugador        | Ticket: mesas asignadas actuales + botón actualizar wishlist |
| `/event/[code]/board`             | Todos          | Tablero proyectable (modo aeropuerto)            |
| `/admin/[code]/[adminToken]`      | Organizador    | Panel admin completo                             |
| `/admin/[code]/[adminToken]/tables` | Organizador  | Vista de mesas propuestas + editor               |
| `/admin/[code]/[adminToken]/players` | Organizador | Lista de jugadores registrados                   |

---

## Panel Admin — Funcionalidades

- Ver jugadores registrados en tiempo real
- Ver juegos cargados por los jugadores
- Ver mesas propuestas y confirmarlas / rechazarlas / editarlas
- Forzar re-generación de mesas
- Toggle `autoGenerate` on/off
- Cambiar `status` del evento (`setup` → `open` → `live` → `closed`)
- **Configurar capacidad máxima del evento** (`maxPlayers`): cuando se alcanza el límite,
  el formulario de registro muestra "Evento completo" y bloquea nuevas inscripciones
- **Configurar límite de juegos por jugador** (`maxGamesPerPlayer`): bloquea el Paso 2
  cuando el jugador ya agregó el máximo permitido
- Ver QR del evento para proyectar en la entrada
- _(Fase 2)_ Cargar juegos a la ludoteca compartida

---

## Tablero Proyectable (`/event/[code]/board`)

Inspirado en tableros de aeropuerto (salidas/llegadas). Muestra:
- Lista de mesas confirmadas con: número de mesa, juego, jugadores, horario, estado
- Se actualiza en tiempo real via Firestore `onSnapshot`
- Diseño optimizado para proyector: fuente grande, alto contraste
- Sin autenticación requerida — cualquiera puede verlo

---

## PWA / Mobile

- `manifest.json` configurado para instalación desde móvil
- Íconos y splash screen
- El flujo de registro (3 pasos) está diseñado mobile-first
- Sin modo offline (requiere Firestore en tiempo real)

---

## Monetización

- **Google AdSense**: banners no intrusivos en páginas de jugadores (no en el tablero proyectable ni en el panel admin)
- **Cafecito / Ko-fi**: botón de donación en el footer y en la página de confirmación post-registro

---

## Fases de Desarrollo

### Fase 1 — MVP
- Creación de eventos
- Registro de jugadores (3 pasos) con carga manual + link BGG opcional
- Re-acceso automático via sessionStorage + manual via ticketCode (cross-device)
- Wishlist con 3 opciones: must / casual / no me interesa
- Edición de votos post-registro (wishlist completa)
- Configuración de capacidad máxima y límite de juegos por jugador
- Generación automática de mesas (requiere explicador en la mesa)
- Panel admin básico
- Tablero proyectable

### Fase 2 — Club Features
- Ludoteca Compartida (juegos del club, importación CSV)
- Integración BGG API: autocomplete de nombre, jugadores, duración y complejidad al cargar un juego
- Mesas sin explicador: pantalla para que alguien se ofrezca
- Explicadores externos (no juegan, solo explican)
- Debounce en auto-generación de mesas
- Escáner QR en el panel admin para registrar entrada de jugadores en el evento
- Historial de eventos por club
- Reutilización de ludoteca entre eventos
- Estadísticas (juegos más jugados, jugadores frecuentes)
- Notificaciones push (mesa confirmada, nueva mesa disponible)

### Fase 3 — Monetización avanzada
- Plan Pro para clubs (sin ads, features extra)
- Exportación de datos (PDF del evento, CSV de asistencia)
