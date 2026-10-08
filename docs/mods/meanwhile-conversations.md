# Meanwhile conversations source port

Meanwhile is an independent, anytime switch in Mods. When enabled, Bunnyboard
has a **Meanwhile** tab. Character profiles are unchanged. Select a recent encounter
to watch two NPCs talk, then use Previous and Next to read it. There is no player input,
time advance, relationship reward, or new scene added to the player's history.

Location IDs are translated to their actual background filenames (for example, Eastern
Buffet uses `asian_food`). Installed City Life artwork is supported for `bowling_alley`,
`roller_rink`, and `cat_cafe`, without requiring City Life for native locations. Encounters
have no time/weather stamp, so the viewer uses day artwork. Missing art leaves a themed
background; switching to valid art resets a failed image's visibility. Portraits refresh
when their character assets become available. Generation displays **Loading their conversation…**.

Class encounters use their captured course title and matching course category to choose
activity-appropriate existing art: PE uses the gym by default, swimming the pool, strength
training the weight room, running the track, and practical cooking/art/music/lab classes
their respective rooms. Rock climbing uses the gym because no climbing-wall background
ships with the game. Optional bowling/rink art falls back to the gym if unavailable. Cached
replays receive this fix immediately; a later semester reusing a course code cannot substitute
its new course's category for an old replay with a different title. No additional AI call is used.

## Where encounters come from

The base game's NPC relationship system already records class, dorm, and hangout
encounters. This port reads the latest encounter per pair from `npcRelationships`;
it does not roll a second daily event or increase their frequency. Both names must
be known. Ungenerated encounters remain available for seven game days. Up to 50
generated conversations can be replayed, with future entries hidden after a rewind.

The native encounter remains the canonical event and can influence ordinary roleplay
through the game's existing NPC relationship context. The viewer's invented wording
is an optional dramatization, not a secret that the player or other NPCs now know.

## Generation and cost

Only clicking an unwritten encounter makes an AI request, using the configured model.
Replays use the saved copy. Each request contains the event and bounded public personality,
traits, likes, and dislikes for its two participants. It contains no player transcript,
relationship memories, or Story Memory retrieval. The response must contain 6–12 lines,
both participants must speak, and each line is limited to 400 characters.

Invalid responses and failed saves leave the cache unchanged and offer Retry. Leaving
the viewer, changing tabs, or disabling the mod cancels its request. Before entering the native save queue, the request checks
the active playthrough, load counter, date, time, mod switch, and event. A disk write that
has already begun may finish after closing; it only stores the optional replay. Its result
will not update a different active game. No AI request is made when the mod is disabled.

## Code map

| File | Responsibility |
| --- | --- |
| `src/shared/meanwhile.ts` | Encounter discovery, validation, stable event IDs, bounded replay cache. |
| `src/renderer/prompts/meanwhilePrompt.ts` | Small two-person request and structured response schema. |
| `src/renderer/stores/meanwhile.ts` | Generation, stale-request checks, replay reuse. |
| `src/renderer/stores/loop/saves.ts` | `persistMeanwhileScene`, using the existing serialized save queue. |
| `src/renderer/views/MeanwhileModal.tsx` | Embedded read-only Bunnyboard page, cancellation, retry, navigation. |
| `src/renderer/views/meanwhileImages.ts` | Timetable/outing location-to-art mapping, native background resolution and optional City Life/custom art. |
| `src/renderer/vu_styles/Meanwhile.css` | Native day/night paper palette, responsive layout. |
| `src/renderer/views/BunnyboardModal.tsx`, `src/renderer/stores/bunnyboardStore.ts` | Optional rail tab and transient page routing. |
| `src/preload/api.d.ts`, `index.ts`, `src/main/ipc.ts`, `src/web/bridge.ts` | Typed `completeMeanwhile` API, cancellation in desktop and browser builds. |
| `src/shared/types.ts`, `saveRules.ts`, `src/renderer/stores/gameStore.ts` | Optional `GameSave.exNpcWatch`, load/save normalization. |
| `src/shared/mods.ts` | Independent anytime switch; no requirements. |
| `test/meanwhile.test.ts` | Validation, bounded imports, rewind visibility, save conservation, failures and stale results. |

## Saves and future memory integration

`exNpcWatch` is optional and defaults to `{ version: 1, scenes: [] }`. Old saves remain
valid. Turning the feature off hides its UI and stops generation while retaining its data.
Malformed optional replay entries are dropped rather than invalidating the whole save.
This does not migrate older installer-specific replay formats or rewrite user saves.

There is no SQLite dependency or database in this port. A future memory index should
index native encounters as their own canonical event type, and **exclude `exNpcWatch`
dialogue from witnessed/player memories**. If searchable spectator replays are later
desired, give them a separate noncanonical source and reconcile their stable IDs on
load, rewind, and eviction. Do not inject them into ordinary scene or texting prompts.

## Validation

Run `npm run typecheck`, `npm test`, `npm run build`, and `npm run build:web`.
For UI review, check Bunnyboard → Meanwhile in both palettes, a long dialogue line, Previous,
Next, replay, Retry, closing during generation, and a 4:3 viewport. A live provider's
prose quality still depends on its model; deterministic tests stub generation and disk writes.
