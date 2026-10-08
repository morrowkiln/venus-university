# Mods in this build

This branch is a proposal for how the community mods share one build: every mod's code is
always in the game, and a switch decides whether it acts. Players turn mods on and off from
**Mods** on the main menu; nothing is chosen at install time.

The frame alone, with no mods, is the `extracurriculars-core` branch, on the game as Venus Dev
released it. This branch is every mod together:

| Mod | Author | Switch | Notes |
| --- | --- | --- | --- |
| Continuing Semesters | morrowkiln | any time | below |
| Photo Feature | naudh1r | any time | below |
| Playthrough renaming | Maestro | any time | names stay in storage and backups while off |
| Plot Twist | Maestro | any time | [notes](docs/mods/plot-twist.md) |
| Text Regeneration | Maestro | any time | [notes](docs/mods/text-regeneration.md) |
| Meanwhile conversations | Maestro | any time | [notes](docs/mods/meanwhile-conversations.md) |
| City Life locations | Maestro | per playthrough | [notes](docs/mods/city-life.md) |
| City Life jobs | Maestro | per playthrough, needs locations | [notes](docs/mods/city-life.md) |
| Breakthrough | Maestro | any time | [notes](docs/mods/breakthrough.md) |
| Custom soundtracks | Maestro | any time | [notes](docs/mods/custom-soundtracks.md) |
| Story Memory | Maestro | any time | [notes](docs/mods/story-memory.md) |

Maestro's mods each came in as their own pull request on the frame and are merged here as he
wrote them. Continued semesters retain their saved Story Memory, Meanwhile replays,
Breakthrough meters/outcomes and active Plot Twist, including while those switches are off.
Dates are rebased and old events keep their original semester labels. See the
[carryover policy](docs/mods/semester-carryover.md) and `src/shared/modTermCarry.ts`.

## The three things a mod does

**1. Register** in `MODS`, in `src/shared/mods.ts`:

```ts
{
  id: 'city-life-locations',        // written to disk: never changes once shipped
  name: 'City Life locations',
  author: 'Maestro Leeds',
  version: '1.7.1',
  scope: 'playthrough',             // or 'anytime', see below
  defaultOn: true,
  blurb: 'Three new places on the map.',
  requires: [],                     // ids of mods this one cannot act without
  options: [{ id: 'some-option', label: '…', hint: '…', default: true }]
}
```

That is all the Mods screen, the main menu's count and the log need.

Options that are one choice among several share a `group`, and the mod names the group in
`optionGroups`. One option of a group is on at a time: turning one on turns the others off, and
the one that is on stays on until another is picked. The Mods screen shows a group as one box,
with the group's label and hint once and a row for each choice. They are still plain on/off
values in `data/mods.json`.

```ts
options: [
  { id: 'loader-bunny', label: 'Bunny hop', hint: '', default: true, group: 'loader' },
  { id: 'loader-dots', label: 'Typing dots', hint: '', default: false, group: 'loader' }
],
optionGroups: [{ id: 'loader', label: 'Loading animation', hint: 'The animation shown while…' }]
```

**2. Ask before acting**, wherever the mod would do something:

```ts
// in a component
const on = useModOn('city-life-locations', record)
// anywhere else in the renderer
if (modIsOn('city-life-locations', record)) { … }
// in main or shared code, with the switches in hand
modOn(switches, 'city-life-locations', record)
```

An option is read the same way: `useModOption(modId, optionId)` or `optionOn(switches, …)`.

**3. Keep its data when it is off.** Off stops a mod acting. It never deletes what the mod
wrote, so a save always loads and switching back on finds everything where it was.

## The two kinds of switch

- **`anytime`**: read where the mod acts. The player can flip it whenever they like. Use it
  for anything a save does not depend on.
- **`playthrough`**: fixed when a playthrough starts. The playthrough's record names the mods
  it started with (`record.mods`), and `modOn(…, record)` answers from that, whatever the
  switch says later. The switch is what a *new* playthrough gets. Use it for a mod that changes
  the game's rules or adds things a save refers to.

Pass the playthrough's record whenever there is one. With none, a `playthrough` mod answers
what a new playthrough would get. A record written before this list existed names no mods, so
no `playthrough` mod is on for it.

A mod whose requirement is off is off too, and comes back when the requirement does; its own
switch is left as the player set it.

## Where it is stored

- `data/mods.json`: the player's switches and options, `{ schemaVersion, on, options }`. A mod
  or option missing from it is at its default, so adding a mod needs no migration. Ids this
  build does not know are kept.
- `playthrough.json`: `mods`, the `playthrough` mods that playthrough started with.

## Where the code is

| File | What it is |
| --- | --- |
| `src/shared/mods.ts` | The list, the switches' shape and every rule above. |
| `src/main/services/modsService.ts` | Reads and writes `data/mods.json`. |
| `src/renderer/stores/modsStore.ts` | The switches in the renderer, and the hooks. |
| `src/renderer/views/ModsModal.tsx` | The Mods screen. |
| `src/renderer/mods/hooks.ts` | The hook points (below). |
| `src/renderer/mods/index.ts` | Registers every mod's hooks at boot. |
| `test/mods.test.ts` | The rules, tested against a list with every shape of mod. |
| `src/renderer/mods/hooks.ts` | The hook points (prototype, below). |
| `src/renderer/mods/index.ts` | Registers every mod's hooks at boot. |

## How Continuing Semesters uses it

Its entry in `MODS` is `CONTINUING_SEMESTERS_MOD` from `src/shared/continuingSemestersMod.ts`,
so its name, text and options live with the mod and `mods.ts` only lists it. That is the
convention: each mod keeps its own entry in a file of its own.

It is `anytime`. Off, the ending screen and Load Game stop offering the next semester (two
checks: `GameView.tsx`, `LoadGameModal.tsx`). A semester or a break already started keeps
working, because the code is still there. It has three options: one skips the break between
semesters as it opens (`BreakView.tsx`), one keeps seniors from graduating, and one turns the
Load Game offer off alone.

The seniors option shows how a rule in shared code reads a switch without holding any: the
rule keeps a flag (`setSeniorsGraduate` in `shared/term.ts`), and `modsStore.ts` sets it at
boot and whenever a switch moves.

## How Photo Feature uses it

It is `anytime`, and it checks its own switch: the mod keeps its switches in
`src/shared/photoSwitches.ts` and asks there wherever it acts, so the build only hands them
over. That is three places:

- `photoSwitchesOf(switches)` in `mods.ts` turns the Mods screen's switches into the mod's own.
- `modsStore.ts` passes them to `setPhotoSwitches` at boot and whenever a switch moves.
- `modsService.ts` does the same in main, when the switches are read or written. Main keeps its
  own copy because body details are drawn there.

Its entry in `MODS` is `PHOTO_FEATURE_MOD` from `photoSwitches.ts`, with the version added, so
its name, text and options come from the mod.

Off, nobody sends a new photo, posts get no new comments, body details are not used and likes
are the game's own. Photos, galleries and comments already made are hidden, not deleted. Its
options:

- **Photo generation**: off, no new photos are made and characters are not told they can send
  one. Photos already sent stay visible.
- **Explicit photos**: off, nobody sends an undressed photo and ones already sent stay covered.
  The game's own "No NSFW images" turns them off too.
- **Loading animation**: a group of three, Bunny hop, Dot shimmer and Typing dots.

These used to be in the game's Settings. `modsService.ts` carries a player's old choice over
(`withPhotoSettingsCarried`) until the Mods screen stores its own.

Option ids are written to disk, so they never change: `photos`, `explicit`, `loader-bunny`,
`loader-shimmer`, `loader-dots`. `test/photoHooks.test.ts` fails if the handover in `modsStore.ts`
or `modsService.ts` goes missing.

## Hook points

A switch decides whether a mod acts. Hook points decide **where** it acts without editing the
game there. At each place mods commonly add to, the game asks once, in one line of its own
file; a mod answers from its own files. Two mods adding to the same place then never touch the
same lines, and neither touches the game's code at that place.

Everything is in `src/renderer/mods/hooks.ts`. The game's side, at each place:

```ts
...promptLines('dm', { character, info, state })   // in textingPrompt.ts
afterDmReply({ charId, character, reply: data })    // in textingLoop.ts
```

A mod's side, once, in its own file:

```ts
registerHooks(PHOTO_FEATURE, {
  prompts: { dm: { lines: (ctx) => photoLines(ctx.character, ctx.info, ctx.state) } },
  afterDmReply: ({ charId, character, reply }) => void sendPhoto(charId, character, reply)
})
```

and one line in `src/renderer/mods/index.ts` (`import './photoFeature'`), which `App.tsx`
imports at boot.

### The rules

- **Only mods that are on are asked.** The mods store hands the hooks its switches
  (`setHookRules`), so a mod that is off is never called and the game runs as it would without
  it. A mod rarely needs to check its own switch at a hook.
- **Mods are asked in the order `MODS` lists them**, whatever order they registered in.
- **Adding to the game, not replacing it.** Lines, fields and events from every mod are all
  used. Where only one answer can win (likes), the first mod that answers decides and the game's
  own roll is the fallback.

### The hook points

| Hook | Where the game asks | What a mod can do |
| --- | --- | --- |
| `prompts.dm` | `textingPrompt.ts` | Add lines to her DM prompt, and fields to its reply |
| `prompts['slot-posts']` | `slotIntroPrompt.ts` | Add lines about status posts, and fields to each post |
| `prompts.character` | `characterPrompt.ts` | Add lines and fields to character generation |
| `dmHistoryNote` | `textingPrompt.ts` | Add a note after a DM in the history the prompt quotes |
| `characterFromDraft` | `characterPrompt.ts` | Fill fields of a generated character from the reply |
| `afterDmReply` | `textingLoop.ts` | Act after her reply in a DM has landed |
| `playerActs` | `gameLoop.ts` (`submitAction`), `loop/hangouts.ts` | Act when the reader commits to something |
| `gameEntered` | `gameLoop.ts` (`enterGame`) | Act when a game is entered, new or loaded |
| `fileFeedPost` | `loop/feed.ts` | Change a slot post before it is filed, or file it later itself (`held`) |
| `postLikes` | `loop/feed.ts`, `NewGameView.tsx` | Decide likes on ending, stranger and winter posts |
| `postVisible` | `feedView.ts`, `loop/feed.ts`, `ContactPage.tsx` | Keep a post off the feed for now |

A hook point is added where mods actually meet, not ahead of need. Once mods use one, it stays
as it is: renaming it or changing what it passes breaks them. A change that is needed goes in
as a new hook beside the old one.

### Photo Feature on hooks

All of Photo Feature's prompt, event and feed additions are in `src/renderer/mods/photoFeature.ts`.
In the ten game files involved, lines naming Photo Feature went from 67 to 4: two for its gallery
on `ContactPage.tsx` (screens have no hook points yet) and two that are Continuing Semesters'
own photo carry-over in `NewGameView.tsx`.

Off, three things differ from before hooks, all because a mod that is off is not asked: the
photo fields leave the reply's schema rather than being asked for empty; old DMs lose their
"[attached a photo]" note in the history the prompt quotes; and a render left unfinished from
an earlier session is settled only once the mod is on again.

### Not covered yet

- Screens: a mod's own panels, menu entries and editor fields.
- Main process: IPC, protocols, services, settings and character rules.
- Saves: a mod's own fields in a save, and what carries into the next semester.

Both are still direct edits, as before.

### Tests

- `test/modHooks.test.ts`: only mods that are on are asked, in list order; likes fall back to
  the game's own; a post a mod holds is not passed on.
- `test/photoHooks.test.ts`: every hook line is still in the game's files after a merge, and
  Photo Feature is still registered.

## Not decided yet

The independent [Meanwhile conversations port](docs/mods/meanwhile-conversations.md)
documents its menu, replay storage, generation boundary, and future memory integration.
The standalone [Breakthrough port](docs/mods/breakthrough.md) documents its rules, save
ownership, loop hooks, failure recovery, and future memory-index integration.
The independent [Story Memory source mod](docs/mods/story-memory.md) documents its SQLite
index, optional save data, editor, prompt budgets and integration with the other source ports.

- The build's name and version (`BUILD` in `mods.ts`).
- Whether `data/mods.json` goes into the game's own backup; it does not today.
- How a mod that patches the built code, rather than the source, reads its switch.
- Whether hook points go into the framework, and which ones.

The Venus Whisper's newsletter, anonymity boundary, save shape and integration points are documented in [docs/mods/venus-whisper.md](docs/mods/venus-whisper.md).
