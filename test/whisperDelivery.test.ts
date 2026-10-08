import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VENUS_WHISPER_MOD, carryWhisper, normalizeWhisper, whisperDiscussionOpen, whisperHasUnread, whisperIssueId, whisperRecall,
  whisperSources, whisperSpotlight, whisperWednesday, whisperWeekOccupied, type WhisperDraft, type WhisperIssue, type WhisperReply } from '@shared/venusWhisper'
import type { GameSave, Result, SaveDraft, StructuredRequest } from '@shared/types'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { useModsStore } from '../src/renderer/stores/modsStore'
import { commentOnWhisper, dismissWhisper, markWhisperRead, publishWhisper, useWhisperActivity } from '../src/renderer/stores/venusWhisper'
import { retryWhisperDelivery, startWhisperDelivery, useWhisperDelivery } from '../src/renderer/stores/whisperDelivery'
import { useBunnyboardStore } from '../src/renderer/stores/bunnyboardStore'
import { writesSettled } from '../src/renderer/stores/loop/saves'
import { character, charactersById, charInfo, restoreApi, stubApi } from './fixtures'

const game = () => useGameStore.getState()
let stop: (() => void) | undefined
function api() {
  const complete = vi.fn(async (request: StructuredRequest): Promise<Result<WhisperDraft | WhisperReply>> => {
    const data = JSON.parse(request.user)
    return { ok: true, data: data.publicSources ? { title: 'Sarah has an audience', body: 'Sarah posted about a tense rematch.',
      sources: data.publicSources.map((s: { id: string }) => s.id), comments: [] } :
      { comments: data.profiles.map((p: { id: string }) => ({ speaker: p.id, text: 'I will be watching that rematch.' })) } }
  })
  const save = vi.fn(async (_p: string, draft: SaveDraft): Promise<Result<GameSave>> => ({ ok: true, data: { ...draft, playthroughId: 'p', saveId: 'autosave', saveDate: 0 } }))
  const cancel = vi.fn(async (): Promise<Result<void>> => ({ ok: true, data: undefined }))
  stubApi({ llm: { completeWhisper: complete }, saves: { autosave: save }, jobs: { cancelGroup: cancel } })
  return { complete, save, cancel }
}
beforeEach(() => {
  vi.useFakeTimers()
  useGameStore.getState().reset()
  useBunnyboardStore.getState().reset()
  useModsStore.setState({ switches: { on: {}, options: {} } })
  useWhisperActivity.setState({ working: false })
  useWhisperDelivery.setState({ error: '', retry: 0, delivering: false })
  useGameStore.setState({ playthroughId: 'p', date: 2, time: 0, chars: ['a','b'], playerFirstName: 'Sam', playerLastName: 'Rowe',
    characters: charactersById(character({ charId: 'a' }), character({ charId: 'b', firstName: 'Mina' })),
    charInfo: { a: charInfo({ nameKnown: true, handle: 'sarah', feed: [{ id: 'post', date: 1, time: 1, text: 'A bowling rematch is overdue.', likes: 3 }] }),
      b: charInfo({ nameKnown: true, handle: 'mina' }) } })
})
afterEach(async () => { stop?.(); stop = undefined; await vi.advanceTimersByTimeAsync(200); await writesSettled(); restoreApi(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('Wednesday edition and unread state', () => {
  it('waits for Wednesday, delivers with Bunnyboard closed, and never publishes twice in the same week', async () => {
    const { complete } = api()
    useGameStore.setState({ date: 1 })
    stop = startWhisperDelivery()
    await vi.advanceTimersByTimeAsync(3000)
    expect(complete).not.toHaveBeenCalled()
    useGameStore.setState({ date: 2 })
    await vi.advanceTimersByTimeAsync(1100)
    expect(useBunnyboardStore.getState().open).toBe(false)
    expect(game().exVenusWhisper.issues).toHaveLength(1)
    expect(complete).toHaveBeenCalledTimes(2)
    expect(game().exVenusWhisper.issues[0]).toMatchObject({ day: 2, weekly: true, read: false })
    useGameStore.setState({ date: 8, time: 1 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(complete).toHaveBeenCalledTimes(2)
    useGameStore.setState({ date: 9, time: 0 })
    await vi.advanceTimersByTimeAsync(1100)
    expect(game().exVenusWhisper.issues.map(i => i.day)).toEqual([2,9])
    expect(complete).toHaveBeenCalledTimes(4)
  })

  it('preserves read/unread through saves, rollover and failure, with legacy issues already read', async () => {
    const { save } = api(), id = await publishWhisper('test', () => true)
    expect(whisperHasUnread(game().exVenusWhisper, 0, 2)).toBe(true)
    expect(whisperHasUnread(game().exVenusWhisper, 0, 1)).toBe(false)
    save.mockResolvedValueOnce({ ok: false, error: { code: 'DISK', message: 'Disk full' } })
    await expect(markWhisperRead(id, () => true)).rejects.toThrow('Disk full')
    expect(game().exVenusWhisper.issues[0].read).toBe(false)
    await markWhisperRead(id, () => true)
    expect(whisperHasUnread(normalizeWhisper(game().toGameSave().exVenusWhisper), 0, 2)).toBe(false)
    const copy = { ...game().exVenusWhisper, issues: [{ ...game().exVenusWhisper.issues[0], read: false }] }
    expect(whisperHasUnread(carryWhisper(copy, 0, 120), 1, 0)).toBe(true)
    expect(whisperHasUnread(normalizeWhisper({ ...copy, issues: [{ ...copy.issues[0], read: undefined }] }), 0, 2)).toBe(false)
  })

  it('keeps weekly comments and bounded public recall until the following Wednesday', async () => {
    api(); const id = await publishWhisper('test', () => true), issue = game().exVenusWhisper.issues[0]
    useGameStore.setState({ date: 8 })
    await commentOnWhisper(id, 'Still wondering about that rematch.', undefined, () => true)
    expect(whisperDiscussionOpen(issue, 0, 8)).toBe(true)
    expect(whisperRecall(game().exVenusWhisper, 0, 8, ['a'])).not.toEqual([])
    useGameStore.setState({ date: 9 })
    await expect(commentOnWhisper(id, 'Too late.', undefined, () => true)).rejects.toThrow('archived')
    expect(whisperRecall(game().exVenusWhisper, 0, 9, ['a'])).toEqual([])
    expect(whisperDiscussionOpen({ ...issue, weekly: undefined }, 0, 4)).toBe(false)
  })

  it('catches up only the latest Wednesday and never includes evidence from after its delivery date', async () => {
    const { complete } = api()
    useGameStore.setState(s => ({ date: 19, charInfo: { ...s.charInfo, a: { ...s.charInfo.a, feed: [
      { id: 'past', date: 15, time: 1, text: 'LAST WEEK', likes: 0 },
      { id: 'future', date: 17, time: 0, text: 'AFTER WEDNESDAY', likes: 0 }
    ] } } }))
    stop = startWhisperDelivery(); await vi.advanceTimersByTimeAsync(1100)
    expect(game().exVenusWhisper.issues.map(i => i.day)).toEqual([16])
    const request = complete.mock.calls[0][0].user
    expect(request).toContain('LAST WEEK'); expect(request).not.toContain('AFTER WEDNESDAY')
    expect(whisperWednesday(0)).toBeNull(); expect(whisperWednesday(2)).toBe(2); expect(whisperWednesday(9)).toBe(9)
  })

  it('respects disabled mods, deleted editions and an existing daily issue during upgrades', async () => {
    const { complete } = api()
    useModsStore.setState({ switches: { on: { [VENUS_WHISPER_MOD]: false }, options: {} } })
    stop = startWhisperDelivery(); await vi.advanceTimersByTimeAsync(3000)
    expect(complete).not.toHaveBeenCalled()
    useModsStore.setState({ switches: { on: {}, options: {} } }); await vi.advanceTimersByTimeAsync(1100)
    await dismissWhisper(whisperIssueId(0,2), () => true)
    useGameStore.setState({ date: 3 }); await vi.advanceTimersByTimeAsync(3000)
    expect(game().exVenusWhisper.issues).toEqual([]); expect(complete).toHaveBeenCalledTimes(2)
    const old: WhisperIssue = { id: whisperIssueId(0,10), term: 0, day: 10, title: 'Old daily', body: 'An old issue.', subjects: [], comments: [], answered: [] }
    expect(whisperWeekOccupied(normalizeWhisper({ version: 1, issues: [old] }), 0, 12)).toBe(true)
  })

  it('retains a completed generation while narration is busy, then merges into the current safe checkpoint', async () => {
    const { complete, save } = api()
    let finish!: (r: Result<WhisperDraft>) => void
    complete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    stop = startWhisperDelivery(); await vi.advanceTimersByTimeAsync(0)
    expect(complete).toHaveBeenCalledOnce()
    useGameStore.setState({ date: 3, busy: true, money: 1234 })
    finish({ ok: true, data: { title: 'Still Wednesday’s news', body: 'A public rematch.', sources: ['post:a:post'], comments: [] } })
    await vi.advanceTimersByTimeAsync(1500)
    expect(save).toHaveBeenCalledOnce(); expect(game().exVenusWhisper.issues).toEqual([])
    useGameStore.setState({ busy: false }); await vi.advanceTimersByTimeAsync(1100)
    expect(game().exVenusWhisper.issues).toHaveLength(1)
    expect(save.mock.calls.at(-1)?.[1]).toMatchObject({ date: 3, money: 1234 })
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('cancels a loaded-away delivery and cannot leak its result into the replacement save', async () => {
    const { complete, cancel } = api()
    let finish!: (r: Result<WhisperDraft>) => void
    complete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    stop = startWhisperDelivery(); await vi.advanceTimersByTimeAsync(0)
    useGameStore.setState(s => ({ loads: s.loads+1, busy: true, exVenusWhisper: normalizeWhisper(null) }))
    await vi.advanceTimersByTimeAsync(1000)
    finish({ ok: true, data: { title: 'Stale', body: 'Never publish me.', sources: [], comments: [] } })
    await vi.advanceTimersByTimeAsync(500)
    expect(cancel).toHaveBeenCalledOnce()
    expect(game().exVenusWhisper.issues).toEqual([])
    expect(useWhisperDelivery.getState().error).toBe('')
  })

  it('does not repeatedly call a failing provider in one slot; explicit retry retains the author', async () => {
    const { complete } = api()
    complete.mockResolvedValueOnce({ ok: false, error: { code: 'OFFLINE', message: 'Offline' } })
    stop = startWhisperDelivery(); await vi.advanceTimersByTimeAsync(5000)
    expect(complete).toHaveBeenCalledOnce()
    const author = game().exVenusWhisper.author
    expect(useWhisperDelivery.getState().error).toBe('Offline')
    retryWhisperDelivery(); await vi.advanceTimersByTimeAsync(1100)
    expect(game().exVenusWhisper.author).toEqual(author)
    expect(game().exVenusWhisper.issues).toHaveLength(1)
    expect(complete).toHaveBeenCalledTimes(3)
  })

  it('narrows weekly public evidence to one supported lead while keeping private and future data out', () => {
    useGameStore.setState(s => ({ date: 9, charInfo: { ...s.charInfo, a: { ...s.charInfo.a, notes: 'PRIVATE NOTE', feed: [
      { id: 'old', date: 2, time: 1, text: 'EXPIRED', likes: 0 }, { id: 'current', date: 3, time: 1, text: 'PUBLIC', likes: 0 },
      { id: 'future', date: 9, time: 1, text: 'FUTURE', likes: 0 }
    ] } } }))
    expect(JSON.stringify(whisperSources(game()))).toContain('PUBLIC')
    expect(JSON.stringify(whisperSources(game()))).not.toMatch(/PRIVATE|EXPIRED|FUTURE/)
    const pool = [{ id: 'one', text: 'A', subjects: ['a'] }, { id: 'two', text: 'B', subjects: ['b'] }]
    expect(whisperSpotlight(pool, ['a'])).toEqual({ focus: 'b', sources: [pool[1]] })
    expect(whisperSpotlight(Array.from({length:20},(_,i)=>({id:String(i),text:'Public',subjects:['a']}))).sources).toHaveLength(6)
  })
})
