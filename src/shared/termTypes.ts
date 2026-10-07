import type { GameSave } from './types'
import type { ModTermCarry } from './modTermCarry'

/**
 * What continuable semesters add to the on-disk shapes, added from outside them where the
 * shape is an interface: a field declared here means exactly what it would inside `types.ts`,
 * and an update that replaces that file carries nothing of this away. Nothing imports this
 * file for a value; it has none.
 */

/** Which semester of the reader's four years a playthrough is, and what it carried on from. */
export interface TermInfo {
  /** 0 is the first spring; every continued semester is one more, so an odd one is a fall. */
  index: number
  /** The playthrough whose ending this semester picks up from. */
  continuedFrom?: string
}

/**
 * What a continued semester's opening save takes over from the save the last one ended on: the
 * reader's belongings and phone, what the Bunnyboard has already handed him, and the moving
 * half of every returning character with its dates moved back across the break.
 */
export type TermCarry = Pick<
  GameSave,
  | 'money'
  | 'inventory'
  | 'bunnyboard'
  | 'charInfo'
  | 'npcRelationships'
  | 'gradesStanding'
  | 'bunnybotThrough'
  | 'bunnymapUnlocked'
  | 'bunnyshopUnlocked'
  | 'venusJobIntroSent'
  | 'bunnybotContactIntroSent'
  | 'bunnybotFirstPostNudgeSent'
  | 'bunnybotTwoTimingTipSent'
  | 'bunnybotDeferred'
> &
  Pick<Partial<GameSave>, 'tallies' | 'npcFriendships' | 'bunnybotSeenTipSent'> & ModTermCarry

declare module './types' {
  interface PlaythroughRecord {
    /** The semester this is; absent on the first spring of a story, and on a record written before terms. */
    term?: TermInfo
  }

  interface PlaythroughSummary {
    /** Which term the playthrough is, off its record or its enrollment; absent for the first spring. */
    term?: number
  }
}
