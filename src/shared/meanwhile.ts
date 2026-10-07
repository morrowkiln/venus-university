import type { NpcRelationshipMap, NpcEncounter } from './npcRelationships'
import type { Character, CharInfo, ClassEntry } from './types'
import { locationLabel } from './locations'
import { normalizeTermOrigin, type TermOrigin } from './termOrigin'

export const MEANWHILE_MOD = 'meanwhile-conversations'
export interface MeanwhileLine { speaker: string; text: string }
export interface MeanwhileResponse { lines: MeanwhileLine[] }
export interface MeanwhileScene {
  id: string
  date: number
  participants: [string, string]
  title: string
  where: string
  positive: boolean
  ref: string
  kind: NpcEncounter['kind']
  lines: MeanwhileLine[]
  origin?: TermOrigin
  participantNames?: Record<string, string>
}
/** Optional dramatizations, not witnessed events or authoritative story memories. */
export interface MeanwhileStore { version: 1; scenes: MeanwhileScene[] }
export interface MeanwhileContext {
  date: number
  characters: Record<string, Character>
  charInfo: Record<string, CharInfo>
  classes: Record<string, ClassEntry>
  npcRelationships: NpcRelationshipMap
  exNpcWatch: MeanwhileStore
}

export function validateMeanwhile(data: unknown, participants: readonly string[]): MeanwhileLine[] {
  const lines = (data as MeanwhileResponse | null)?.lines
  if (!Array.isArray(lines) || lines.length < 6 || lines.length > 12 ||
      lines.some(line => !line || !participants.includes(line.speaker) || typeof line.text !== 'string' ||
        !line.text.trim() || line.text.length > 400) ||
      !participants.every(id => lines.some(line => line.speaker === id))) {
    throw Error('The response was not a complete two-character conversation. Try again.')
  }
  return lines.map(line => ({ speaker: line.speaker, text: line.text.trim() }))
}

/** Bound imported/cache data; malformed records cannot make the viewer fail to load. */
export function normalizeMeanwhile(value: unknown): MeanwhileStore {
  const kept: MeanwhileScene[] = []
  const scenes = (value as MeanwhileStore | null)?.scenes
  if (Array.isArray(scenes)) for (const scene of scenes.slice(-50)) {
    const origin = normalizeTermOrigin(scene?.origin)
    if (!scene || typeof scene.id !== 'string' ||
      (scene.id.length > 500 && !(/^term:\d{1,4}:/.test(scene.id) && scene.id.length <= 510)) ||
      !Number.isSafeInteger(scene.date) || scene.date < -100000 || (scene.date < 0 && !origin) || !Array.isArray(scene.participants) ||
      scene.participants.length !== 2 || scene.participants[0] === scene.participants[1] ||
      scene.participants.some(id => typeof id !== 'string' || !id || id.length > 160) ||
      !['class','hangout','dorm'].includes(scene.kind) || typeof scene.positive !== 'boolean' ||
      (['title','where','ref'] as const).some(key => typeof scene[key] !== 'string' || scene[key].length > 500)) continue
    try {
      kept.push({ id: scene.id, date: scene.date, participants: [...scene.participants],
        ...(origin ? { origin } : {}),
        ...(scene.participantNames ? { participantNames: Object.fromEntries(scene.participants.flatMap(id => {
          const name = scene.participantNames?.[id]
          return typeof name === 'string' && name.trim() ? [[id, name.trim().slice(0,200)]] : []
        })) } : {}),
        title: scene.title, where: scene.where, ref: scene.ref, kind: scene.kind, positive: scene.positive,
        lines: validateMeanwhile(scene, scene.participants) })
    } catch { /* Invalid optional cache entries do not invalidate the playthrough. */ }
  }
  return { version: 1, scenes: kept }
}

export function meanwhileEvents(game: MeanwhileContext): MeanwhileScene[] {
  const rows = new Map<string, MeanwhileScene>()
  const known = (ids: readonly string[]): boolean => ids.every(id => game.characters[id] && game.charInfo[id]?.nameKnown)
  for (const scene of normalizeMeanwhile(game.exNpcWatch).scenes) {
    if (scene.date <= game.date && (known(scene.participants) || (scene.origin && scene.date < 0))) rows.set(scene.id, scene)
  }
  for (const [key, pair] of Object.entries(game.npcRelationships)) {
    const ids = key.split('|'), encounter = pair.encounter
    if (ids.length !== 2 || ids[0] === ids[1] || !known(ids) || !encounter ||
      encounter.date > game.date || game.date - encounter.date > 7) continue
    const { date, kind, ref, positive } = encounter
    const id = `encounter:${key}:${date}:${kind}:${ref}:${!!positive}`
    if (rows.has(id)) continue
    const where = kind === 'class' ? (game.classes[ref]?.name ?? ref) :
      kind === 'dorm' ? 'the dorm common area' : ref === 'room' ? 'a dorm room' : locationLabel(ref)
    rows.set(id, { id, date, participants: ids as [string,string], positive, kind, ref, where,
      participantNames: Object.fromEntries(ids.map(id => [id, `${game.characters[id].firstName} ${game.characters[id].lastName}`.trim()])),
      title: ids.map(id => game.characters[id].firstName).join(' & ') + (positive ? ' · Bonded' : ' · Argued'), lines: [] })
  }
  return [...rows.values()].sort((a,b) => b.date-a.date || a.id.localeCompare(b.id)).slice(0,50)
}

export function withMeanwhile(store: MeanwhileStore, scene: MeanwhileScene): MeanwhileStore {
  return { version: 1, scenes: [...normalizeMeanwhile(store).scenes.filter(s => s.id !== scene.id),
    { ...scene, lines: validateMeanwhile(scene, scene.participants) }].slice(-50) }
}
