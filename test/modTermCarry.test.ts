import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { carryTerm, carriedOpening } from '@shared/termCarry'
import { carryModState } from '@shared/modTermCarry'
import {
  normalizeBreakthrough,
  settleBreakthrough,
  breakthroughFacts,
  reconcileBreakthrough
} from '@shared/breakthrough'
import { meanwhileEvents, normalizeMeanwhile, withMeanwhile } from '@shared/meanwhile'
import {
  acceptStoryFacts,
  assertStoryRecall,
  formatStoryRecall,
  normalizeStoryMemory,
  storySnapshot,
  STORY_MEMORY_BUDGET,
  type StoryFact
} from '@shared/storyMemory'
import { normalizeTermOrigin, termOriginLabel } from '@shared/termOrigin'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { useModsStore } from '../src/renderer/stores/modsStore'
import { currentStorySnapshot } from '../src/renderer/stores/storyMemory'
import { recallFromSqlite } from '../src/main/services/storyMemoryIndex'
import { keptFrom } from '../src/renderer/stores/newGame'
import { character, charactersById, charInfo, playthroughRecord } from './fixtures'
import type { GameSave } from '@shared/types'

const a = character({ charId: 'a' }),
  b = character({ charId: 'b', firstName: 'Mina' })
const characters = charactersById(a, b)
const fact = (id = 'fact:0:0:book', date = 0): StoryFact => ({
  id,
  date,
  time: 0,
  subject: 'a',
  category: 'promise',
  text: 'Sarah promised to return the blue atlas.',
  timeline: 'current',
  certainty: 'event',
  claimant: null,
  knownBy: ['a', 'reader'],
  public: false,
  evidence: 'I will return the blue atlas.',
  source: 'Scene dialogue',
  supersedes: [],
  manual: false,
  batch: `${date}:0`
})
const record = (term = 0) =>
  playthroughRecord({
    chars: ['a', 'b'],
    term: { index: term },
    profiles: {
      a: { year: 2, dorm: 'lowrise_1', major: 'Art', schedule: {} },
      b: { year: 4, dorm: 'lowrise_1', major: 'Art', schedule: {} }
    }
  })
function ending(): GameSave {
  useGameStore.getState().reset()
  return {
    ...useGameStore.getState().toGameSave(),
    playthroughId: '123',
    saveId: 'ending',
    saveDate: 0,
    date: 100,
    time: 1,
    charInfo: { a: charInfo({ nameKnown: true }), b: charInfo({ nameKnown: true }) },
    history: {
      0: { 0: 'Sarah and Mina visited the library.' },
      20: { 1: 'Sarah told a private story.' }
    },
    exPlotTwist: 'An old letter will arrive.',
    exStoryMemory: normalizeStoryMemory({
      facts: [
        fact(),
        fact('hidden', 2),
        { ...fact('old', 3), text: 'Sarah promised a red atlas.' },
        { ...fact('new', 4), supersedes: ['old'], timeline: 'current' },
        { ...fact('claim', 5), certainty: 'claim', claimant: 'a', timeline: 'alternate' }
      ],
      edits: {
        'fact:0:0:book': {
          ...fact(),
          text: 'Sarah promised to return the blue atlas next week.',
          manual: true
        }
      },
      hidden: ['hidden'],
      encounterSubjects: { 'encounter:0:0': ['a', 'b'], 'encounter:20:1': ['a'] },
      encounterEdits: {
        'encounter:0:0': { text: 'Sarah and Mina returned the atlas together.' },
        'encounter:20:1': { hidden: true }
      }
    }),
    exBreakthrough: {
      meters: { a: 65, b: 30 },
      settled: { '0:0': true, '100:1': true },
      pending: null,
      moments: {
        a: [
          {
            id: 'outcome',
            date: 20,
            time: 1,
            outcome: 'Sarah agreed to give the friendship another chance.',
            transcriptStart: 2,
            transcriptCount: 3
          }
        ]
      }
    },
    exNpcWatch: {
      version: 1,
      scenes: [
        {
          id: 'encounter:a|b:0:hangout:green_hill_park:true',
          date: 0,
          participants: ['a', 'b'],
          title: 'Sarah & Mina · Bonded',
          where: 'the park',
          ref: 'green_hill_park',
          kind: 'hangout',
          positive: true,
          lines: Array.from({ length: 6 }, (_, i) => ({
            speaker: i % 2 ? 'b' : 'a',
            text: `Saved exchange ${i}`
          }))
        }
      ]
    }
  }
}
function opening(previous: GameSave, term = 0): GameSave {
  const carry = carryTerm(previous, record(term), ['a'], characters).carry
  return {
    ...carriedOpening(
      {
        ...ending(),
        date: 0,
        time: 0,
        history: {},
        exStoryMemory: normalizeStoryMemory(null),
        exBreakthrough: normalizeBreakthrough(),
        exNpcWatch: normalizeMeanwhile(null),
        exPlotTwist: ''
      },
      carry
    ),
    playthroughId: String(456 + term),
    saveId: 'opening',
    saveDate: 0
  }
}
function snapshot(save: GameSave) {
  return storySnapshot({ ...save, characters: charactersById(a) })!
}
afterEach(() => {
  useGameStore.getState().reset()
  useModsStore.setState({ switches: { on: {}, options: {} } })
})

describe('continued semester mod state', () => {
  it('does not pull future records backwards into recall, or drop valid IDs when qualifying them', () => {
    const old = ending()
    old.exStoryMemory!.facts.push(fact('future', 101), fact('f'.repeat(200), 3))
    old.history[101] = { 0: 'This scene has not happened yet.' }
    old.exBreakthrough!.moments.a.push({
      id: 'future',
      date: 101,
      time: 0,
      outcome: 'Future outcome'
    })
    const scene = old.exNpcWatch!.scenes[0]
    scene.id = 's'.repeat(500)
    old.exNpcWatch!.scenes.push({ ...scene, id: 'future', date: 101 })
    const next = opening(old)
    expect(
      snapshot(next).records.some(
        (r) => r.id.includes('future') || r.text.includes('not happened')
      )
    ).toBe(false)
    expect(next.exBreakthrough!.moments.a.map((m) => m.id)).toEqual(['outcome'])
    expect(normalizeMeanwhile(next.exNpcWatch).scenes.map((s) => s.id)).toEqual([
      'term:0:' + 's'.repeat(500)
    ])
    expect(next.exStoryMemory!.facts.some((f) => f.id === 'term:0:' + 'f'.repeat(200))).toBe(
      true
    )
  })
  it('keeps private facts, corrections, hidden records and supersession without rewriting the ending save', () => {
    const before = ending(),
      original = JSON.stringify(before),
      next = opening(before)
    expect(JSON.stringify(before)).toBe(original)
    expect(next.history).toEqual({})
    expect(next.exPlotTwist).toBe(before.exPlotTwist)
    const records = snapshot(next).records
    expect(records.map((r) => r.id)).not.toContain('term:0:hidden')
    expect(records.map((r) => r.id)).not.toContain('term:0:old')
    expect(records.map((r) => r.id)).not.toContain('term:0:encounter:20:1')
    expect(records.find((r) => r.id === 'term:0:new')?.supersedes).toEqual(['term:0:old'])
    expect(records.find((r) => r.id === 'term:0:fact:0:0:book')).toMatchObject({
      date: -210,
      origin: { term: 0, day: 0 },
      manual: true,
      knownBy: ['a', 'reader'],
      public: false,
      text: 'Sarah promised to return the blue atlas next week.'
    })
    expect(records.find((r) => r.id === 'term:0:claim')).toMatchObject({
      certainty: 'claim',
      claimant: 'a',
      timeline: 'alternate'
    })
    expect(
      next.exStoryMemory?.pastEncounters?.find((r) => r.id === 'term:0:encounter:0:0')?.text
    ).toBe('Sarah and Mina visited the library.')
    expect(records.find((r) => r.id === 'term:0:encounter:0:0')).toMatchObject({
      text: 'Sarah and Mina returned the atlas together.',
      knownBy: [],
      subjects: ['a', 'b']
    })
    const unhidden = normalizeStoryMemory(next.exStoryMemory)
    unhidden.hidden = []
    unhidden.encounterEdits = {}
    expect(snapshot({ ...next, exStoryMemory: unhidden }).records.map((r) => r.text)).toContain(
      'Sarah told a private story.'
    )
    expect(snapshot(next).names.b).toBe('Mina Rose')
  })

  it('keeps origin and distinct IDs through a second continuation and accepts new day-zero facts', () => {
    const first = opening(ending())
    const candidate = {
      subject: 'sarah_rose',
      category: 'promise',
      text: 'Sarah promised to return the blue atlas.',
      timeline: 'current',
      certainty: 'event',
      claimant: 'none',
      knownBy: ['reader', 'sarah_rose'],
      public: false,
      evidence: 'I will return the blue atlas.',
      supersedes: []
    }
    first.exStoryMemory = acceptStoryFacts(first.exStoryMemory, [candidate], {
      date: 0,
      time: 0,
      cast: ['a'],
      charKeyToId: { sarah_rose: 'a' },
      transcript: [{ speaker: 'sarah_rose', text: candidate.evidence }]
    })
    expect(first.exStoryMemory.facts).toHaveLength(6)
    first.history = { 0: { 0: 'Sarah found a new semester timetable.' } }
    const second = opening({ ...first, date: 100, time: 1 }, 1)
    const records = snapshot(second).records
    expect(new Set(records.map((r) => r.id)).size).toBe(records.length)
    expect(records.find((r) => r.id === 'term:0:encounter:0:0')).toMatchObject({
      date: -365,
      origin: { term: 0, day: 0 }
    })
    expect(records.find((r) => r.id === 'term:1:encounter:0:0')).toMatchObject({
      date: -155,
      origin: { term: 1, day: 0 }
    })
    expect(second.exStoryMemory?.facts.some((f) => f.batch !== undefined)).toBe(false)
    expect(second.exBreakthrough?.moments.a[0]).toMatchObject({
      date: 20 - 365,
      origin: { term: 0, day: 20 }
    })
    expect(second.exNpcWatch?.scenes[0].id).toBe(first.exNpcWatch?.scenes[0].id)
    expect(termOriginLabel(records.find((r) => r.id === 'term:0:encounter:0:0')!.origin!)).toBe(
      'Semester 1 · Day 0'
    )
  })

  it('resumes spirit earning on day zero without replaying an advantage or applying new transcript edits to old outcomes', () => {
    const next = opening(ending()),
      state = next.exBreakthrough!
    expect(state.meters).toEqual({ a: 65, b: 30 })
    expect(state.settled).toEqual({})
    expect(state.pending).toBeNull()
    expect(state.moments.a[0].transcriptStart).toBeUndefined()
    const before = { a: charInfo() },
      after = { a: charInfo({ memories: [{ date: 0, type: 'loved', desc: 'a new welcome' }] }) }
    const settled = settleBreakthrough(state, before, after, 0, 0)
    expect(settled.meters.a).toBe(85)
    expect(settleBreakthrough(settled, before, after, 0, 0).meters.a).toBe(85)
    expect(reconcileBreakthrough(settled, [], 0, 0).moments).toEqual(state.moments)
    expect(breakthroughFacts(state, ['a'], 0, 0)[0]).toMatchObject({
      id: 'outcome',
      originalSemester: 1,
      originalDay: 20
    })
    const interrupted = ending()
    interrupted.exBreakthrough!.meters.a = 0
    interrupted.exBreakthrough!.pending = {
      id: 'pending',
      charId: 'a',
      direction: 'Ask for another chance',
      date: 100,
      time: 1,
      playthroughId: '123'
    }
    expect(opening(interrupted).exBreakthrough).toMatchObject({
      meters: { a: 100 },
      pending: null
    })
  })

  it('replays graduates without generating or granting knowledge, while new encounters with the same day remain separate', () => {
    const first = opening(ending()),
      scene = first.exNpcWatch!.scenes[0]
    const context = {
      date: 0,
      characters: charactersById(a),
      charInfo: { a: charInfo({ nameKnown: true }) },
      classes: {},
      npcRelationships: {},
      exNpcWatch: first.exNpcWatch!
    }
    expect(meanwhileEvents(context)[0]).toMatchObject({
      origin: { term: 0, day: 0 },
      participantNames: { a: 'Sarah Rose', b: 'Mina Rose' },
      lines: ending().exNpcWatch!.scenes[0].lines
    })
    expect(JSON.stringify(snapshot(first))).not.toContain('Saved exchange')
    const fresh = {
      ...scene,
      id: ending().exNpcWatch!.scenes[0].id,
      date: 0,
      origin: undefined
    }
    const cache = withMeanwhile(first.exNpcWatch!, fresh)
    expect(cache.scenes).toHaveLength(2)
    expect(meanwhileEvents({ ...context, exNpcWatch: cache })).toHaveLength(1) // new event still requires both known NPCs
    expect(
      meanwhileEvents({
        ...context,
        characters,
        charInfo: { a: charInfo({ nameKnown: true }), b: charInfo({ nameKnown: true }) },
        exNpcWatch: cache
      })
    ).toHaveLength(2)
  })

  it('round-trips carried data while all relevant switches are off, then recalls it when enabled', () => {
    const next = opening(ending())
    useModsStore.setState({
      switches: {
        on: {
          'story-memory': false,
          'meanwhile-conversations': false,
          breakthrough: false,
          'plot-twist': false
        },
        options: {}
      }
    })
    const serialized = JSON.parse(JSON.stringify(next)) as GameSave
    useGameStore.getState().loadSave(serialized, record(1), charactersById(a))
    const saved = useGameStore.getState().toGameSave()
    for (const key of ['exStoryMemory', 'exNpcWatch', 'exBreakthrough', 'exPlotTwist'] as const)
      expect(saved[key]).toEqual(next[key])
    expect(currentStorySnapshot()).toBeUndefined()
    useModsStore.setState({ switches: { on: { 'story-memory': true }, options: {} } })
    expect(currentStorySnapshot()?.records.some((r) => r.id === 'term:0:fact:0:0:book')).toBe(
      true
    )
    expect(meanwhileEvents(useGameStore.getState())).toHaveLength(1)
  })

  it('rebuilds the new save SQLite index and fallback identically, with private scope and unchanged budget', () => {
    const next = opening(ending()),
      payload = { ...snapshot(next), cast: ['a'], query: 'blue atlas' }
    expect(() => assertStoryRecall(payload)).not.toThrow()
    const db = new DatabaseSync(':memory:')
    try {
      const sql = recallFromSqlite(db, payload),
        fallback = formatStoryRecall(payload)
      expect(sql.text).toBe(fallback.text)
      expect(sql.included).toEqual(fallback.included)
      expect(sql.text.length).toBeLessThanOrEqual(STORY_MEMORY_BUDGET)
      expect(sql.text).toContain('originalSemester')
      expect(sql.text).not.toContain('private story')
      expect(sql.text).not.toContain('red atlas')
      expect(
        recallFromSqlite(db, { ...payload, playthroughId: '999', records: [] }).indexed
      ).toBe(0)
      expect(() => assertStoryRecall({ ...payload, date: -1 })).toThrow()
      expect(() =>
        assertStoryRecall({ ...payload, records: [{ ...payload.records[0], date: 1 }] })
      ).toThrow()
    } finally {
      db.close()
    }
  })

  it('preserves legacy recaps without optional mod fields and passes graduating names through the real continuation path', () => {
    const old = ending()
    delete old.exStoryMemory
    delete old.exBreakthrough
    delete old.exNpcWatch
    delete old.exPlotTwist
    const carried = keptFrom(Object.values(characters), {
      playthroughId: '123',
      save: old,
      record: record(),
      characters
    })
    expect(carried.kept.map((c) => c.charId)).toEqual(['a'])
    expect(carried.carried.carry.exStoryMemory?.names?.b).toBe('Mina Rose')
    expect(carried.carried.carry.exStoryMemory?.pastEncounters).toHaveLength(2)
    expect(carried.carried.carry.exNpcWatch).toBeUndefined()
    expect(carried.carried.carry.exBreakthrough).toBeUndefined()
    expect(carryModState({ ...old, history: {} }, 0, 210, characters)).toEqual({})
    expect(normalizeTermOrigin({ term: -1, day: 5 })).toBeUndefined()
  })
})
