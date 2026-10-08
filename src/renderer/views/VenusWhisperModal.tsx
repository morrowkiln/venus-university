import { retryWhisperDelivery, useWhisperDelivery } from '../stores/whisperDelivery'
import { WhisperIcon } from '../components/BunnyboardFeatureIcons'
import '../vu_styles/BunnyboardFeature.css'
import { useEffect, useRef, useState, type JSX } from 'react'
import { motion } from 'motion/react'
import { VENUS_WHISPER_MOD, WHISPER_COMMENTS, WHISPER_TEXT, whisperWednesday, whisperDiscussionOpen, whisperPeople, whisperPlayerHandle } from '@shared/venusWhisper'
import { useGameStore } from '../stores/gameStore'
import { useModOn } from '../stores/modsStore'
import { profileUrl } from '../stores/characterStore'
import { commentOnWhisper, dismissWhisper, markWhisperRead, replyOnWhisper, useWhisperActivity, whisperReady } from '../stores/venusWhisper'
import { breatheMark, gestures, lift, press, quietLift, quietPress } from './motion'
import '../vu_styles/VenusWhisper.css'

/** A separate reading room for the campus column and its one public discussion per issue. */
export function VenusWhisperPage(): JSX.Element | null {
  const game = useGameStore(s => s), on = useModOn(VENUS_WHISPER_MOD)
  const backgroundBusy = useWhisperActivity(s => s.working)
  const delivery = useWhisperDelivery(s => s)
  const readAlive = useRef(true), readAttempt = useRef('')
  useEffect(() => { readAlive.current = true; return () => { readAlive.current = false } }, [])
  const [selected, setSelected] = useState(''), [draft, setDraft] = useState(''), [replyTo, setReplyTo] = useState<string>()
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [deleting, setDeleting] = useState(false)
  const [hidden, setHidden] = useState<string[]>([]), [typing, setTyping] = useState('')
  const ticket = useRef<{ active: boolean; group: string } | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const cancel = (): void => {
    const t = ticket.current
    if (t) { t.active = false; void window.api.jobs.cancelGroup(t.group); ticket.current = null }
    timers.current.forEach(clearTimeout); timers.current = []
  }
  useEffect(() => {
    cancel(); setBusy(false); setError(''); setHidden([]); setTyping(''); setSelected(''); setDraft(''); setReplyTo(undefined)
    return cancel
  }, [game.playthroughId, game.loads, game.date, game.time, on])
  const state = game.exVenusWhisper
  const rows = state.issues.filter(i => i.term < game.termIndex || (i.term === game.termIndex && i.day <= game.date))
    .sort((a, b) => b.term - a.term || b.day - a.day)
  const issue = rows.find(i => i.id === selected) ?? rows[0]
  const activeIssue = !!issue && whisperDiscussionOpen(issue, game.termIndex, game.date)
  const ready = !busy && !backgroundBusy && whisperReady(), people = whisperPeople(game)
  const target = issue?.comments.find(c => c.id === replyTo)
  const unanswered = issue?.comments.filter(c => c.player && !issue.answered.includes(c.id)).at(-1)
  useEffect(() => {
    if (!on || !ready || issue?.read !== false) return
    const key = `${game.playthroughId}:${game.loads}:${game.date}:${game.time}:${issue.id}`
    if (readAttempt.current === key) return
    readAttempt.current = key
    void markWhisperRead(issue.id, () => readAlive.current).catch(() => {
      if (readAlive.current) setError('Read status could not be saved. Reopen this tab to retry.')
    })
  }, [on, ready, issue?.id, issue?.read, game.playthroughId, game.loads, game.date, game.time])
  if (!on) return null

  /** Saved replies are revealed with short human pauses; closing never loses an already saved batch. */
  function reveal(ids: string[], done: () => void): void {
    if (!ids.length) { setBusy(false); setTyping(''); done(); return }
    setHidden(ids)
    let delay = 500 + Math.random() * 700
    for (let n = 0; n < ids.length; n++) {
      const c = useGameStore.getState().exVenusWhisper.issues.flatMap(i => i.comments).find(c => c.id === ids[n])
      timers.current.push(setTimeout(() => setTyping(`${c?.person.name ?? 'Someone'} is typing…`), delay))
      delay += 800 + Math.random() * 1300
      timers.current.push(setTimeout(() => {
        setHidden(h => h.filter(id => id !== ids[n])); setTyping('')
        if (n === ids.length - 1) { setBusy(false); done() }
      }, delay))
      delay += 300 + Math.random() * 700
    }
  }

  /** One cancellable action owns publication, replies and the local typing presentation. */
  async function run(action: (group: string, alive: () => boolean) => Promise<string[]>, status: string): Promise<void> {
    if (busy) return
    cancel(); setBusy(true); setError(''); setTyping(status); setDeleting(false)
    const t = { active: true, group: `venus-whisper:${crypto.randomUUID()}` }; ticket.current = t
    try {
      const ids = await action(t.group, () => t.active)
      if (t.active) reveal(ids, () => { if (ticket.current === t) ticket.current = null })
    } catch (e) {
      if (t.active) { setError(e instanceof Error ? e.message : 'The newsletter could not be updated.'); setBusy(false); setTyping('') }
    }
  }

  async function send(): Promise<void> {
    if (!issue) return
    await run(async (group, alive) => {
      const id = await commentOnWhisper(issue.id, draft, replyTo, alive)
      if (alive()) { setDraft(''); setReplyTo(undefined) }
      return replyOnWhisper(issue.id, id, group, alive)
    }, 'Someone is reading your comment…')
  }

  return <section className="vu-bb-feature vu-whisper" aria-label="The Venus Whisper">
      <header className="vu-bb-feature-heading">
        <div><span className="vu-whisper-meta">Campus correspondence</span><h1>The Venus Whisper</h1><p>Everybody has a story. Somebody has a column.</p></div>
        <motion.span className="vu-bb-feature-seal" animate={breatheMark} aria-hidden="true"><WhisperIcon /></motion.span>
      </header>
      <div className="vu-bb-feature-columns">
        <aside className="vu-bb-feature-list vu-whisper-rail">
          <strong className="vu-whisper-delivery">The Wednesday edition</strong>
          <p className="vu-whisper-note">Delivered every in-game Wednesday, even when you don’t open Bunnyboard. New issues and replies use your configured AI.</p>
          {delivery.delivering && <p className="vu-whisper-note" role="status">Delivering this week’s issue…</p>}
          {delivery.error && <div><p className="vu-whisper-error" role="alert">{delivery.error}</p>
            <motion.button className="vu-pill" disabled={!ready || whisperWednesday(game.date) === null} {...gestures(!ready, quietLift, quietPress)} onClick={retryWhisperDelivery}>Retry delivery</motion.button></div>}
          <span className="vu-bb-feature-label">The archive</span>
          <nav aria-label="Past issues" className="vu-whisper-archive">
            {rows.map(i => <motion.button key={i.id} className="vu-whisper-edition" aria-pressed={issue?.id === i.id}
              disabled={busy} {...gestures(busy, quietLift, quietPress)} onClick={() => { setSelected(i.id); setReplyTo(undefined); setDraft(''); setError(''); setDeleting(false) }}>
              <span className="vu-whisper-meta">Semester {i.term + 1} · Day {i.day + 1}</span><strong>{i.title}</strong>{i.read === false && <span className="vu-whisper-unread">Unread</span>}<span>{i.comments.length} comments</span>
            </motion.button>)}
            {!rows.length && <p className="vu-empty vu-empty--flush">The first edition is waiting to be written.</p>}
          </nav>
        {issue && <div><motion.button className="vu-btn vu-btn--quiet" disabled={!ready} {...gestures(!ready, quietLift, quietPress)} onClick={() => {
          if (!deleting) { setDeleting(true); return }
          void run(async (_g, alive) => { await dismissWhisper(issue.id, alive); setSelected(''); return [] }, 'Filing the archive…')
        }}>{deleting ? 'Confirm delete issue' : 'Delete issue'}</motion.button>
        {deleting && <motion.button className="vu-pill" {...gestures(false, quietLift, quietPress)} onClick={() => setDeleting(false)}>Keep issue</motion.button>}</div>}
        </aside>
        <div className="vu-whisper-reading">
          <div className="vu-whisper-scroll">
            {issue ? <>
              <article className="vu-whisper-article">
                <span className="vu-whisper-meta">Semester {issue.term + 1} · Day {issue.day + 1} · Anonymous editorial</span>
                <h2>{issue.title}</h2><div className="vu-whisper-copy">{issue.body}</div>
                <p className="vu-whisper-signature">Yours, somewhere on campus.</p>
              </article>
              <section className="vu-whisper-discussion" aria-label="Comments">
                <h3>The campus replies <span>{issue.comments.length}</span></h3>
                {issue.comments.filter(c => !hidden.includes(c.id)).map(c => {
                  const parent = issue.comments.find(p => p.id === c.replyTo)
                  return <div key={c.id} className="vu-whisper-comment">
                    <span className="vu-whisper-avatar" aria-hidden="true"><span>{c.person.name.charAt(0)}</span>{!c.player && <img src={profileUrl(c.person.id)} alt=""/>}</span>
                    <div><div className="vu-whisper-byline"><strong>{c.person.name}</strong><span>@{c.player && c.person.handle === 'reader' ? whisperPlayerHandle(game.playerFirstName, game.playerLastName) : c.person.handle}</span></div>
                      {parent && <small className="vu-whisper-reply-label">Reply to {parent.person.name}: {parent.text.slice(0, 90)}{parent.text.length > 90 ? '…' : ''}</small>}
                      <p>{c.text}</p>
                      {activeIssue && <motion.button className="vu-pill" disabled={!ready} {...gestures(!ready, quietLift, quietPress)} onClick={() => setReplyTo(c.id)}>Reply</motion.button>}
                    </div>
                  </div>
                })}
                {!issue.comments.length && <p className="vu-empty vu-empty--flush">A fresh page. Nobody has weighed in yet.</p>}
                {activeIssue && (unanswered || !issue.comments.some(c => !c.player)) && <motion.button className="vu-btn vu-btn--quiet" disabled={!ready}
                  {...gestures(!ready, quietLift, quietPress)} onClick={() => void run((g, a) => replyOnWhisper(issue.id, unanswered?.id, g, a), 'Someone is typing…')}>Get replies</motion.button>}
              </section>
            </> : <div className="vu-whisper-welcome"><h2>Something to talk about.</h2><p>The next edition arrives on Wednesday.</p><p>Public posts, chance encounters, and just enough speculation to start a conversation.</p><p>The columnist signs no name. Everyone else speaks for themselves.</p></div>}
          </div>
          <div className="vu-whisper-status" role="status" aria-live="polite">{typing || (activeIssue ? 'Public conversation · keep it campus appropriate' : issue ? 'Archived issue · comments are closed' : 'Read an issue to join the conversation')}</div>
          {error && <p className="vu-whisper-error" role="alert">{error}</p>}
          {activeIssue && <div className="vu-whisper-composer">
            <div className="vu-whisper-compose-top"><span>{target ? `Replying to ${target.person.name}` : 'Comment on this issue'}</span>
              {target && <motion.button className="vu-pill" {...gestures(false, quietLift, quietPress)} onClick={() => setReplyTo(undefined)}>Cancel reply</motion.button>}
              <label className="vu-whisper-tag">Mention <select aria-label="Tag a character" value="" disabled={!ready} onChange={e => {
                const p = people.find(p => p.id === e.target.value)
                if (p) setDraft(d => `${d}${d && !d.endsWith(' ') ? ' ' : ''}@${p.handle} `.slice(0, WHISPER_TEXT))
              }}><option value="">Choose a name</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            </div>
            <textarea aria-label="Public comment" maxLength={WHISPER_TEXT} value={draft} disabled={!ready || issue.comments.length >= WHISPER_COMMENTS - 3} onChange={e => setDraft(e.target.value)}/>
            <div className="vu-whisper-compose-foot"><span>{draft.length} / {WHISPER_TEXT}</span>
              <motion.button className="vu-btn vu-btn--primary vu-paper vu-btn--panel" disabled={!ready || !draft.trim() || issue.comments.length >= WHISPER_COMMENTS - 3}
                {...gestures(!ready || !draft.trim() || issue.comments.length >= WHISPER_COMMENTS - 3, lift, press)} onClick={() => void send()}>Post comment</motion.button></div>
          </div>}
        </div>
      </div>
    </section>
}
