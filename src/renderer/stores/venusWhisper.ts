import {
  VENUS_WHISPER_MOD, WHISPER_COMMENTS, WHISPER_TEXT, ensureWhisperAuthor, whisperAddressees, whisperCommenters,
  whisperWednesday, whisperWeekOccupied, whisperDiscussionOpen, whisperSpotlight, whisperIssueId, whisperMentions, whisperPeople, whisperPlayerHandle, whisperSources, validateWhisperComments,
  validateWhisperDraft, withWhisperIssue, type VenusWhisper, type WhisperComment, type WhisperIssue
} from '@shared/venusWhisper'
import { fullNameOf } from '@shared/types'
import { create } from 'zustand'
import { anonymousVoice, buildWhisperIssue, buildWhisperReplies } from '../prompts/venusWhisperPrompt'
import { useGameStore } from './gameStore'
import { modIsOn } from './modsStore'
import { manualSaveOffer, writeWhisper } from './loop/saves'

/** A reopened viewer observes an older request finishing or cancelling. */
export const useWhisperActivity = create<{ working: boolean }>(() => ({ working: false }))

/** Read-only browsing stays available; publication waits for a stable scene or landing. */
export function whisperReady(): boolean {
  const game = useGameStore.getState()
  return !useWhisperActivity.getState().working && modIsOn(VENUS_WHISPER_MOD) && !game.sceneEnding && manualSaveOffer() === 'open'
}

/** Delivery can wait for the current scene to settle without spending another generation call. */
export async function waitForWhisperCheckpoint(active: () => boolean): Promise<void> {
  while (active()) {
    if (!useGameStore.getState().sceneEnding && manualSaveOffer() === 'open') return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw Error('The game changed. No newsletter changes were saved.')
}

/** Public interactions follow the exact clock; scheduled delivery follows the same loaded game. */
async function operation<T>(active: () => boolean, run: (commit: (next: VenusWhisper) => Promise<void>, current: () => boolean) => Promise<T>, followClock = false): Promise<T> {
  if (!whisperReady()) throw Error('Wait until the current scene or messages have settled.')
  const start = useGameStore.getState()
  const current = (): boolean => {
    const now = useGameStore.getState()
    return active() && modIsOn(VENUS_WHISPER_MOD) && now.playthroughId === start.playthroughId && now.loads === start.loads &&
      now.termIndex === start.termIndex && (followClock ? now.date >= start.date :
        now.date === start.date && now.time === start.time && !now.sceneEnding)
  }
  const commit = async (next: VenusWhisper): Promise<void> => {
    if (followClock) await waitForWhisperCheckpoint(current)
    if (!current()) throw Error('The game changed. Reopen the newsletter.')
    await writeWhisper(next, useGameStore.getState().exVenusWhisper, current)
  }
  useWhisperActivity.setState({ working: true })
  try { return await run(commit, current) } finally { useWhisperActivity.setState({ working: false }) }
}

/** Author selection is saved before the first paid call, so failures and retries never reroll her. */
export async function publishWhisper(group: string, active: () => boolean, automatic = false): Promise<string> {
  return operation(active, async (commit, current) => {
    let game = useGameStore.getState()
    const day = whisperWednesday(game.date)
    if (day === null) throw Error('The first edition arrives on Wednesday.')
    const id = whisperIssueId(game.termIndex, day)
    if (whisperWeekOccupied(game.exVenusWhisper, game.termIndex, game.date)) {
      return game.exVenusWhisper.issues.find(i => i.term === game.termIndex && i.day >= day && i.day <= game.date)?.id ?? id
    }
    await commit(ensureWhisperAuthor(game, Math.random))
    game = useGameStore.getState()
    const previous = game.exVenusWhisper.issues.filter(i => i.term < game.termIndex || i.day < day).sort((a,b) => b.term-a.term || b.day-a.day)[0]
    const editorial = whisperSpotlight(whisperSources({ ...game, date: day, time: 0 }), previous?.subjects)
    const sources = editorial.sources, author = game.exVenusWhisper.author!
    const person = whisperPeople(game).find(p => p.id === editorial.focus)
    const voice = anonymousVoice(author.voice, [author.name, ...Object.values(game.characters).map(fullNameOf)])
    const response = await window.api.llm.completeWhisper(buildWhisperIssue(sources, voice, person ? { name: person.name, handle: person.handle } : undefined), group)
    if (!current()) throw Error('The game changed. No issue was published.')
    if (!response.ok) throw Error(response.error.message)
    const draft = validateWhisperDraft(response.data, sources, [])
    const issue: WhisperIssue = { id, term: game.termIndex, day, weekly: true, read: false, title: draft.title, body: draft.body,
      subjects: [...new Set(sources.filter(s => draft.sources.includes(s.id)).flatMap(s => s.subjects))], comments: [], answered: [] }
    await commit(withWhisperIssue(useGameStore.getState().exVenusWhisper, issue))
    return id
  }, automatic)
}

/** File the reader's words before generating a reply; a failed writer leaves them retryable. */
export async function commentOnWhisper(issueId: string, value: string, replyTo: string | undefined, active: () => boolean): Promise<string> {
  return operation(active, async commit => {
    const game = useGameStore.getState(), state = game.exVenusWhisper
    const issue = state.issues.find(i => i.id === issueId)
    if (!issue || !whisperDiscussionOpen(issue, game.termIndex, game.date)) throw Error('This issue is archived. Join a current discussion instead.')
    if (!value.trim() || value.length > WHISPER_TEXT) throw Error(`Write a comment of 1–${WHISPER_TEXT} characters.`)
    if (issue.comments.length >= WHISPER_COMMENTS - 3) throw Error('This discussion is full.')
    if (replyTo && !issue.comments.some(c => c.id === replyTo)) throw Error('That comment is no longer available.')
    const id = crypto.randomUUID()
    const comment: WhisperComment = { id, person: { id: 'reader', name: [game.playerFirstName, game.playerLastName].filter(Boolean).join(' ') || 'Reader', handle: whisperPlayerHandle(game.playerFirstName, game.playerLastName) }, player: true,
      text: value.trim(), mentions: whisperMentions(value, whisperPeople(game)), ...(replyTo ? { replyTo } : {}) }
    await commit(withWhisperIssue(state, { ...issue, comments: [...issue.comments, comment] }))
    return id
  })
}

/** One bounded reply batch; the secret author uses exactly the same prompt as the other readers. */
export async function replyOnWhisper(issueId: string, replyTo: string | undefined, group: string, active: () => boolean, automatic = false): Promise<string[]> {
  const discussionCurrent = (): boolean => {
    const game = useGameStore.getState(), issue = game.exVenusWhisper.issues.find(i => i.id === issueId)
    return active() && !!issue && whisperDiscussionOpen(issue, game.termIndex, game.date)
  }
  return operation(discussionCurrent, async (commit, current) => {
    const game = useGameStore.getState(), state = game.exVenusWhisper, issue = state.issues.find(i => i.id === issueId)
    if (!issue || !whisperDiscussionOpen(issue, game.termIndex, game.date)) throw Error('This issue is archived.')
    const target = issue.comments.find(c => c.id === replyTo)
    if (replyTo && (!target?.player || issue.answered.includes(replyTo))) return []
    if (!replyTo && issue.comments.some(c => !c.player)) return []
    const addressees = whisperAddressees(issue, replyTo, whisperPeople(game))
    const priority = addressees.map(p => p.id)
    const people = whisperCommenters(game, Math.random, priority, Math.min(WHISPER_COMMENTS - issue.comments.length, replyTo ? (Math.random() < .35 ? 3 : 1) : 3))
    if (!people.length) return []
    const response = await window.api.llm.completeWhisper(buildWhisperReplies(issue, people, replyTo, whisperPlayerHandle(game.playerFirstName, game.playerLastName), addressees), group)
    if (!current()) throw Error('The game changed. No replies were added.')
    if (!response.ok) throw Error(response.error.message)
    const batch = validateWhisperComments(response.data, people).map(c => {
      const p = people.find(p => p.id === c.speaker)!
      return { id: crypto.randomUUID(), person: { id: p.id, name: p.name, handle: p.handle }, player: false,
        text: c.text, mentions: whisperMentions(c.text, whisperPeople(game)), ...(replyTo ? { replyTo } : {}) }
    })
    await commit(withWhisperIssue(state, { ...issue, comments: [...issue.comments, ...batch], answered: [...issue.answered, ...(replyTo ? [replyTo] : [])] }))
    return batch.map(c => c.id)
  }, automatic)
}

/** A removed issue stays removed for its publication day, including after a reload or new term. */
export async function dismissWhisper(issueId: string, active: () => boolean): Promise<void> {
  await operation(active, async commit => {
    const state = useGameStore.getState().exVenusWhisper
    await commit({ ...state, issues: state.issues.filter(i => i.id !== issueId), dismissed: [...state.dismissed, issueId] })
  })
}

/** Reading clears the dot only after a successful save; older issues need no migration. */
export async function markWhisperRead(issueId: string, active: () => boolean): Promise<void> {
  await operation(active, async commit => {
    const state = useGameStore.getState().exVenusWhisper
    const issue = state.issues.find(i => i.id === issueId)
    if (!issue || issue.read !== false) return
    await commit(withWhisperIssue(state, { ...issue, read: true }))
  })
}
