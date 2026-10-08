import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  VENUS_WHISPER_MOD, carryWhisper, ensureWhisperAuthor, normalizeWhisper, validateWhisperComments,
  whisperAddressees, whisperCommenters, whisperIssueId, whisperMentions, whisperPeople, whisperRecall, whisperSources,
  type WhisperDraft, type WhisperIssue, type WhisperReply
} from '@shared/venusWhisper'
import { carriedOpening, carryTerm } from '@shared/termCarry'
import type { GameSave, Result, SaveDraft, StructuredRequest } from '@shared/types'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { useModsStore } from '../src/renderer/stores/modsStore'
import { commentOnWhisper, dismissWhisper, publishWhisper, replyOnWhisper } from '../src/renderer/stores/venusWhisper'
import { writesSettled } from '../src/renderer/stores/loop/saves'
import { buildWhisperReplies } from '../src/renderer/prompts/venusWhisperPrompt'
import { character, charactersById, charInfo, playthroughRecord, restoreApi, stubApi } from './fixtures'

const game = () => useGameStore.getState()
const active = () => true
const id = () => whisperIssueId(game().termIndex, game().date)
const issue = (): WhisperIssue => ({ id: id(), term: game().termIndex, day: game().date, title: 'An unlikely team',
  body: 'Sarah and Mina had an animated debate by the bowling lanes.', subjects: ['a', 'b'], comments: [], answered: [] })

/** A synthetic save has public material alongside secrets that must never reach the column. */
function seed(): void {
  useGameStore.getState().reset()
  useModsStore.setState({ switches: { on: {}, options: {} } })
  useGameStore.setState({ playthroughId: 'p', date: 7, time: 0, playerFirstName: 'Sam', playerLastName: 'Rowe', chars: ['a', 'b'],
    characters: charactersById(character({ charId: 'a', personality: 'Sarah is warm.' }), character({ charId: 'b', firstName: 'Mina' })),
    charInfo: { a: charInfo({ nameKnown: true, handle: 'sarah', notes: 'PRIVATE NOTE', feed: [{ id: 'post', text: 'Bowling again!', date: 6, time: 1, likes: 3 }] }),
      b: charInfo({ nameKnown: true, handle: 'mina' }) }, history: { 6: { 1: 'PRIVATE SCENE' } },
    npcRelationships: { 'a|b': { affinity: 2, encounter: { date: 6, kind: 'hangout', ref: 'green_hill_park', positive: true } } } })
}

/** Only synthetic responses and an in-memory autosave sink are used. */
function api(): { complete: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> } {
  const complete = vi.fn(async (request: StructuredRequest): Promise<Result<WhisperDraft | WhisperReply>> => {
    const data = JSON.parse(request.user)
    return { ok: true, data: data.publicSources ? { title: 'The campus has opinions', body: 'A cheerful debate at the park.',
      sources: data.publicSources.map((s: { id: string }) => s.id), comments: [] } : {
      comments: data.profiles.map((p: { id: string }) => ({ speaker: p.id, text: 'That sounds like a good afternoon.' })) } }
  })
  const save = vi.fn(async (_p: string, draft: SaveDraft): Promise<Result<GameSave>> => ({ ok: true, data: { ...draft, playthroughId: 'p', saveId: 'autosave', saveDate: 0 } }))
  stubApi({ llm: { completeWhisper: complete }, saves: { autosave: save } })
  return { complete, save }
}

beforeEach(seed)
afterEach(async () => { await writesSettled(); restoreApi(); vi.restoreAllMocks() })

describe('newsletter identity and semester continuity', () => {
  it('keeps the same author and original issue/thread dates through repeated semesters and a missing roster member', () => {
    const chosen = ensureWhisperAuthor(game(), () => 0)
    useGameStore.setState({ exVenusWhisper: { ...chosen, issues: [{ ...issue(), comments: [{ id: 'c', person: { id: 'a', name: 'Sarah Rose', handle: 'sarah' },
      player: false, text: 'Looks fun.', mentions: [] }] }] } })
    const before = structuredClone(game().exVenusWhisper)
    const saved = { ...game().toGameSave(), date: 120, playthroughId: 'p', saveId: 'ending', saveDate: 0 } as GameSave
    const carry = carryTerm(saved, playthroughRecord({ chars: ['a', 'b'] }), ['b']).carry
    const opening = carriedOpening(game().toGameSave(), carry)
    expect(opening.exVenusWhisper).toEqual(before)
    const next = { ...opening, date: 120 } as GameSave
    const second = carryTerm(next, playthroughRecord({ chars: ['b'], term: { index: 1 } }), ['b']).carry
    useGameStore.setState({ chars: ['b'], characters: charactersById(character({ charId: 'b' })), charInfo: { b: charInfo({ nameKnown: true }) }, termIndex: 2, date: 0,
      exVenusWhisper: second.exVenusWhisper! })
    expect(ensureWhisperAuthor(game(), () => .99).author).toEqual(before.author)
    expect(whisperPeople(game()).find(p => p.id === 'a')?.name).toBe('Sarah Rose')
    expect(whisperPeople({ ...game(), chars: [], characters: {}, charInfo: {} }).map(p => p.id)).toEqual(['a', 'b'])
    expect(second.exVenusWhisper?.issues[0].comments[0].id).toBe('c')
    expect(saved.exVenusWhisper).toEqual(before)
    expect(whisperRecall(second.exVenusWhisper, 2, 0, ['b'])).toEqual([])
    const record = playthroughRecord({ chars: ['b'], term: { index: 2 } })
    game().loadSave({ ...game().toGameSave(), exVenusWhisper: second.exVenusWhisper } as GameSave, record, game().characters)
    expect(game().toGameSave().exVenusWhisper).toEqual(second.exVenusWhisper)
    game().reset()
    expect(game().exVenusWhisper.author).toBeUndefined()
  })

  it('bounds malformed imports, removes dangling/cyclic reply links and hides future or deleted issues', () => {
    const base = issue(), p = { id: 'a', name: 'Sarah', handle: 'sarah' }
    const comments = [{ id: 'one', person: p, player: false, text: 'Hello', replyTo: 'two', mentions: [] },
      { id: 'two', person: p, player: false, text: 'Hello again', replyTo: 'one', mentions: [] }]
    const clean = normalizeWhisper({ version: 1, issues: [null, { ...base, body: 12 }, { ...base, comments }, base], dismissed: [] })
    expect(clean.issues).toHaveLength(1)
    expect(clean.issues[0].comments[0].replyTo).toBeUndefined()
    expect(clean.issues[0].comments[1].replyTo).toBe('one')
    expect(normalizeWhisper({ ...clean, dismissed: [base.id] }).issues).toEqual([])
    expect(carryWhisper({ ...clean, issues: [base, { ...base, id: 'whisper:1:0', term: 1, day: 0 }] }, 0, 7).issues).toHaveLength(1)
  })

  it('gives the author an ordinary occasional comment without exposing her role to any public prompt', () => {
    useGameStore.setState({ exVenusWhisper: ensureWhisperAuthor(game(), () => 0) })
    expect(whisperCommenters(game(), () => .9).map(p => p.id)).not.toContain('a')
    const people = whisperCommenters(game(), () => 0)
    expect(people.map(p => p.id)).toContain('a')
    expect(people.every(p => Object.keys(p).sort().join() === 'handle,id,name,voice')).toBe(true)
    const user = JSON.parse(buildWhisperReplies(issue(), people).user)
    expect(user).not.toHaveProperty('author')
    expect(user).not.toHaveProperty('temperament')
    expect(user.profiles.every((p: object) => !('known' in p))).toBe(true)
    expect(() => validateWhisperComments({ comments: people.map(p => ({ speaker: p.id, text: "I'm the anonymous author." })) }, people)).toThrow()
    expect(() => validateWhisperComments({ comments: people.map(() => ({ speaker: 'outsider', text: 'Hi.' })) }, people)).toThrow()
    expect(whisperMentions('@sarah hi @minaret', people)).toEqual(['a'])
  })
})

describe('public evidence and stable writes', () => {
  it('keeps article comments separate from direct replies and routes a named greeting before random bystanders', async () => {
    const { complete } = api()
    vi.spyOn(Math, 'random').mockReturnValue(.9)
    const publicIssue = issue()
    publicIssue.comments.push({ id: 'npc', person: { id: 'b', name: 'Mina Rose', handle: 'mina' }, player: false, text: 'An interesting read.', mentions: [] })
    useGameStore.setState({ exVenusWhisper: { ...ensureWhisperAuthor(game(), () => 0), issues: [publicIssue] } })
    const root = await commentOnWhisper(id(), 'Hi, Sarah.', undefined, active)
    await replyOnWhisper(id(), root, 'test', active)
    const request = JSON.parse(complete.mock.calls.at(-1)![0].user)
    expect(request.profiles.map((p: { id: string }) => p.id)).toEqual(['a'])
    expect(request.respondingTo.placement).toBe('article-comment')
    expect(request.respondingTo.parent).toBeUndefined()
    expect(request.respondingTo.addressedTo.map((p: { id: string }) => p.id)).toEqual(['a'])
    expect(game().exVenusWhisper.issues[0].comments.find(c => c.id === root)?.replyTo).toBeUndefined()
    expect(game().exVenusWhisper.issues[0].comments.at(-1)?.replyTo).toBe(root)
    const direct = await commentOnWhisper(id(), 'What did you think?', 'npc', active)
    await replyOnWhisper(id(), direct, 'test', active)
    const reply = JSON.parse(complete.mock.calls.at(-1)![0].user)
    expect(reply.profiles.map((p: { id: string }) => p.id)).toEqual(['b'])
    expect(reply.respondingTo.placement).toBe('comment-reply')
    expect(reply.respondingTo.parent.id).toBe('npc')
    expect(reply.respondingTo.addressedTo.map((p: { id: string }) => p.id)).toEqual(['b'])
  })

  it('does not turn third-person, partial or ambiguous names into direct recipients', () => {
    const people = whisperPeople(game())
    const sharedName = [...people, { ...people[0], id: 'c', name: 'Sarah Stone', handle: 'sarah_stone' }]
    const addressed = (text: string, profiles = people): string[] => whisperAddressees({ ...issue(), comments: [
      { id: 'player', person: { id: 'reader', name: 'Sam Rowe', handle: 'sam_rowe' }, player: true, text, mentions: [] }
    ] }, 'player', profiles).map(p => p.id)
    expect(addressed('Sarah had a great idea.')).toEqual([])
    expect(addressed('Hi, Sarahlynn.')).toEqual([])
    expect(addressed('Hi, Sarah.', sharedName)).toEqual([])
    expect(addressed('Hi, Sarah Rose.', sharedName)).toEqual(['a'])
    expect(addressed('@sarah_stone what do you think?', sharedName)).toEqual(['c'])
    expect(addressed('Mina, what do you think?')).toEqual(['b'])
  })

  it('excludes private, future, unknown and held-photo sources; recall has no secret profile and stays bounded', () => {
    useGameStore.setState(s => ({ charInfo: { ...s.charInfo, b: { ...s.charInfo.b, feed: [
      { id: 'future', text: 'FUTURE POST', date: 8, time: 0, likes: 0 },
      { id: 'held', text: 'HELD PHOTO', date: 7, time: 0, likes: 0, photo: { tier: 'sfw', held: true } }
    ] } }, npcRelationships: { 'a|b': { affinity: 2, encounter: { date: 6, kind: 'hangout', ref: 'room', positive: true } } } }))
    expect(whisperSources(game())).toHaveLength(1)
    expect(JSON.stringify(whisperSources(game()))).not.toMatch(/PRIVATE|FUTURE|HELD/)
    useGameStore.setState({ exVenusWhisper: { ...ensureWhisperAuthor(game(), () => 0), issues: [issue()] } })
    const recall = whisperRecall(game().exVenusWhisper, 0, 7, ['a']).join('\n')
    expect(recall).not.toContain('voice')
    expect(recall).not.toContain('Sarah is warm')
    expect(recall.length).toBeLessThan(7200)
    expect(whisperRecall(game().exVenusWhisper, 0, 6, ['a'])).toEqual([])
    expect(whisperRecall(game().exVenusWhisper, 0, 10, ['a'])).toEqual([])
    expect(whisperRecall(game().exVenusWhisper, 0, 7, ['unrelated'])).toEqual([])
  })

  it('publishes once, saves player comments before replies, and retries a failed batch without duplicating or impersonating anyone', async () => {
    const { complete, save } = api(), before = game().toGameSave()
    const published = await publishWhisper('test', active)
    await publishWhisper('test', active)
    expect(complete).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledTimes(2)
    const parent = await commentOnWhisper(published, '@mina what do you think?', undefined, active)
    complete.mockResolvedValueOnce({ ok: false, error: { code: 'OFFLINE', message: 'Offline' } })
    await expect(replyOnWhisper(published, parent, 'test', active)).rejects.toThrow('Offline')
    expect(game().exVenusWhisper.issues[0].comments).toHaveLength(1)
    const added = await replyOnWhisper(published, parent, 'test', active)
    expect(added.length).toBeGreaterThan(0)
    const comments = game().exVenusWhisper.issues[0].comments
    expect(comments.slice(1).every(c => c.replyTo === parent && !c.player)).toBe(true)
    expect(comments[0].person.name).toBe('Sam Rowe')
    const count = complete.mock.calls.length
    await replyOnWhisper(published, parent, 'test', active)
    expect(complete).toHaveBeenCalledTimes(count)
    const after = game().toGameSave()
    expect({ ...after, exVenusWhisper: undefined }).toEqual({ ...before, exVenusWhisper: undefined })
    await dismissWhisper(published, active)
    await publishWhisper('test', active)
    expect(game().exVenusWhisper.issues).toEqual([])
    expect(complete).toHaveBeenCalledTimes(count)
  })

  it('keeps the chosen author after a writer failure but never files results after closing, reloading, changing date or disabling', async () => {
    for (const mode of ['close', 'load', 'date', 'off']) {
      seed(); const { complete, save } = api(); let alive = true
      let finish!: (r: Result<WhisperDraft>) => void
      complete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      const pending = publishWhisper('test', () => alive)
      await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce())
      expect(game().exVenusWhisper.author).toBeDefined()
      if (mode === 'close') alive = false
      if (mode === 'load') useGameStore.setState(s => ({ loads: s.loads + 1 }))
      if (mode === 'date') useGameStore.setState(s => ({ date: s.date + 1 }))
      if (mode === 'off') useModsStore.setState({ switches: { on: { [VENUS_WHISPER_MOD]: false }, options: {} } })
      finish({ ok: true, data: { title: 'A day', body: 'At the park.', sources: [], comments: [] } })
      await expect(pending).rejects.toThrow('changed')
      expect(save).toHaveBeenCalledOnce()
      expect(game().exVenusWhisper.issues).toEqual([])
    }
  })

  it('leaves a save untouched on disk failure and preserves optional data while the switch is off', async () => {
    const { save } = api()
    save.mockResolvedValueOnce({ ok: false, error: { code: 'DISK', message: 'Disk full' } })
    await expect(publishWhisper('test', active)).rejects.toThrow('Disk full')
    expect(game().exVenusWhisper.author).toBeUndefined()
    await publishWhisper('test', active)
    const before = structuredClone(game().exVenusWhisper)
    useModsStore.setState({ switches: { on: { [VENUS_WHISPER_MOD]: false }, options: {} } })
    await expect(commentOnWhisper(id(), 'Hello', undefined, active)).rejects.toThrow('settled')
    expect(game().toGameSave().exVenusWhisper).toEqual(before)
  })
})
