import { create } from 'zustand'
import { VENUS_WHISPER_MOD, whisperWednesday, whisperWeekOccupied } from '@shared/venusWhisper'
import { useGameStore } from './gameStore'
import { modIsOn } from './modsStore'
import { publishWhisper, replyOnWhisper, waitForWhisperCheckpoint, whisperReady } from './venusWhisper'

/** Delivery belongs to the running game, never to whether its newspaper page is open. */
export const useWhisperDelivery = create<{ error: string; retry: number; delivering: boolean }>(() => ({ error: '', retry: 0, delivering: false }))
export function retryWhisperDelivery(): void { useWhisperDelivery.setState(s => ({ retry: s.retry + 1 })) }

/** One attempt per safe clock slot. Provider failures never create an unbounded retry loop. */
export function startWhisperDelivery(): () => void {
  let stopped = false, attempted = '', identity = ''
  let job: { group: string; active: boolean; current: () => boolean } | undefined
  let retrySeen = useWhisperDelivery.getState().retry
  const cancel = (): void => {
    if (job?.active) { job.active = false; void window.api.jobs.cancelGroup(job.group) }
  }
  const tick = (): void => {
    const game = useGameStore.getState()
    const context = `${game.playthroughId}:${game.loads}:${game.termIndex}`
    if (context !== identity) { identity = context; attempted = ''; useWhisperDelivery.setState({ error: '' }) }
    if (job) { if (!job.current()) cancel(); return }
    if (stopped || !game.playthroughId || !game.chars.length || !whisperReady()) return
    const day = whisperWednesday(game.date)
    if (day === null) return
    const retry = useWhisperDelivery.getState().retry
    const requested = retry !== retrySeen
    retrySeen = retry
    if (!requested && whisperWeekOccupied(game.exVenusWhisper, game.termIndex, game.date)) return
    const key = `${context}:${day}:${game.date}:${game.time}:${retry}`
    if (attempted === key) return
    attempted = key
    const own = { group: `whisper-delivery:${crypto.randomUUID()}`, active: true, current: (): boolean => {
      const now = useGameStore.getState()
      return !stopped && own.active && modIsOn(VENUS_WHISPER_MOD) && now.playthroughId === game.playthroughId &&
        now.loads === game.loads && now.termIndex === game.termIndex && now.date >= game.date
    } }
    job = own
    useWhisperDelivery.setState({ error: '', delivering: true })
    void (async () => {
      try {
        const id = await publishWhisper(own.group, own.current, true)
        if (!own.current() || !useGameStore.getState().exVenusWhisper.issues.some(i => i.id === id)) return
        await waitForWhisperCheckpoint(own.current)
        await replyOnWhisper(id, undefined, own.group, own.current, true)
      } catch (error) {
        if (own.current()) useWhisperDelivery.setState({ error: error instanceof Error ? error.message : 'The weekly issue could not be delivered.' })
      } finally {
        if (job === own) { job = undefined; useWhisperDelivery.setState({ delivering: false }) }
      }
    })()
  }
  // The save lane also has non-reactive locks; polling observes their release without waking a scene.
  const timer = setInterval(tick, 1000)
  tick()
  return () => { stopped = true; clearInterval(timer); cancel() }
}
