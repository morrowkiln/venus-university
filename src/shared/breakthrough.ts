import type { CharInfo, SceneLine, TimeSlot } from './types'
import { normalizeTermOrigin, type TermOrigin } from './termOrigin'

export const BREAKTHROUGH_MOD = 'breakthrough'
export const SPIRIT_MAX = 100

export interface BreakthroughPending {
  id: string
  charId: string
  direction: string
  date: number
  time: TimeSlot
  playthroughId: string
}

export interface BreakthroughMoment {
  id: string
  date: number
  time: TimeSlot
  /** Actual generated dialogue, never the player's requested outcome. */
  outcome: string
  transcriptStart?: number
  transcriptCount?: number
  origin?: TermOrigin
}

export interface BreakthroughState {
  meters: Record<string, number>
  settled: Record<string, true>
  pending: BreakthroughPending | null
  moments: Record<string, BreakthroughMoment[]>
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 &&
    !['__proto__', 'constructor', 'prototype'].includes(value)
}

function slot(date: unknown, time: unknown): boolean {
  return Number.isSafeInteger(date) && (date as number) >= 0 && (time === 0 || time === 1)
}

const meter = (n: number): number => Math.max(0, Math.min(SPIRIT_MAX, Number.isFinite(n) ? n : 0))

/** Imported optional data is bounded. Loading refunds an interrupted, uncommitted activation. */
export function normalizeBreakthrough(value?: unknown, recover = false): BreakthroughState {
  const raw = record(value)
  const meters = Object.fromEntries(Object.entries(record(raw.meters)).slice(0,512)
    .filter(([id]) => safeId(id)).map(([id, n]) => [id, meter(Number(n))]))
  const settled = Object.fromEntries(Object.entries(record(raw.settled))
    .filter(([key, done]) => /^\d+:[01]$/.test(key) && done === true).slice(-2048)) as Record<string, true>
  const moments: BreakthroughState['moments'] = {}
  for (const [charId, entries] of Object.entries(record(raw.moments)).slice(0,512)) {
    if (!safeId(charId) || !Array.isArray(entries)) continue
    moments[charId] = entries.slice(-6).flatMap(value => {
      const e = record(value)
      const origin = normalizeTermOrigin(e.origin)
      const archived = origin && Number.isSafeInteger(e.date) && Number(e.date) >= -100000 &&
        Number(e.date) < 0 && (e.time === 0 || e.time === 1)
      if (!safeId(e.id) || !(slot(e.date,e.time) || archived) || typeof e.outcome !== 'string' || !e.outcome.trim()) return []
      const range = Number.isSafeInteger(e.transcriptStart) && (e.transcriptStart as number) >= 0 &&
        Number.isSafeInteger(e.transcriptCount) && (e.transcriptCount as number) > 0
      return [{ id:e.id, date:e.date as number, time:e.time as TimeSlot, outcome:e.outcome.slice(0,12000),
        ...(origin ? { origin } : {}),
        ...(range ? { transcriptStart:e.transcriptStart as number, transcriptCount:e.transcriptCount as number } : {}) }]
    })
  }
  const p = record(raw.pending)
  const pending: BreakthroughPending | null = safeId(p.id) && safeId(p.charId) && safeId(p.playthroughId) &&
    slot(p.date,p.time) && typeof p.direction === 'string' && !!p.direction.trim() && p.direction.length <= 1000
    ? { id:p.id, charId:p.charId, playthroughId:p.playthroughId, date:p.date as number,
      time:p.time as TimeSlot, direction:p.direction.trim() } : null
  if (recover && pending) meters[pending.charId] = SPIRIT_MAX
  return { meters, settled, moments, pending:recover ? null : pending }
}

/** Final edited memories only, once per slot; old retained memories earn nothing again. */
export function settleBreakthrough(
  value: BreakthroughState, before: Record<string, CharInfo>, after: Record<string, CharInfo>,
  date: number, time: TimeSlot
): BreakthroughState {
  const state = normalizeBreakthrough(value), key = `${date}:${time}`
  if (state.settled[key]) return state
  for (const [id, info] of Object.entries(after)) {
    const old = before[id]
    const signature = (m: CharInfo['memories'][number]): string => JSON.stringify([m.date,m.type,m.desc])
    const retained = new Set([...(old?.memories ?? []), ...(old?.textMemory ? [old.textMemory] : [])].map(signature))
    const fresh = [...info.memories, ...(info.textMemory ? [info.textMemory] : [])]
      .filter(m => m.date === date && !retained.has(signature(m)))
    const unique = [...new Map(fresh.map(m => [signature(m),m])).values()]
    const positive = Math.min(20,unique.reduce((sum,m) => sum + (m.type === 'loved' ? 20 : m.type === 'liked' ? 10 : 0),0))
    const penalty = unique.filter(m => m.type === 'hated').length * 15
    if (positive || penalty) state.meters[id] = meter((state.meters[id] ?? 0) + positive - penalty)
  }
  state.settled[key] = true
  return state
}

export function outcomeOf(lines: readonly SceneLine[]): string {
  return lines.filter(line => typeof line.text === 'string' && line.text.trim())
    .map(line => `${line.speaker || 'Narrator'}: ${line.text}`).join('\n').slice(0,12000)
}

/** Edits and discarded tails must not survive in the separate continuity archive. */
export function reconcileBreakthrough(
  value: BreakthroughState, transcript: readonly SceneLine[], date: number, time: TimeSlot
): BreakthroughState {
  const state = normalizeBreakthrough(value)
  for (const [id, entries] of Object.entries(state.moments)) {
    state.moments[id] = entries.flatMap(entry => {
      if (entry.date !== date || entry.time !== time || entry.transcriptStart === undefined) return [entry]
      const lines = transcript.slice(entry.transcriptStart,entry.transcriptStart + entry.transcriptCount!)
      const outcome = outcomeOf(lines)
      return outcome ? [{ ...entry, outcome, transcriptCount:lines.length }] : []
    })
  }
  return state
}

/** Stable, canonical event records for prompts and a future optional memory index. */
export function breakthroughFacts(state: BreakthroughState, ids: readonly string[], date: number, time: TimeSlot) {
  return [...new Set(ids)].flatMap(charId => (state.moments[charId] ?? [])
    .filter(e => e.date < date || e.date === date && e.time <= time)
    .slice(-3).map(e => ({ id:e.id, charId, date:e.date, time:e.time, outcome:e.outcome.slice(0,6000),
      ...(e.origin ? { originalSemester: e.origin.term + 1, originalDay: e.origin.day } : {}) })))
}
