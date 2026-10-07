import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, TextingResponse, Result, GameSave, StructuredRequest } from '@shared/types'
import { beforeTextReply, checkedTextReplacement, latestTextReply, replaceTextReply, TEXT_REGENERATION_MOD } from '@shared/textRegeneration'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { useModsStore } from '../src/renderer/stores/modsStore'
import { useBunnyboardStore } from '../src/renderer/stores/bunnyboardStore'
import { regenerateTextReply, resetTextingLoop, textRegenerationTarget } from '../src/renderer/stores/textingLoop'
import { persistRegeneratedConversation, writesSettled } from '../src/renderer/stores/loop/saves'
import { character, charactersById, charInfo, restoreApi, stubApi } from './fixtures'

function thread(count = 5): Conversation {
  return { charId: 'a', unread: count, summary: 'Summary including rejected answer',
    exTextBase: { replyTo: 'sent', summary: 'Prior summary' }, messages: [
      { id: 'earlier', sender: 'contact', text: 'Earlier', date: 6, time: 0 },
      { id: 'sent', sender: 'player', text: 'How was your day?', date: 7, time: 0 },
      ...Array.from({ length: count }, (_, i) => ({ id: `old-${i}`, sender: 'contact' as const,
        text: `Old reply ${i}`, date: 7, time: 0 as const, exReplyTo: 'sent' }))
    ] }
}
const answer: TextingResponse = { messages: ['New one', 'New two'], summary: 'New summary', blocked: false }
const read = (): Conversation => useGameStore.getState().bunnyboard.conversations.a
function seed(): void {
  resetTextingLoop()
  useGameStore.getState().reset()
  useBunnyboardStore.getState().reset()
  useModsStore.setState({ switches: { on: {}, options: {} } })
  useGameStore.setState({ playthroughId: 'p', date: 7, time: 0, chars: ['a'],
    characters: charactersById(character({ charId: 'a' })), charKeyToId: { sarah_rose: 'a' },
    charInfo: { a: charInfo({ nameKnown: true }) },
    bunnyboard: { ...useGameStore.getState().bunnyboard, conversations: { a: thread() } } })
}
beforeEach(seed)
afterEach(async () => { resetTextingLoop(); await writesSettled(); restoreApi(); vi.restoreAllMocks() })

describe('whole reply rules', () => {
  it('replaces more than three bubbles as a unit, preserving the player and earlier history', () => {
    const original = thread(9), target = latestTextReply(original, 7, 0)!
    const next = replaceTextReply(target, checkedTextReplacement(answer), () => crypto.randomUUID())
    expect(next.messages.slice(0, 2)).toEqual(original.messages.slice(0, 2))
    expect(next.messages.slice(2).map(m => m.text)).toEqual(answer.messages)
    expect(next.messages.slice(2).every(m => m.exReplyTo === 'sent')).toBe(true)
    expect(next.summary).toBe('New summary')
    expect(original.messages).toHaveLength(11)
    expect(beforeTextReply(latestTextReply(next, 7, 0)!).summary).toBe('Prior summary')
  })
  it('never uses the rejected summary and supports legacy replies without a checkpoint', () => {
    const old = thread(); delete old.exTextBase
    const before = beforeTextReply(latestTextReply(old, 7, 0)!)
    expect(before.summary).toBeNull()
    expect(before.messages.map(m => m.id)).toEqual(['earlier'])
  })
  it('rejects earlier slots, invitations, system consequences, and inconsistent reply groups', () => {
    expect(latestTextReply(thread(), 7, 1)).toBeNull()
    expect(latestTextReply({ ...thread(), pendingHangout: { description: 'Coffee' } }, 7, 0)).toBeNull()
    const invitation = thread(); invitation.messages[0].invite = true
    expect(latestTextReply(invitation, 7, 0)).toBeNull()
    const consequence = thread(); consequence.messages.push({ id: 'block', sender: 'system', text: 'Blocked', date: 7, time: 0 })
    expect(latestTextReply(consequence, 7, 0)).toBeNull()
    const mismatch = thread(); mismatch.messages[2].exReplyTo = 'another-turn'
    expect(latestTextReply(mismatch, 7, 0)).toBeNull()
  })
  it('rejects blocked, empty, partial, or excessive replacements', () => {
    for (const bad of [{ ...answer, blocked: true }, { ...answer, messages: [] },
      { ...answer, messages: [''] }, { ...answer, summary: '' },
      { ...answer, messages: Array(13).fill('x') }]) expect(() => checkedTextReplacement(bad)).toThrow()
  })
  it('switching off hides the command without discarding saved checkpoint data', () => {
    useModsStore.setState({ switches: { on: { [TEXT_REGENERATION_MOD]: false }, options: {} } })
    expect(textRegenerationTarget('a')).toBeNull()
    expect(read().exTextBase?.summary).toBe('Prior summary')
  })
})

function api(complete = vi.fn(async (_request: StructuredRequest): Promise<Result<TextingResponse>> => ({ ok: true, data: answer }))) {
  const classify = vi.fn(async () => ({ ok: true as const, data: { playerAsked: false, characterOffered: false, description: '' } }))
  const save = vi.fn(async () => ({ ok: true as const, data: useGameStore.getState().toGameSave() as GameSave }))
  stubApi({ llm: { completeTexting: complete, classifyHangout: classify }, saves: { autosave: save } })
  return { complete, classify, save }
}
describe('regeneration transaction', () => {
  it.each([true, false])('respects Story Memory being %s while retaining independent Breakthrough continuity', async (enabled) => {
    useModsStore.setState({ switches: { on: { 'story-memory': enabled, breakthrough: true }, options: {} } })
    useGameStore.setState({ playthroughId: '123', history: { 6: { 0: 'Sarah and the reader planned a picnic.' } },
      exBreakthrough: { meters: { a: 35 }, settled: {}, pending: null,
        moments: { a: [{ id: 'promise', date: 6, time: 0, outcome: 'Sarah promised to bring the picnic basket.' }] } } })
    const { complete } = api(), before = useGameStore.getState().exBreakthrough
    await regenerateTextReply('a', persistRegeneratedConversation)
    const request = complete.mock.calls[0][0]
    if (enabled) {
      expect(request.storyMemory?.records.map(r => r.text)).toContain('Sarah and the reader planned a picnic.')
      expect(request.storyMemory?.cast).toContain('a')
    } else expect(request.storyMemory).toBeUndefined()
    expect(request.user).toContain('Sarah promised to bring the picnic basket.')
    expect(useGameStore.getState().exBreakthrough).toEqual(before)
  })
  it('saves the entire replacement before making it visible; read receipts do not cancel it', async () => {
    const { complete, save } = api()
    let finish!: (value: Result<TextingResponse>) => void
    complete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const original = read(), pending = regenerateTextReply('a', persistRegeneratedConversation)
    expect(useBunnyboardStore.getState().busyCharIds).toContain('a')
    expect(read()).toBe(original)
    useGameStore.getState().markConversationRead('a')
    save.mockImplementationOnce(async () => {
      expect(read().messages).toEqual(original.messages)
      return { ok: true, data: useGameStore.getState().toGameSave() as GameSave }
    })
    finish({ ok: true, data: answer })
    await expect(pending).resolves.toEqual({ replaced: 5, created: 2 })
    expect(read().unread).toBe(0)
    expect(read().messages).toHaveLength(4)
    expect(save).toHaveBeenCalledOnce()
    expect(useBunnyboardStore.getState().busyCharIds).not.toContain('a')
    const request = complete.mock.calls[0][0] as unknown as { user: string }
    expect(request.user).not.toContain('Summary including rejected answer')
    expect(request.user).not.toContain('Old reply')
  })
  it('keeps every original bubble and summary when generation fails', async () => {
    const { complete, save } = api(), original = read()
    complete.mockResolvedValueOnce({ ok: false, error: { code: 'FAILED', message: 'Failed' } })
    await expect(regenerateTextReply('a', persistRegeneratedConversation)).rejects.toThrow('Failed')
    expect(read()).toBe(original); expect(save).not.toHaveBeenCalled()
  })
  it('does not commit a new hangout or blocking outcome', async () => {
    const { complete, classify, save } = api(), original = read()
    classify.mockResolvedValueOnce({ ok: true, data: { playerAsked: false, characterOffered: true, description: 'Coffee now' } })
    await expect(regenerateTextReply('a', persistRegeneratedConversation)).rejects.toThrow('hangout')
    complete.mockResolvedValueOnce({ ok: true, data: { ...answer, blocked: true } })
    await expect(regenerateTextReply('a', persistRegeneratedConversation)).rejects.toThrow('block')
    expect(read()).toBe(original); expect(save).not.toHaveBeenCalled()
  })
  it('does not publish a replacement when the save fails', async () => {
    api(); const original = read()
    stubApi({ llm: { completeTexting: async () => ({ ok: true, data: answer }),
      classifyHangout: async () => ({ ok: true, data: { playerAsked: false, characterOffered: false, description: '' } }) },
      saves: { autosave: async () => ({ ok: false, error: { code: 'DISK', message: 'Disk full' } }) } })
    await expect(regenerateTextReply('a', persistRegeneratedConversation)).rejects.toThrow('Disk full')
    expect(read()).toBe(original)
  })
  it('discards late results after a reload or changed conversation', async () => {
    for (const change of [() => useGameStore.setState(s => ({ loads: s.loads + 1 })),
      () => useGameStore.getState().setConversationSummary('a', 'Changed')]) {
      seed(); const { complete, save } = api()
      let finish!: (value: Result<TextingResponse>) => void
      complete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      const pending = regenerateTextReply('a', persistRegeneratedConversation)
      change(); finish({ ok: true, data: answer })
      await expect(pending).rejects.toThrow('changed')
      expect(save).not.toHaveBeenCalled()
      expect(read().messages).toHaveLength(7)
    }
  })
})
