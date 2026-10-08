import { VENUS_WHISPER_MOD } from './venusWhisper'
import { CONTINUING_SEMESTERS, CONTINUING_SEMESTERS_MOD } from './continuingSemestersMod'
import { PHOTO_LOADERS, photoLoaderOf } from './photoLoader'
import { loaderOptionId, PHOTO_FEATURE_MOD, type PhotoSwitches } from './photoSwitches'
import { MEANWHILE_MOD } from './meanwhile'
import { CITY_LIFE_LOCATIONS_MOD, CITY_LIFE_JOBS_MOD } from './cityLife'
import type { PlaythroughRecord } from './types'
import { PLAYTHROUGH_NAMES_MOD } from './playthroughNames'
import { PLOT_TWIST_DEF } from './plotTwists'
import { TEXT_REGENERATION_MOD } from './textRegeneration'
import { SOUNDTRACK_DEF } from './soundtracks'

/**
 * The community mods built into this copy of the game, and the switches a player turns them on
 * and off with. Every mod's code is always in the build; a switch decides whether that code
 * acts. A mod registers here once, and asks {@link modOn} wherever it would do something.
 *
 * This is not Venus Dev's own build, and nothing found in it should be reported to him as if it
 * were: the main menu and the log both say so (`buildLine`, `modNames`).
 */

/** The build these mods ship in, as the main menu and the log name it. */
export const BUILD = { name: 'Venus Extracurriculars', version: '0.1.0' } as const

/**
 * When a mod's switch takes effect.
 *
 * - `anytime`: read where the mod acts, so it can be turned on or off whenever the player likes.
 * - `playthrough`: fixed when a playthrough starts, for a mod whose saves depend on it. The
 *   switch is what a new playthrough gets; one already started keeps what it started with.
 */
export type ModScope = 'anytime' | 'playthrough'

/** One yes-or-no setting of a mod's own. */
export interface ModOption {
  id: string
  label: string
  /** What the other position does, in a line. */
  hint: string
  default: boolean
  /**
   * Options of one mod that share a group are one choice: one of them is on at a time. Turning
   * one on turns the others off, and the one that is on stays on until another is picked. The
   * Mods screen shows them together, under the group's own label and hint.
   */
  group?: string
}

/** What a group of options is, shown once above them. */
export interface ModOptionGroup {
  id: string
  label: string
  hint: string
}

export interface ModDef {
  /** Stable, lower case with dashes: it is written to disk, so it never changes once shipped. */
  id: string
  name: string
  author: string
  version: string
  scope: ModScope
  /** Whether the mod is on for a player who has never touched its switch. */
  defaultOn: boolean
  /** What the mod does, in a sentence or two. */
  blurb: string
  /** What switching it off leaves alone, where a player might fear otherwise. */
  offNote?: string
  /** Mods this one cannot act without, by id. */
  requires?: readonly string[]
  options?: readonly ModOption[]
  /** The groups its options name, by id. */
  optionGroups?: readonly ModOptionGroup[]
}

export { CONTINUING_SEMESTERS }
export const PHOTO_FEATURE = 'photo-feature'

/** Every mod in this build, in the order the Mods screen lists them. */
export const MODS: readonly ModDef[] = [
  CONTINUING_SEMESTERS_MOD,
  {
    ...PHOTO_FEATURE_MOD,
    id: PHOTO_FEATURE,
    version: '1.1.3'
  },
  {
    id: PLAYTHROUGH_NAMES_MOD,
    name: 'Playthrough renaming',
    author: 'Maestro Leeds',
    version: '1.8.2',
    scope: 'anytime',
    defaultOn: true,
    blurb: 'Give each saved playthrough a name from Load Game.',
    offNote: 'Names remain saved and travel with backups. Turn this on to display and edit them.'
  },
  PLOT_TWIST_DEF,
  {
    id: TEXT_REGENERATION_MOD, name: 'Text Regeneration', author: 'Maestro Leeds', version: '1.0.0',
    scope: 'anytime', defaultOn: true,
    blurb: 'Regenerate the whole latest phone reply, including every message in it.',
    offNote: 'Existing messages and reply checkpoints stay saved. Regeneration uses your configured AI.'
  },
  {
    id: MEANWHILE_MOD, name: 'Meanwhile conversations', author: 'Maestro Leeds', version: '1.0.0',
    scope: 'anytime', defaultOn: true,
    blurb: 'Watch optional two-NPC conversations from a dedicated Meanwhile menu.',
    offNote: 'Saved replays stay in the playthrough. Watching changes no relationships, memories, or time.'
  },
  { id: CITY_LIFE_LOCATIONS_MOD, name: 'City Life locations', author: 'Maestro Leeds', version: '1.0.0',
    scope: 'playthrough', defaultOn: true,
    blurb: 'Lucky Strike Lanes, Starlight Roller Rink, and Purr & Pour Cat Café, with day/night backgrounds and NPC visits.',
    offNote: 'Chosen when a playthrough starts. Existing playthroughs keep their locations.' },
  { id: CITY_LIFE_JOBS_MOD, name: 'City Life jobs', author: 'Maestro Leeds', version: '1.0.0',
    scope: 'playthrough', defaultOn: true, requires: [CITY_LIFE_LOCATIONS_MOD],
    blurb: 'Part-time jobs for the player and NPCs at the three City Life venues.',
    offNote: 'Requires City Life locations. Existing playthroughs keep their jobs and schedules.' },
  {
    id: 'breakthrough', name: 'Breakthrough', author: 'maestromods', version: '1.0.0',
    scope: 'anytime', defaultOn: true,
    blurb: 'Build spirit with each character and spend a full bar for a strong, grounded narrative opportunity.',
    offNote: 'Keeps saved spirit and outcomes. Stops earning, activation, and extra continuity prompts.'
  },
  SOUNDTRACK_DEF,
  {
    id: VENUS_WHISPER_MOD, name: 'The Venus Whisper', author: 'Maestro Leeds', version: '1.0.0',
    scope: 'anytime', defaultOn: true,
    blurb: 'An anonymous Wednesday gossip column, delivered weekly with unread alerts, public comments, replies and mentions.',
    offNote: 'Keeps the secret columnist and archive, including across continued semesters. Stops new issues, comments and gossip context.'
  },
  {
    id: 'story-memory', name: 'Story Memory', author: 'maestromods', version: '1.0.0',
    scope: 'anytime', defaultOn: true,
    blurb: 'Remember lasting story developments and find relevant past encounters with a local SQLite index.',
    offNote: 'Keeps facts and corrections in saves. Stops extraction and extra recall. Native character notes stay available.'
  }
]

/**
 * What the player has set, as `data/mods.json` holds it. A mod or an option that is not in
 * either map is at its default, so a mod added by an update needs nothing written for it.
 */
export interface ModSwitches {
  /** By mod id. */
  on: Record<string, boolean>
  /** By {@link optionKey}. */
  options: Record<string, boolean>
}

export const NO_SWITCHES: ModSwitches = { on: {}, options: {} }

/** The key one mod's option is stored under. */
export function optionKey(modId: string, optionId: string): string {
  return `${modId}:${optionId}`
}

export function modById(id: string, mods: readonly ModDef[] = MODS): ModDef | undefined {
  return mods.find((mod) => mod.id === id)
}

/** Where the player has left a mod's own switch, whatever the mods it requires are doing. */
export function switchedOn(
  switches: ModSwitches,
  id: string,
  mods: readonly ModDef[] = MODS
): boolean {
  const mod = modById(id, mods)
  if (!mod) return false
  return switches.on[id] ?? mod.defaultOn
}

/**
 * The first mod `id` requires that is not on, or `null`. A switch left on stays on while what
 * it requires is off, so turning that back on brings the mod back with it.
 */
export function missingRequirement(
  switches: ModSwitches,
  id: string,
  mods: readonly ModDef[] = MODS,
  seen: readonly string[] = []
): ModDef | null {
  const mod = modById(id, mods)
  for (const needed of mod?.requires ?? []) {
    const required = modById(needed, mods)
    // A requirement this build does not carry is never met, and has no name to show: the mod
    // names itself as the thing that cannot run.
    if (!required) return mod ?? null
    // A circle of requirements is a mistake in the list, not a reason to hang.
    if (seen.includes(needed)) continue
    if (!switchedOn(switches, needed, mods)) return required
    const further = missingRequirement(switches, needed, mods, [...seen, id])
    if (further) return further
  }
  return null
}

/** Whether a mod is on for the game as a whole: its switch, and everything it requires. */
function globallyOn(switches: ModSwitches, id: string, mods: readonly ModDef[]): boolean {
  return switchedOn(switches, id, mods) && missingRequirement(switches, id, mods) === null
}

/**
 * **The one question a mod asks before it acts.**
 *
 * An `anytime` mod is on where its switch and its requirements are. A `playthrough` mod asked
 * about a playthrough answers from that playthrough's own record, which named the mods it
 * started with; asked with no record, it answers what a new playthrough would get. A record
 * written before this list existed names none, so no `playthrough` mod is on for it.
 */
export function modOn(
  switches: ModSwitches,
  id: string,
  record?: Pick<PlaythroughRecord, 'mods'> | null,
  mods: readonly ModDef[] = MODS
): boolean {
  const mod = modById(id, mods)
  if (!mod) return false
  if (mod.scope === 'playthrough' && record) return record.mods?.includes(id) ?? false
  return globallyOn(switches, id, mods)
}

/** Where one of a mod's options stands. An option nobody declared is off. */
export function optionOn(
  switches: ModSwitches,
  modId: string,
  optionId: string,
  mods: readonly ModDef[] = MODS
): boolean {
  const option = modById(modId, mods)?.options?.find((o) => o.id === optionId)
  if (!option) return false
  return switches.options[optionKey(modId, optionId)] ?? option.default
}

export function withMod(switches: ModSwitches, id: string, on: boolean): ModSwitches {
  return { ...switches, on: { ...switches.on, [id]: on } }
}

export function withOption(
  switches: ModSwitches,
  modId: string,
  optionId: string,
  on: boolean,
  mods: readonly ModDef[] = MODS
): ModSwitches {
  const options = modById(modId, mods)?.options ?? []
  const group = options.find((o) => o.id === optionId)?.group
  if (!group) {
    return { ...switches, options: { ...switches.options, [optionKey(modId, optionId)]: on } }
  }
  // One of a group is always picked: turning the picked one off picks nothing else.
  if (!on) return switches
  const picked = Object.fromEntries(
    options
      .filter((o) => o.group === group)
      .map((o) => [optionKey(modId, o.id), o.id === optionId])
  )
  return { ...switches, options: { ...switches.options, ...picked } }
}

/**
 * The `playthrough` mods a playthrough starting now gets, for its record to name. Empty in a
 * build with none, and the record then carries no list at all.
 */
export function playthroughMods(
  switches: ModSwitches,
  mods: readonly ModDef[] = MODS
): string[] {
  return mods
    .filter((mod) => mod.scope === 'playthrough' && globallyOn(switches, mod.id, mods))
    .map((mod) => mod.id)
}

/** The mods that are on for the game as a whole, in list order. */
export function modsOn(switches: ModSwitches, mods: readonly ModDef[] = MODS): ModDef[] {
  return mods.filter((mod) => globallyOn(switches, mod.id, mods))
}

/** `"Continuing Semesters 0.2.0"`, or several joined with commas: the log's list. */
export function modNames(mods: readonly ModDef[] = MODS): string {
  if (mods.length === 0) return 'no mods'
  return mods.map((mod) => `${mod.name} ${mod.version}`).join(', ')
}

/**
 * The line the main menu prints under the version, so a screenshot of the menu says whose build
 * this is. It counts the mods that are on rather than naming them; the Mods screen names them.
 */
export function buildLine(switches: ModSwitches, mods: readonly ModDef[] = MODS): string {
  const count = modsOn(switches, mods).length
  return `${BUILD.name} ${BUILD.version} · ${count} ${count === 1 ? 'mod' : 'mods'} on · unofficial`
}

/**
 * What a stored value holds of the switches' shape, for a file a player may have edited by
 * hand. Ids this build does not know are kept: a mod a later build adds, or one an earlier
 * build had, keeps its setting across the builds between.
 */
export function cleanSwitches(value: unknown): ModSwitches {
  const flags = (from: unknown): Record<string, boolean> => {
    if (typeof from !== 'object' || from === null || Array.isArray(from)) return {}
    return Object.fromEntries(
      Object.entries(from).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
    )
  }
  const held = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return { on: flags(held.on), options: flags(held.options) }
}

/**
 * What the switches add to the on-disk shapes, added from outside them the way `termTypes.ts`
 * adds terms: the field means exactly what it would inside `types.ts`, and an update that
 * replaces that file carries nothing of this away.
 */
declare module './types' {
  interface PlaythroughRecord {
    /**
     * The `playthrough` mods this playthrough started with, by id. Absent where none were on,
     * and on every record written before the list existed.
     */
    mods?: string[]
  }
}

/**
 * Photo Feature's switches as this build's Mods screen has them: the mod's own module reads
 * these wherever it acts, so the build only has to hand them over (`setPhotoSwitches`), in main
 * when the switches are read or written and in the renderer whenever one moves.
 */
export function photoSwitchesOf(switches: ModSwitches): PhotoSwitches {
  const loader =
    PHOTO_LOADERS.find((l) => optionOn(switches, PHOTO_FEATURE, loaderOptionId(l.value)))?.value ??
    'bunny'
  return {
    on: modOn(switches, PHOTO_FEATURE),
    photos: optionOn(switches, PHOTO_FEATURE, 'photos'),
    explicit: optionOn(switches, PHOTO_FEATURE, 'explicit'),
    loader
  }
}

/**
 * Photo Feature's options for a player who set them in Settings, where they lived before this
 * build: "No DM and feed photos" and "Loading animation". Read only where the Mods screen has
 * never stored them, so what he picked there carries over until he moves them here.
 */
export function withPhotoSettingsCarried(
  switches: ModSwitches,
  settings: { photos?: boolean; photoLoader?: string }
): ModSwitches {
  let carried = switches
  if (settings.photos === false && !(optionKey(PHOTO_FEATURE, 'photos') in switches.options)) {
    carried = withOption(carried, PHOTO_FEATURE, 'photos', false)
  }
  const loaderKeys = PHOTO_LOADERS.map((l) => optionKey(PHOTO_FEATURE, loaderOptionId(l.value)))
  if (settings.photoLoader && !loaderKeys.some((key) => key in switches.options)) {
    carried = withOption(
      carried,
      PHOTO_FEATURE,
      loaderOptionId(photoLoaderOf(settings.photoLoader)),
      true
    )
  }
  return carried
}
