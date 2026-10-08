import { carryWhisper } from './venusWhisper'
import { FINAL_DATE } from './classes'
import { isBossChat } from './jobs'
import { pairKeyOf, type NpcFriendship, type NpcRelationshipMap } from './npcRelationships'
import { rustedStats, type PlayerStats } from './playerStats'
import { emptyTallies } from './tallies'
import { daysToNextTerm, graduatesAfter, seasonOf, termIndexOf, type Season } from './term'
import type {
  BunnyboardState,
  Character,
  CharMemory,
  CharState,
  Conversation,
  GameSave,
  MemoryType,
  PlaythroughRecord,
  SaveDraft
} from './types'
import type { TermCarry } from './termTypes'
import { carryModState } from './modTermCarry'

/**
 * Carrying a finished semester into the next one: who can come back, and what the new term's
 * opening save takes over from the old term's last one. Every date here is a day index of the
 * semester it was written in, so whatever is carried is moved back by the days between the two
 * day 0s and falls before the new term begins. Pure.
 */

/** Whoever on a finished playthrough's roster is still at the university next semester, in roster order. */
export function returningChars(record: PlaythroughRecord): string[] {
  const season = seasonOf(termIndexOf(record))
  return record.chars.filter(
    (charId) => !graduatesAfter(record.profiles[charId]?.year ?? 1, season)
  )
}

/** Whoever on that roster has graduated and cannot be kept, in roster order. */
export function graduatedChars(record: PlaythroughRecord): string[] {
  const returning = new Set(returningChars(record))
  return record.chars.filter((charId) => !returning.has(charId))
}

/** One memory with its date moved back. */
function movedMemory(memory: CharMemory, back: number): CharMemory {
  return { ...memory, date: memory.date - back }
}

/**
 * One returning character's moving half as the new term opens on it: what she remembers, what
 * the two of them are to each other and what she has posted, all dated before day 0; and
 * nothing that belonged to the old timetable — her shifts, where he had found her, what she was
 * suspecting that week, what he had been told about her standards.
 */
function carriedCharState(state: CharState, back: number, kept: ReadonlySet<string>): CharState {
  return {
    memories: state.memories.map((memory) => movedMemory(memory, back)),
    flags: { ...state.flags },
    nameKnown: state.nameKnown,
    ...(state.notes !== undefined ? { notes: state.notes } : {}),
    ...(state.gifts ? { gifts: [...state.gifts] } : {}),
    ...(state.textMemory ? { textMemory: movedMemory(state.textMemory, back) } : {}),
    ...(state.datingSince !== undefined ? { datingSince: state.datingSince - back } : {}),
    ...(state.brokeUpOn !== undefined ? { brokeUpOn: state.brokeUpOn - back } : {}),
    ...(state.leftFor && kept.has(state.leftFor) ? { leftFor: state.leftFor } : {}),
    ...(state.jealousyMemories
      ? { jealousyMemories: state.jealousyMemories.map((memory) => movedMemory(memory, back)) }
      : {}),
    ...(state.giftMemories
      ? { giftMemories: state.giftMemories.map((memory) => movedMemory(memory, back)) }
      : {}),
    ...(state.feed
      ? {
          feed: state.feed.map((post) => ({
            ...post,
            date: post.date - back,
            ...(post.likedOn !== undefined ? { likedOn: post.likedOn - back } : {}),
            // A reply is kept back until its own slot, so its slot moves with the post's.
            ...(post.comments
              ? {
                  comments: post.comments.map((comment) => ({
                    ...comment,
                    at: comment.at - back * 2
                  }))
                }
              : {})
          }))
        }
      : {}),
    ...(state.seenOutfits ? { seenOutfits: [...state.seenOutfits] } : {})
  }
}

/** One thread as it is carried: every message dated back, and no invitation left standing. */
function carriedConversation(conversation: Conversation, back: number): Conversation {
  return {
    charId: conversation.charId,
    messages: conversation.messages.map((message) => ({ ...message, date: message.date - back })),
    unread: conversation.unread,
    summary: conversation.summary
  }
}

/**
 * The phone as it is carried: every thread but a boss's and those with somebody who is not
 * coming back, and the requests still pending between him and whoever is.
 */
function carriedBunnyboard(
  bunnyboard: BunnyboardState,
  back: number,
  roster: ReadonlySet<string>,
  kept: ReadonlySet<string>
): BunnyboardState {
  const gone = (key: string): boolean => isBossChat(key) || (roster.has(key) && !kept.has(key))
  return {
    conversations: Object.fromEntries(
      Object.entries(bunnyboard.conversations)
        .filter(([key]) => !gone(key))
        .map(([key, conversation]) => [key, carriedConversation(conversation, back)])
    ),
    requestsSent: bunnyboard.requestsSent.filter((charId) => kept.has(charId)),
    requestsReceived: bunnyboard.requestsReceived.filter((charId) => kept.has(charId)),
    contactsBadge: bunnyboard.contactsBadge
  }
}

/** What the returning girls think of each other, with whatever they last ran into each other over left behind. */
function carriedRelationships(
  map: NpcRelationshipMap,
  kept: readonly string[]
): NpcRelationshipMap {
  const carried: NpcRelationshipMap = {}
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      const key = pairKeyOf(kept[i], kept[j])
      if (map[key]) carried[key] = { affinity: map[key].affinity }
    }
  }
  return carried
}

/** The friendships on record between two girls who are both coming back, dated back. */
function carriedFriendships(
  friendships: readonly NpcFriendship[],
  back: number,
  kept: ReadonlySet<string>
): NpcFriendship[] {
  return friendships
    .filter((entry) => kept.has(entry.a) && kept.has(entry.b))
    .map((entry) => ({ ...entry, date: entry.date - back }))
}

/** What a finished semester hands the next one: the reader as he comes back, and the carry. */
export interface CarriedTerm {
  /** His stats after the break. */
  stats: PlayerStats
  bio?: string
  carry: TermCarry
}

/**
 * Everything the next semester's opening save takes from `save`, the last save of the semester
 * `record` describes. `kept` is who of its roster is coming back; anybody else is left behind
 * with her thread, her requests and whatever the others thought of her.
 */
export function carryTerm(
  save: GameSave,
  record: PlaythroughRecord,
  kept: readonly string[],
  characters: Record<string, Character> = {}
): CarriedTerm {
  const back = daysToNextTerm(seasonOf(termIndexOf(record)))
  const roster = new Set(record.chars)
  const staying = kept.filter((charId) => roster.has(charId) && save.charInfo[charId])
  const keptSet = new Set(staying)

  return {
    stats: rustedStats(save.stats),
    ...(save.bio ? { bio: save.bio } : {}),
    carry: {
      ...carryModState(save, termIndexOf(record), back, characters),
      ...(save.exVenusWhisper ? { exVenusWhisper: carryWhisper(save.exVenusWhisper, termIndexOf(record), save.date, save.charInfo) } : {}),
      money: save.money,
      ...(save.tallies ? { tallies: { ...save.tallies } } : {}),
      inventory: save.inventory.map((item) => ({ ...item })),
      bunnyboard: carriedBunnyboard(save.bunnyboard, back, roster, keptSet),
      charInfo: Object.fromEntries(
        staying.map((charId) => [charId, carriedCharState(save.charInfo[charId], back, keptSet)])
      ),
      npcRelationships: carriedRelationships(save.npcRelationships, staying),
      npcFriendships: carriedFriendships(save.npcFriendships ?? [], back, keptSet),
      gradesStanding: save.gradesStanding,
      // Past the last slot there is, so nothing BunnyBot owes the clock is ever owed twice.
      bunnybotThrough: Math.max(save.bunnybotThrough, FINAL_DATE * 2 + 1),
      bunnymapUnlocked: save.bunnymapUnlocked,
      // A semester in, the shop is his whether or not the clock ever handed it over.
      bunnyshopUnlocked: true,
      venusJobIntroSent: save.venusJobIntroSent,
      bunnybotContactIntroSent: save.bunnybotContactIntroSent,
      bunnybotFirstPostNudgeSent: save.bunnybotFirstPostNudgeSent,
      bunnybotTwoTimingTipSent: save.bunnybotTwoTimingTipSent,
      ...(save.bunnybotSeenTipSent !== undefined
        ? { bunnybotSeenTipSent: save.bunnybotSeenTipSent }
        : {}),
      bunnybotDeferred: [...save.bunnybotDeferred]
    }
  }
}

/**
 * The opening save New Game composed for a fresh semester, with what was carried laid over it:
 * the reader's belongings, phone and standing in place of a newcomer's, and each returning
 * girl's carried half under whatever the new semester dealt her — her job, and her break posts
 * after the feed she already had. What the roster thinks of each other is the carried map,
 * with the fresh roll kept only for the pairs that have somebody new in them.
 */
export function carriedOpening(draft: SaveDraft, carry: TermCarry): SaveDraft {
  const charInfo = Object.fromEntries(
    Object.entries(draft.charInfo).map(([charId, fresh]) => {
      const carried = carry.charInfo[charId]
      if (!carried) return [charId, fresh]
      // Everything New Game set beyond the blank slate a stranger opens on is the new semester's.
      const { memories: _memories, flags: _flags, nameKnown: _nameKnown, feed, ...dealt } = fresh
      const posts = [...(carried.feed ?? []), ...(feed ?? [])]
      return [charId, { ...carried, ...dealt, ...(posts.length > 0 ? { feed: posts } : {}) }]
    })
  )
  const rolled = Object.fromEntries(
    Object.entries(draft.npcRelationships).filter(
      ([pair]) => !pair.split('|').every((charId) => carry.charInfo[charId])
    )
  )
  return {
    ...draft,
    ...(carry.exPlotTwist !== undefined ? { exPlotTwist: carry.exPlotTwist } : {}),
    ...(carry.exStoryMemory ? { exStoryMemory: carry.exStoryMemory } : {}),
    ...(carry.exBreakthrough ? { exBreakthrough: carry.exBreakthrough } : {}),
    ...(carry.exNpcWatch ? { exNpcWatch: carry.exNpcWatch } : {}),
    ...(carry.exVenusWhisper ? { exVenusWhisper: carry.exVenusWhisper } : {}),
    money: carry.money,
    tallies: {
      ...emptyTallies(),
      ...carry.tallies,
      tokensGenerated:
        (carry.tallies?.tokensGenerated ?? 0) + (draft.tallies?.tokensGenerated ?? 0)
    },
    charInfo,
    bunnyboard: carry.bunnyboard,
    inventory: carry.inventory,
    gradesStanding: carry.gradesStanding,
    bunnybotThrough: carry.bunnybotThrough,
    bunnymapUnlocked: carry.bunnymapUnlocked,
    bunnyshopUnlocked: carry.bunnyshopUnlocked,
    venusJobIntroSent: carry.venusJobIntroSent,
    bunnybotContactIntroSent: carry.bunnybotContactIntroSent,
    bunnybotFirstPostNudgeSent: carry.bunnybotFirstPostNudgeSent,
    bunnybotTwoTimingTipSent: carry.bunnybotTwoTimingTipSent,
    ...(carry.bunnybotSeenTipSent !== undefined
      ? { bunnybotSeenTipSent: carry.bunnybotSeenTipSent }
      : {}),
    bunnybotDeferred: carry.bunnybotDeferred,
    npcRelationships: { ...rolled, ...carry.npcRelationships },
    npcFriendships: carry.npcFriendships ?? []
  }
}

/**
 * Every field of a save, and what a continued semester does with it: `carried` is taken over
 * from the semester before, `fresh` opens as New Game composes it. Nothing reads the values;
 * the table exists so that a field added to the save fails to compile here until somebody has
 * decided which it is.
 */
const _SAVE_FIELDS: Record<keyof SaveDraft, 'carried' | 'fresh'> = {
  schemaVersion: 'fresh',
  stats: 'carried',
  money: 'carried',
  bio: 'carried',
  exPlotTwist: 'carried',
  exStoryMemory: 'carried',
  exBreakthrough: 'carried',
  exNpcWatch: 'carried',
  exVenusWhisper: 'carried',
  tallies: 'carried',
  date: 'fresh',
  time: 'fresh',
  charInfo: 'carried',
  playerSchedule: 'fresh',
  history: 'fresh',
  bunnyboard: 'carried',
  events: 'fresh',
  job: 'fresh',
  jobsClosed: 'fresh',
  inventory: 'carried',
  classRecords: 'fresh',
  gradesStanding: 'carried',
  expelled: 'fresh',
  midtermStandingDone: 'fresh',
  finalsScoresShown: 'fresh',
  venusThrough: 'fresh',
  bunnybotThrough: 'carried',
  bunnymapUnlocked: 'carried',
  bunnyshopUnlocked: 'carried',
  venusJobIntroSent: 'carried',
  bunnybotContactIntroSent: 'carried',
  bunnybotFirstPostNudgeSent: 'carried',
  bunnybotTwoTimingTipSent: 'carried',
  bunnybotSeenTipSent: 'carried',
  bunnybotDeferred: 'carried',
  droppedClasses: 'fresh',
  addedClasses: 'fresh',
  npcRelationships: 'carried',
  npcFriendships: 'carried',
  occasionsDeclined: 'fresh',
  npcOverlay: 'fresh',
  slotRumor: 'fresh',
  lastSlotCast: 'fresh',
  weekendOutings: 'fresh',
  outingSlots: 'fresh',
  springBreakAway: 'fresh',
  feedExtras: 'fresh',
  graduationSeen: 'fresh',
  farewellsDone: 'fresh',
  endingArtWanted: 'fresh',
  scene: 'fresh',
  thumbnail: 'fresh'
}

/** The same table for one character's moving half: `carried` across the break, or `left` behind. */
const _CHAR_FIELDS: Record<keyof CharState, 'carried' | 'left'> = {
  memories: 'carried',
  flags: 'carried',
  nameKnown: 'carried',
  notes: 'carried',
  job: 'left',
  metSlots: 'left',
  ignoredInvitation: 'left',
  gifts: 'carried',
  textMemory: 'carried',
  suspicions: 'left',
  datingSince: 'carried',
  brokeUpOn: 'carried',
  leftFor: 'carried',
  jealousyMemories: 'carried',
  giftMemories: 'carried',
  crushHint: 'left',
  feed: 'carried',
  seenOutfits: 'carried'
}
void _SAVE_FIELDS
void _CHAR_FIELDS

/** One thing a returning girl remembers of the break, as the break call wrote it. */
export interface BreakMemory {
  type: MemoryType
  desc: string
  /**
   * The day it happened on, counted back from day 0 of the semester the break leads up to, where
   * the break was played and the day is known; absent, it is dated into the break's last days.
   */
  date?: number
}

/** How many days before day 0 the break's last memory is dated; the others step back from it. */
const BREAK_MEMORY_LAST_DAY = -1
const BREAK_MEMORY_STEP = 1

/**
 * `carry` with what each returning girl remembers of the break filed after everything she
 * already remembered: each on the day it happened where the break was played and that is known,
 * and otherwise dated into the last days before the semester, oldest first, so they are what she
 * feels most on day 0. They fade like any other memory after it. Everything older has
 * already faded to its least over the break, so these are what decide how she comes back.
 */
export function withBreakMemories(
  carry: TermCarry,
  memories: Readonly<Record<string, readonly BreakMemory[]>>
): TermCarry {
  const charInfo = Object.fromEntries(
    Object.entries(carry.charInfo).map(([charId, state]) => {
      const written = memories[charId] ?? []
      if (written.length === 0) return [charId, state]
      // What has no day of its own is stepped back from the last day, oldest first; what has one
      // keeps it, and the whole is filed in the order it happened.
      const loose = written.filter((memory) => memory.date === undefined)
      const dated: CharMemory[] = written
        .map((memory) => ({
          date:
            memory.date ??
            BREAK_MEMORY_LAST_DAY -
              (loose.length - 1 - loose.indexOf(memory)) * BREAK_MEMORY_STEP,
          type: memory.type,
          desc: memory.desc
        }))
        .sort((a, b) => a.date - b.date)
      return [charId, { ...state, memories: [...state.memories, ...dated] }]
    })
  )
  return { ...carry, charInfo }
}

/** How many days after a semester's last the epilogue's own posts can land on. */
const ENDING_POSTS_SPAN = 8

/** The nearest day to the new semester a break post is dated on. */
const BREAK_POST_LAST_DAY = -6

/**
 * The window a post made over the break before a semester is dated into, as days counted back
 * from its day 0: from after the goodbyes of the `from` semester to a few days before move-in.
 */
export function breakPostWindow(from: Season): { first: number; last: number } {
  return {
    first: FINAL_DATE - daysToNextTerm(from) + ENDING_POSTS_SPAN,
    last: BREAK_POST_LAST_DAY
  }
}
