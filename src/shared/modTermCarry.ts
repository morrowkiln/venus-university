import { normalizeBreakthrough } from './breakthrough'
import { normalizeMeanwhile } from './meanwhile'
import {
  normalizeStoryMemory,
  storySnapshot,
  type StoryFact,
  type StoryMemory
} from './storyMemory'
import type { Character, GameSave } from './types'

/** Optional mod saves use the same rebased clock as native memories. No switch is needed to retain data. */
export type ModTermCarry = Pick<
  GameSave,
  'exPlotTwist' | 'exStoryMemory' | 'exBreakthrough' | 'exNpcWatch'
>

export function carryModState(
  save: GameSave,
  term: number,
  back: number,
  characters: Record<string, Character> = {}
): ModTermCarry {
  const result: ModTermCarry = {}
  if (typeof save.exPlotTwist === 'string') result.exPlotTwist = save.exPlotTwist
  if (save.exBreakthrough) {
    const state = normalizeBreakthrough(save.exBreakthrough, true)
    result.exBreakthrough = {
      ...state,
      settled: {},
      pending: null,
      moments: Object.fromEntries(
        Object.entries(state.moments).map(([id, moments]) => [
          id,
          moments
            .filter((m) => m.date < save.date || (m.date === save.date && m.time <= save.time))
            .map((m) => ({
              id: m.id,
              date: m.date - back,
              time: m.time,
              outcome: m.outcome,
              origin: m.origin ?? { term, day: m.date }
            }))
        ])
      )
    }
  }
  if (save.exNpcWatch) {
    result.exNpcWatch = {
      version: 1,
      scenes: normalizeMeanwhile(save.exNpcWatch)
        .scenes.filter((s) => s.date <= save.date)
        .map((s) => ({
          ...s,
          id: s.origin ? s.id : `term:${term}:${s.id}`,
          date: s.date - back,
          origin: s.origin ?? { term, day: s.date },
          participantNames: Object.fromEntries(
            s.participants.map((id) => [
              id,
              s.participantNames?.[id] ??
                (characters[id]
                  ? `${characters[id].firstName} ${characters[id].lastName}`.trim()
                  : id)
            ])
          )
        }))
    }
  }
  // Recaps live here, not in the next semester's active history. Originals, corrections and
  // hidden flags stay separate so the memory editor can still undo a player's correction.
  if (save.exStoryMemory || Object.keys(save.history ?? {}).length) {
    const old = normalizeStoryMemory(save.exStoryMemory)
    const raw = storySnapshot({
      playthroughId: '0',
      date: save.date,
      time: save.time,
      history: save.history ?? {},
      characters,
      exStoryMemory: { ...old, facts: [], edits: {}, hidden: [], encounterEdits: {} }
    })!
    const mapped = new Map(
      old.facts.map((f) => [f.id, f.origin ? f.id : `term:${term}:${f.id}`])
    )
    for (const r of raw.records) mapped.set(r.id, r.origin ? r.id : `term:${term}:${r.id}`)
    const idOf = (id: string): string => mapped.get(id) ?? id
    const move = (f: StoryFact): StoryFact => {
      const { batch: _batch, ...rest } = f
      return {
        ...rest,
        id: idOf(f.id),
        date: f.date - back,
        origin: f.origin ?? { term, day: f.date },
        supersedes: f.supersedes.map(idOf)
      }
    }
    const memory: StoryMemory = {
      ...old,
      facts: old.facts
        .filter((f) => f.date < save.date || (f.date === save.date && f.time <= save.time))
        .map(move),
      edits: Object.fromEntries(
        Object.entries(old.edits).map(([id, f]) => [idOf(id), move(f)])
      ),
      hidden: old.hidden.map(idOf),
      encounterSubjects: {}, // Archived recaps carry their participants directly.
      encounterEdits: Object.fromEntries(
        Object.entries(old.encounterEdits)
          .filter(([id]) => mapped.has(id))
          .map(([id, edit]) => [idOf(id), { ...edit }])
      ),
      pastEncounters: raw.records.map((r) => ({
        id: idOf(r.id),
        date: r.date - back,
        time: r.time,
        text: r.text,
        subjects: r.subjects,
        origin: r.origin ?? { term, day: r.date }
      })),
      names: raw.names
    }
    result.exStoryMemory = normalizeStoryMemory(memory)
  }
  return result
}
