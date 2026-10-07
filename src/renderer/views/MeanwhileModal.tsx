import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { MEANWHILE_MOD, meanwhileEvents, type MeanwhileScene } from '@shared/meanwhile'
import { fullNameOf } from '@shared/types'
import { TitleTab } from '../components/TitleTab'
import { useModalShell } from '../components/useModalShell'
import { useGameStore } from '../stores/gameStore'
import { useModOn } from '../stores/modsStore'
import { generateMeanwhile, meanwhileReady } from '../stores/meanwhile'
import { profileUrl } from '../stores/characterStore'
import { formatShortGameDate } from '../prompts/gameDate'
import { bgUrl } from './bgAssets'
import { gestures, lift, press, quietLift, quietPress, panelUnderTab, veilIn } from './motion'
import '../vu_styles/Meanwhile.css'
import { termOriginLabel } from '@shared/termOrigin'

export function MeanwhileModal({ theme, onClose }: { theme: 'day'|'night'; onClose: () => void }): JSX.Element | null {
  const game = useGameStore(s => s), on = useModOn(MEANWHILE_MOD)
  const [selected,setSelected] = useState<MeanwhileScene|null>(null), [index,setIndex] = useState(0)
  const [busy,setBusy] = useState(false), [error,setError] = useState('')
  const ticket = useRef<{active:boolean;group:string}|null>(null)
  const cancel = (): void => {
    const held=ticket.current
    if (held) { held.active=false; void window.api.jobs.cancelGroup(held.group); ticket.current=null }
  }
  useEffect(() => { cancel(); setSelected(null); setBusy(false); setError(''); return cancel }, [game.loads,game.playthroughId,game.date,game.time,on])
  const close = (): void => { cancel(); onClose() }
  const { host, overlayProps } = useModalShell(close)
  if (!host || !on) return null
  const rows=meanwhileEvents(game), line=selected?.lines[index]
  const speaker=line?game.characters[line.speaker]:undefined
  const dateLabel = (event: MeanwhileScene): string => event.origin ? termOriginLabel(event.origin) : formatShortGameDate(event.date)
  async function watch(event: MeanwhileScene): Promise<void> {
    cancel(); setSelected(event); setIndex(0); setError(''); setBusy(false)
    if(event.lines.length) return
    const own={active:true,group:'meanwhile:'+crypto.randomUUID()};ticket.current=own;setBusy(true)
    try { const scene=await generateMeanwhile(event.id,own.group,()=>own.active)
      if(own.active)setSelected(scene)
    } catch(e) { if(own.active)setError(e instanceof Error?e.message:'Could not write this conversation.') }
    finally { if(own.active)setBusy(false) }
  }
  const key=selected?.kind==='class'?'classroom':selected?.kind==='dorm'?'lowrise_dorm_room':
    ({btb_arcade:'arcade',green_hill_park:'park',cutetea:'bubble_tea',kendall_library:'library'}[selected?.ref??'']??selected?.ref)
  // Native encounters carry a day, not a time slot. A neutral day illustration avoids inventing one.
  const backdrop=key?bgUrl(key,'day',false):null
  return createPortal(<motion.div className="vu-veil" data-theme={theme} variants={veilIn} initial="hidden" animate="shown" exit="gone" {...overlayProps}>
    <motion.section className="vu-meanwhile vu-paper" role="dialog" aria-modal="true" aria-label="Meanwhile conversations" variants={panelUnderTab}>
      <TitleTab>Meanwhile…</TitleTab>
      <p className="vu-meanwhile-note">A glimpse of campus life. Recent encounters and up to 50 saved replays, including past semesters. Your character does not witness these dramatizations.</p>
      <div className="vu-meanwhile-body">
        <nav className="vu-meanwhile-events" aria-label="NPC encounters">
          {rows.length?rows.map(event=><motion.button key={event.id} type="button" className="vu-meanwhile-event" aria-pressed={selected?.id===event.id}
            disabled={!event.lines.length&&!meanwhileReady()} {...gestures(!event.lines.length&&!meanwhileReady(),quietLift,quietPress)} onClick={()=>void watch(event)}>
            <strong>{event.title}</strong><span>{dateLabel(event)} · {event.where}</span><small>{event.lines.length?'Watch again':'Watch conversation'}</small>
          </motion.button>):<p>No recent encounters between known characters yet. Check back as the semester progresses.</p>}
        </nav>
        <section className="vu-meanwhile-view" aria-label="Conversation viewer">
          {backdrop&&<img className="vu-meanwhile-backdrop" src={backdrop} alt=""/>}
          <div className="vu-meanwhile-story">
            <h3>{selected?.title??'Off the beaten path'}</h3>
            <p>{selected?`${selected.where} · ${dateLabel(selected)}`:'Choose an encounter to watch. Writing a new conversation uses your configured AI; replays use the saved copy.'}</p>
            {busy&&<p role="status">Writing their conversation…</p>}
            {error&&<div role="alert"><p>{error}</p><motion.button className="vu-btn vu-btn--quiet" {...gestures(false,quietLift,quietPress)} onClick={()=>selected&&void watch(selected)}>Retry</motion.button></div>}
            {line&&<div className="vu-meanwhile-line"><img src={profileUrl(line.speaker)} alt="" onError={e=>{e.currentTarget.style.visibility='hidden'}}/>
              <div><strong>{selected?.participantNames?.[line.speaker] ?? (speaker?fullNameOf(speaker):'Character')}</strong><p>{line.text}</p></div></div>}
          </div>
          <div className="vu-meanwhile-controls">
            <motion.button className="vu-btn vu-btn--quiet" disabled={!line||index===0} {...gestures(!line||index===0,quietLift,quietPress)} onClick={()=>setIndex(i=>i-1)}>Previous</motion.button>
            <span>{line?`${index+1} / ${selected!.lines.length}`:'Read-only'}</span>
            <motion.button className="vu-btn vu-btn--outline vu-paper" disabled={!line||index>=selected!.lines.length-1} {...gestures(!line||index>=selected!.lines.length-1,lift,press)} onClick={()=>setIndex(i=>i+1)}>Next</motion.button>
          </div>
        </section>
      </div>
      <div className="vu-foot"><p className="vu-meanwhile-note">No player actions · no time or relationship changes</p>
        <motion.button className="vu-btn vu-btn--quiet" {...gestures(false,quietLift,quietPress)} onClick={close}>Back to menu</motion.button></div>
    </motion.section>
  </motion.div>,host)
}
