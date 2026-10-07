import { FALLBACK_DORM } from '@shared/dorms'
import { appError, toAppError } from '@shared/errors'
import { readerStandingOf } from '@shared/relationship'
import { emptyTallies } from '@shared/tallies'
import { isGameOver } from '@shared/money'
import type { PlayerStats } from '@shared/playerStats'
import {
  withBreakEvents,
  withBreakThreads,
  type BreakReach,
  type BreakTalk,
  type BreakVisit
} from '@shared/termBreak'
import { hasNextTerm, seasonOf, termIndexOf, yearAfter } from '@shared/term'
import {
  carryTerm,
  returningChars,
  withBreakMemories,
  type BreakMemory,
  type CarriedTerm
} from '@shared/termCarry'
import {
  charKeyOf,
  type AppError,
  type Character,
  type Enrollment,
  type FeedAssignment,
  type GameSave,
  type HiddenScheduleAssignment,
  type JobAssignment,
  type Occasion,
  type PlaythroughRecord,
  type Result,
  type StructuredRequest
} from '@shared/types'
import {
  buildBreakPrompt,
  normalizeBreakReply,
  type BreakCharInput,
  type BreakGenReply
} from '../prompts/breakPrompt'
import {
  buildClassPrompt,
  decorateClasses,
  validateClassDraft,
  type ClassGenReply,
  type ReturningStudents
} from '../prompts/classPrompt'
import {
  buildProfilePrompt,
  feedAssignmentsOf,
  hiddenScheduleAssignmentsOf,
  jobAssignmentsOf,
  mergeProfiles,
  springBreakAssignmentsOf,
  validateProfileDraft,
  type ProfileGenDraft,
  type ProfileGenReply
} from '../prompts/profilePrompt'
import {
  buildOccasionPrompt,
  normalizeOccasions,
  planOccasionSlots,
  type OccasionGenDraft,
  type OccasionRequest
} from '../prompts/occasionPrompt'
import { SEED_WORD_BAG, SEED_WORDS } from '../prompts/seedWords'
import { readerText } from '../prompts/setting'
import { buildSchedules, type ScheduleResult } from './classScheduler'
import { useGameStore } from './gameStore'
import { useGrabBagStore } from './grabBagStore'
import { useSaveStore } from './saveStore'
import { useUiStore } from './uiStore'
import { retrySilently } from './silentRetry'

/** The cancellation group New Game's one-shots register under. */
export const NEW_GAME_LLM_GROUP = 'newGame:llm'

/**
 * A finished semester being continued: the playthrough, the save it ended on, the record that
 * save is read against, and whoever of its roster is still on disk.
 */
export interface Continuation {
  playthroughId: string
  save: GameSave
  record: PlaythroughRecord
  /** The finished roster resolved, by charId; a character deleted since is absent. */
  characters: Record<string, Character>
  /**
   * How the break after it went, once the break screen has closed it: the reader's stats as it
   * left them and what each returning girl remembers of it, by charId. Absent, the start asks
   * for the memories itself.
   */
  played?: {
    stats: PlayerStats
    memories: Record<string, BreakMemory[]>
    /** The conversations had over it, which are filed on the phone. */
    talks: BreakTalk[]
    /** What the girls sent on their own, of which the unanswered are filed there too. */
    reaches?: BreakReach[]
    /** The slots spent with somebody he travelled to see, whose milestones are carried. */
    visits?: BreakVisit[]
  }
}

/** Everything the one-shot New Game calls produce, settled together. */
export interface StartResult {
  schedules: ScheduleResult
  /** Who works where, by charId — the slots themselves are picked at Finalize. */
  jobs: Record<string, JobAssignment>
  /** Where each character likes to be, by charId — placed at Finalize too. */
  haunts: Record<string, HiddenScheduleAssignment>
  /** Her handle and what she posted over the break, by charId — dated at Finalize. */
  feeds: Record<string, FeedAssignment>
  /** What each of them does with spring break, by charId. */
  springBreakPlans: Record<string, string>
  occasions: Occasion[]
  /**
   * What a continued semester takes over from the one before, the break's memories already
   * filed on it; absent on a new story.
   */
  carried?: CarriedTerm
}

/**
 * How one press of Start Game ended. `failed` names every call that could not be written,
 * in the modal's words.
 */
export type StartOutcome =
  | { status: 'ready'; data: StartResult }
  | { status: 'failed'; error: AppError; missing: string[] }
  | { status: 'cancelled' }

/** One press of Start Game, held across its retries. */
interface StartAttempt {
  roster: readonly Character[]
  classRequest: ReturnType<typeof buildClassPrompt>
  profileRequest: ReturnType<typeof buildProfilePrompt>
  occasionRequests: OccasionRequest[]
  occasionRequest: ReturnType<typeof buildOccasionPrompt>
  /** What is already settled about whoever is returning, by charKey; empty on a new story. */
  returning: ReturningStudents
  /** What the semester before hands over, before the break is written onto it. */
  carried?: CarriedTerm
  /** Who the break call is asked about, and the call itself; absent when nobody he knows is back. */
  breakInput?: BreakCharInput[]
  breakRequest?: StructuredRequest
  classDraft?: ClassGenReply
  profiles?: ProfileGenDraft
  occasions?: Occasion[]
  breakMemories?: Record<string, BreakMemory[]>
}

/** What each call is called on the modal, in the order failures are reported. */
const CALL_LABELS = {
  classes: 'the class catalog',
  profiles: "the students' profiles",
  occasions: 'the semester’s calendar',
  break: 'what happened over the break'
} as const

let attempt: StartAttempt | null = null

/**
 * The identity of one press of Start Game, minted by {@link startNewGame} and dropped by
 * {@link cancelNewGameStart} — the game loop's `runToken` for this screen.
 */
let run: object | null = null

/** Cancellers for the backoff sleep in flight, so leaving never waits one out. */
let sleepers: (() => void)[] = []

/** A semester on disk with its cast resolved — what the registrar is reopened on. */
export interface StagedEnrollment {
  playthroughId: string
  enrollment: Enrollment
  characters: Character[]
}

let staged: StagedEnrollment | null = null

let continuing: Continuation | null = null

/** Hands New Game the finished semester the screen it is about to raise carries on from. */
export function stageContinuation(next: Continuation): void {
  continuing = next
}

/** What is staged, left where it is: a `useState` initializer runs twice under StrictMode. */
export function stagedContinuation(): Continuation | null {
  return continuing
}

/** Drops what was staged, once the screen holding it has mounted. */
export function clearStagedContinuation(): void {
  continuing = null
}

/** Hands New Game the enrollment the screen it is about to raise stands on. */
export function stageEnrollment(next: StagedEnrollment): void {
  staged = next
}

/** What is staged, left where it is: a `useState` initializer runs twice under StrictMode. */
export function stagedEnrollment(): StagedEnrollment | null {
  return staged
}

/** Drops what was staged, once the screen holding it has mounted. */
export function clearStagedEnrollment(): void {
  staged = null
}

/**
 * Reads a finished semester whole so the next one can be started from it: the save named, or
 * the newest one taken after the semester's last morning. Null, with the reason reported, when
 * the playthrough has no such save, the read was refused, or there is no semester after it.
 */
export async function resolveContinuation(
  playthroughId: string,
  saveId?: string
): Promise<Continuation | null> {
  const saves = useSaveStore.getState()
  const refuse = (detail: string): null => {
    useUiStore
      .getState()
      .showError(
        appError('NEXT_TERM_UNAVAILABLE', 'The next semester could not be started.', detail)
      )
    return null
  }

  // The roster is resolved against the characters on disk now, not when a list was last read.
  await saves.loadPlaythroughs()
  let pick = saveId
  if (!pick) {
    const finished = (await saves.listSavesOf(playthroughId))
      .filter((entry) => entry.summary?.graduationSeen)
      .sort((a, b) => b.savedAt - a.savedAt)[0]
    if (!finished) return refuse('That playthrough has no save from after its last day.')
    pick = finished.saveId
  }

  // A refused read has reported itself.
  const read = await useSaveStore.getState().readSave(playthroughId, pick)
  if (!read) return null
  if (!read.save.graduationSeen) return refuse('That save is from before the semester ended.')
  if (!hasNextTerm(termIndexOf(read.record))) {
    return refuse('That was the last semester there is: the reader has graduated.')
  }
  if (isGameOver(read.save.money)) {
    return refuse('The reader is too far in debt to come back for another semester.')
  }
  return {
    playthroughId,
    save: read.save,
    record: read.record,
    characters: Object.fromEntries(read.characters.map((c) => [c.charId, c]))
  }
}

/** Whether the run a continuation started under is still the live one. */
function stale(mine: object): boolean {
  return run !== mine
}

/** Sends one call until it lands, its budget runs out, or the run is left. */
async function sendUntilAnswered<T>(
  call: string,
  mine: object,
  send: () => Promise<Result<T>>
): Promise<Result<T>> {
  let spent = 0
  for (;;) {
    const result = await send()
    if (stale(mine) || result.ok) return result

    console.warn(`[newGame] ${call} failed:`, result.error)
    const retried = await retrySilently(`newGame:${call}`, result.error, spent, {
      onSleep: (cancel) => sleepers.push(cancel)
    })
    if (!retried || stale(mine)) return result
    spent += 1
  }
}

/** Fetches and validates the save's class catalog. */
async function fetchClassDraft(current: StartAttempt): Promise<Result<ClassGenReply>> {
  const generated = await window.api.llm.generateClasses<ClassGenReply>(
    current.classRequest,
    NEW_GAME_LLM_GROUP
  )
  if (!generated.ok) return { ok: false, error: generated.error }
  try {
    return {
      ok: true,
      data: validateClassDraft(generated.data, current.roster, current.returning)
    }
  } catch (err) {
    return { ok: false, error: toAppError(err) }
  }
}

/** Fetches and validates the roster's years, course loads and jobs. */
async function fetchProfiles(current: StartAttempt): Promise<Result<ProfileGenDraft>> {
  const generated = await window.api.llm.generateProfiles<ProfileGenReply>(
    current.profileRequest,
    NEW_GAME_LLM_GROUP
  )
  if (!generated.ok) return { ok: false, error: generated.error }
  try {
    return {
      ok: true,
      data: validateProfileDraft(generated.data, current.roster, current.returning)
    }
  } catch (err) {
    return { ok: false, error: toAppError(err) }
  }
}

/** Fetches the save's own calendar occasions. */
async function fetchOccasions(current: StartAttempt): Promise<Result<Occasion[]>> {
  const generated = await window.api.llm.generateOccasions<OccasionGenDraft>(
    current.occasionRequest,
    NEW_GAME_LLM_GROUP
  )
  if (!generated.ok) return { ok: false, error: generated.error }

  const occasions = normalizeOccasions(generated.data, current.occasionRequests)
  if (occasions.length === 0) {
    return {
      ok: false,
      error: appError(
        'OCCASION_GEN_INVALID',
        'The semester’s occasions came back empty.',
        `${current.occasionRequests.length} were asked for; none could be written.`
      )
    }
  }
  return { ok: true, data: occasions }
}

/** Fetches what the returning roster remembers of the break; nothing to ask is an empty answer. */
async function fetchBreak(current: StartAttempt): Promise<Result<Record<string, BreakMemory[]>>> {
  if (!current.breakRequest || !current.breakInput) return { ok: true, data: {} }
  const generated = await window.api.llm.generateBreak<BreakGenReply>(
    current.breakRequest,
    NEW_GAME_LLM_GROUP
  )
  if (!generated.ok) return { ok: false, error: generated.error }
  return { ok: true, data: normalizeBreakReply(generated.data, current.breakInput) }
}

/**
 * Runs whatever the attempt is still missing, then composes the semester out of the
 * replies.
 */
async function runAttempt(current: StartAttempt, mine: object): Promise<StartOutcome> {
  const [classResult, profileResult, occasionResult, breakResult] = await Promise.all([
    current.classDraft
      ? Promise.resolve<Result<ClassGenReply>>({ ok: true, data: current.classDraft })
      : sendUntilAnswered('classes', mine, () => fetchClassDraft(current)),
    current.profiles
      ? Promise.resolve<Result<ProfileGenDraft>>({ ok: true, data: current.profiles })
      : sendUntilAnswered('profiles', mine, () => fetchProfiles(current)),
    current.occasions
      ? Promise.resolve<Result<Occasion[]>>({ ok: true, data: current.occasions })
      : sendUntilAnswered('occasions', mine, () => fetchOccasions(current)),
    current.breakMemories
      ? Promise.resolve<Result<Record<string, BreakMemory[]>>>({
          ok: true,
          data: current.breakMemories
        })
      : sendUntilAnswered('break', mine, () => fetchBreak(current))
  ])
  if (stale(mine)) return { status: 'cancelled' }

  // Banked before the verdict below, so a retry re-sends only what is still missing.
  if (classResult.ok) current.classDraft = classResult.data
  if (profileResult.ok) current.profiles = profileResult.data
  if (occasionResult.ok) current.occasions = occasionResult.data
  if (breakResult.ok) current.breakMemories = breakResult.data

  // The first failure is the one the modal shows; the rest are named beside it.
  if (!classResult.ok || !profileResult.ok || !occasionResult.ok || !breakResult.ok) {
    const failures: { label: string; error: AppError }[] = []
    if (!classResult.ok) failures.push({ label: CALL_LABELS.classes, error: classResult.error })
    if (!profileResult.ok) {
      failures.push({ label: CALL_LABELS.profiles, error: profileResult.error })
    }
    if (!occasionResult.ok) {
      failures.push({ label: CALL_LABELS.occasions, error: occasionResult.error })
    }
    if (!breakResult.ok) failures.push({ label: CALL_LABELS.break, error: breakResult.error })
    return {
      status: 'failed',
      error: failures[0].error,
      missing: failures.map((failure) => failure.label)
    }
  }

  const { roster } = current
  const profiles = profileResult.data
  const schedules = buildSchedules(
    decorateClasses(mergeProfiles(classResult.data, profiles)),
    roster
  )
  /** One profile assignment map re-keyed from charKey to charId, absences dropped. */
  const byCharId = <T,>(byKey: Record<string, T>): Record<string, T> =>
    Object.fromEntries(
      roster
        .map((c) => [c.charId, byKey[charKeyOf(c.firstName, c.lastName)]] as const)
        .filter(([, assignment]) => Boolean(assignment))
    ) as Record<string, T>

  attempt = null
  return {
    status: 'ready',
    data: {
      schedules,
      jobs: byCharId(jobAssignmentsOf(profiles)),
      haunts: byCharId(hiddenScheduleAssignmentsOf(profiles)),
      feeds: byCharId(feedAssignmentsOf(profiles)),
      springBreakPlans: byCharId(springBreakAssignmentsOf(profiles)),
      occasions: occasionResult.data,
      ...(current.carried
        ? {
            carried: {
              ...current.carried,
              carry: withBreakMemories(current.carried.carry, breakResult.data)
            }
          }
        : {})
    }
  }
}

/** Who the break call is asked about, and the call itself. */
export interface BreakAsk {
  breakInput: BreakCharInput[]
  breakRequest: StructuredRequest
}

/**
 * The break call for a finished semester and whoever of `kept` is coming back from it, about
 * those of them who have met the reader; `null` when none has, there being no break with him in
 * it to remember. The term being enrolled for is already the active one.
 */
export function breakAskOf(
  from: Continuation,
  kept: readonly Character[],
  carried: CarriedTerm
): BreakAsk | null {
  const { save } = from
  const breakInput: BreakCharInput[] = kept
    .filter((c) => carried.carry.charInfo[c.charId]?.flags.hasMet)
    .map((character) => ({ character, state: carried.carry.charInfo[character.charId] }))
  if (breakInput.length === 0) return null

  return {
    breakInput,
    breakRequest: buildBreakPrompt({
      returning: breakInput,
      reader: breakReaderOf(from, kept, carried),
      stats: save.stats
    })
  }
}

/** The reader's own block as a call about the break carries it: who he was when the semester ended. */
export function breakReaderOf(
  from: Continuation,
  kept: readonly Character[],
  carried: CarriedTerm
): string {
  const { save, record } = from
  const firstNames = Object.fromEntries(kept.map((c) => [c.charId, c.firstName]))
  return readerText(record.playerFirstName, record.playerLastName, save.stats, {
    ...(save.bio ? { bio: save.bio } : {}),
    ...readerStandingOf(
      kept.map((c) => c.charId),
      carried.carry.charInfo,
      firstNames
    )
  })
}

/** Whoever of `roster` is coming back from the finished semester, and what it hands over for them. */
export function keptFrom(
  roster: readonly Character[],
  from: Continuation
): { kept: Character[]; carried: CarriedTerm } {
  const { save, record } = from
  const back = new Set(returningChars(record))
  const kept = roster.filter((c) => back.has(c.charId) && save.charInfo[c.charId])
  return {
    kept,
    carried: carryTerm(
      save,
      record,
      kept.map((c) => c.charId),
      from.characters
    )
  }
}

/**
 * What a continued start settles before any call goes out: who of the new roster is returning
 * and what is already known of each, what the finished semester hands over, and the break —
 * as the break screen closed it, or else the call about whoever of them has met the reader.
 */
function continuedAttempt(
  roster: readonly Character[],
  from: Continuation
): Pick<
  StartAttempt,
  'returning' | 'carried' | 'breakInput' | 'breakRequest' | 'breakMemories'
> {
  const { record, played, save } = from
  const ended = seasonOf(termIndexOf(record))
  const { kept, carried: handed } = keptFrom(roster, from)
  const carried = played
    ? {
        ...handed,
        stats: played.stats,
        carry: withBreakEvents(
          withBreakThreads(handed.carry, played.talks, ended, played.reaches),
          played.visits ?? [],
          ended
        )
      }
    : handed

  const returning: Record<string, ReturningStudents[string]> = {}
  for (const character of kept) {
    const profile = record.profiles[character.charId]
    if (!profile) continue
    const held = save.charInfo[character.charId]?.job
    returning[charKeyOf(character.firstName, character.lastName)] = {
      year: yearAfter(profile.year ?? 1, ended),
      major: profile.major ?? '',
      dorm: profile.dorm ?? FALLBACK_DORM,
      ...(profile.handle ? { handle: profile.handle } : {}),
      // Her job is not carried on the save, its shifts belonging to the old timetable; the
      // employer is handed to New Game here, which places new shifts round her new classes.
      ...(held && held.shifts.length > 0
        ? { job: { jobId: held.jobId, shifts: held.shifts.length } }
        : {})
    }
  }

  if (played) return { returning, carried, breakMemories: played.memories }
  const ask = breakAskOf(from, kept, carried)
  return ask ? { returning, carried, ...ask } : { returning, carried }
}

/**
 * Start Game's generation pass: the one-shots in parallel, then the local passes that turn
 * them into a semester. `from` is the finished semester a continued one carries on from, and
 * the term being enrolled for is already the active one.
 */
export async function startNewGame(
  roster: readonly Character[],
  from?: Continuation
): Promise<StartOutcome> {
  const mine = {}
  run = mine
  sleepers = []
  // Clears the tokens any call since the main menu added, so the enrollment counts only this run's.
  useGameStore.setState({ tallies: emptyTallies() })
  const occasionRequests = planOccasionSlots((count) =>
    useGrabBagStore.getState().drawMany(SEED_WORD_BAG, SEED_WORDS, count)
  )
  const continued = from ? continuedAttempt(roster, from) : { returning: {} }
  const current: StartAttempt = {
    roster,
    classRequest: buildClassPrompt(roster, continued.returning),
    profileRequest: buildProfilePrompt(roster, continued.returning),
    occasionRequests,
    occasionRequest: buildOccasionPrompt(occasionRequests),
    ...continued
  }
  attempt = current

  return runAttempt(current, mine)
}

/**
 * The failure modal's Retry — resumes the stored attempt, re-sending only the calls with no
 * reply yet. With nothing held, it starts over.
 */
export async function retryNewGameStart(
  roster: readonly Character[],
  from?: Continuation
): Promise<StartOutcome> {
  const current = attempt
  if (!current) return startNewGame(roster, from)
  const mine = {}
  run = mine
  sleepers = []
  return runAttempt(current, mine)
}

/**
 * Abandons the start: the player answered the modal with Cancel, or left the screen entirely.
 */
export function cancelNewGameStart(): void {
  run = null
  attempt = null
  const waking = sleepers
  sleepers = []
  for (const wake of waking) wake()
  void window.api.jobs.cancelGroup(NEW_GAME_LLM_GROUP)
}
