import { useEffect, useMemo, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import {
  normalizeStoryMemory,
  STORY_CATEGORIES,
  STORY_FACT_LIMIT,
  storySlot,
  storySnapshot,
  type StoryFact,
  type StoryMemory,
  type StoryRecord
} from '@shared/storyMemory'
import { TitleTab } from '../components/TitleTab'
import { useModalShell } from '../components/useModalShell'
import { useGameStore } from '../stores/gameStore'
import { useModOn } from '../stores/modsStore'
import { manualSaveOffer, writeStoryMemory } from '../stores/loop/saves'
import { inspectCurrentStoryMemory } from '../stores/storyMemory'
import { gestures, lift, press, quietLift, quietPress, panelUnderTab, veilIn } from './motion'
import '../vu_styles/StoryMemory.css'
import { termOriginLabel } from '@shared/termOrigin'

export function StoryMemoryModal({
  theme,
  onClose
}: {
  theme: 'day' | 'night'
  onClose: () => void
}): JSX.Element | null {
  const game = useGameStore((s) => s),
    on = useModOn('story-memory')
  const [filter, setFilter] = useState(''),
    [search, setSearch] = useState(''),
    [hidden, setHidden] = useState(false)
  const [selected, setSelected] = useState<StoryRecord | null>(null),
    [draft, setDraft] = useState<StoryRecord | null>(null)
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(''),
    [engine, setEngine] = useState('Checking local recall…')
  const close = (): void => {
    if (busy) return
    if (draft) setDraft(null)
    else onClose()
  }
  const { host, overlayProps } = useModalShell(close)
  const blocked = busy || !on || game.sceneEnding || manualSaveOffer() !== 'open'
  const snapshot = useMemo(() => {
    const store = normalizeStoryMemory(game.exStoryMemory)
    if (hidden) {
      store.hidden = []
      store.encounterEdits = Object.fromEntries(
        Object.entries(store.encounterEdits).map(([id, e]) => [id, { ...e, hidden: false }])
      )
    }
    return storySnapshot({ ...game, exStoryMemory: store })
  }, [
    game.playthroughId,
    game.date,
    game.time,
    game.characters,
    game.history,
    game.exStoryMemory,
    hidden
  ])
  const choices = Object.entries(snapshot?.names ?? { reader: 'The reader' })
  const name = (id: string): string => snapshot?.names[id] ?? id
  const isHidden = (r: StoryRecord): boolean =>
    game.exStoryMemory.hidden.includes(r.id) ||
    game.exStoryMemory.encounterEdits[r.id]?.hidden === true
  const records = (snapshot?.records ?? [])
    .filter(
      (r) =>
        (!filter || r.subjects.includes(filter) || r.knownBy.includes(filter)) &&
        (!search || r.text.toLowerCase().includes(search.toLowerCase()))
    )
    .sort((a, b) => storySlot(b.date, b.time) - storySlot(a.date, a.time))
  useEffect(() => {
    setDraft(null)
    setSelected(null)
    setStatus('')
  }, [game.playthroughId, game.loads])
  useEffect(() => {
    let active = true
    if (!on) {
      setEngine('Story Memory is off. Saved facts are retained.')
      return
    }
    void inspectCurrentStoryMemory([], '')
      .then((r) => {
        if (active && r)
          setEngine(`${r.engine} · ${r.indexed} records${r.warning ? ' · ' + r.warning : ''}`)
      })
      .catch(() => {
        if (active)
          setEngine('Index unavailable. Save-based recall is available during generation.')
      })
    return () => {
      active = false
    }
  }, [game.playthroughId, game.loads, game.history, game.exStoryMemory, on])
  async function change(transform: (s: StoryMemory) => StoryMemory): Promise<void> {
    if (blocked || !game.playthroughId) return
    const id = game.playthroughId,
      loads = game.loads
    setBusy(true)
    setStatus('')
    try {
      await writeStoryMemory(transform(normalizeStoryMemory(game.exStoryMemory)), {
        playthroughId: id,
        loads,
        previous: game.exStoryMemory
      })
      if (useGameStore.getState().playthroughId === id && useGameStore.getState().loads === loads) {
        setDraft(null)
        setSelected(null)
        setStatus('Saved. Applies to the next generated response.')
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Memory could not be saved.')
    } finally {
      setBusy(false)
    }
  }
  function fresh(): void {
    setSelected(null)
    setDraft({
      id: '',
      kind: 'fact',
      subjects: [filter || 'reader'],
      subject: filter || 'reader',
      category: 'other',
      text: '',
      timeline: 'current',
      certainty: 'event',
      claimant: null,
      knownBy: ['reader'],
      public: false,
      date: game.date,
      time: game.time,
      evidence: '',
      source: 'Player-added fact',
      supersedes: [],
      manual: true
    })
  }
  function save(): void {
    if (!draft?.text.trim()) return
    void change((s) => {
      if (draft.kind === 'encounter')
        return {
          ...s,
          encounterEdits: { ...s.encounterEdits, [draft.id]: { text: draft.text.trim() } }
        }
      const fact: StoryFact = {
        ...draft,
        id: draft.id || `manual:${crypto.randomUUID()}`,
        category: draft.category ?? 'other',
        text: draft.text.trim(),
        manual: true
      }
      if (draft.id) return { ...s, edits: { ...s.edits, [draft.id]: fact } }
      if (s.facts.length >= STORY_FACT_LIMIT)
        throw Error('The durable-fact limit is reached. Edit an existing fact instead.')
      return { ...s, facts: [...s.facts, fact] }
    })
  }
  function hide(r: StoryRecord): void {
    void change((s) =>
      r.kind === 'encounter'
        ? {
            ...s,
            encounterEdits: {
              ...s.encounterEdits,
              [r.id]: { ...s.encounterEdits[r.id], hidden: !isHidden(r) }
            }
          }
        : {
            ...s,
            hidden: isHidden(r)
              ? s.hidden.filter((id) => id !== r.id)
              : [...new Set([...s.hidden, r.id])]
          }
    )
  }
  const select = (
    label: string,
    value: string,
    set: (v: string) => void,
    items: string[][]
  ): JSX.Element => (
    <label className="vu-field">
      <span className="vu-field-label">{label}</span>
      <select
        className="vu-input vu-select"
        aria-label={label}
        value={value}
        disabled={blocked}
        onChange={(e) => set(e.target.value)}
      >
        {items.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </label>
  )
  const shown = draft ?? selected
  if (!host) return null
  return createPortal(
    <motion.div
      className="vu-veil"
      data-theme={theme}
      variants={veilIn}
      initial="hidden"
      animate="shown"
      exit="gone"
      {...overlayProps}
    >
      <motion.section
        className="vu-story-memory vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Story Memory"
        variants={panelUnderTab}
      >
        <TitleTab>Story Memory</TitleTab>
        <p className="vu-story-memory-intro">
          Keep the important parts of the story close. Facts and corrected recaps help future
          narration; they do not change stats or rewrite old scenes.
        </p>
        <p className="vu-story-memory-reading" role="status">
          {engine}
        </p>
        <div className="vu-story-memory-grid">
          <aside className="vu-story-memory-browser">
            <label className="vu-field">
              <span className="vu-field-label">Character</span>
              <select
                className="vu-input vu-select"
                aria-label="Character"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="">All characters</option>
                {choices.map(([id, n]) => (
                  <option key={id} value={id}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="vu-field">
              <span className="vu-field-label">Search memories</span>
              <input
                className="vu-input"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="vu-check">
              <input
                className="vu-check-input"
                type="checkbox"
                checked={hidden}
                onChange={(e) => setHidden(e.target.checked)}
              />
              <span className="vu-check-box" />
              Show hidden recall
            </label>
            <div className="vu-story-memory-list" aria-label="Saved memories">
              {records.slice(0, 150).map((r) => (
                <motion.button
                  key={r.id}
                  type="button"
                  className="vu-story-memory-row"
                  aria-pressed={shown?.id === r.id}
                  {...gestures(busy, quietLift, quietPress)}
                  disabled={busy}
                  onClick={() => {
                    setSelected(r)
                    setDraft(null)
                    setStatus('')
                  }}
                >
                  <span className="vu-story-memory-reading">
                    {r.kind} · {r.origin ? termOriginLabel(r.origin) : `Day ${r.date}`} · {r.time ? 'night' : 'day'}
                    {isHidden(r) ? ' · hidden' : ''}
                  </span>
                  <span>{r.text}</span>
                </motion.button>
              ))}
              {!records.length && <p>No matching memories yet. Complete a scene or add a fact.</p>}
            </div>
            <p className="vu-story-memory-reading">{records.length} matching · showing up to 150</p>
          </aside>
          <div className="vu-story-memory-detail">
            {!shown && (
              <div className="vu-story-memory-empty">
                <h2>A little more continuity</h2>
                <p>
                  Choose an encounter or fact to read its source, correct it, or hide it from
                  enhanced recall.
                </p>
                <p>
                  The database stays on this machine. Only selected fictional context is sent
                  through your configured AI provider. Native character notes remain available on
                  character profiles.
                </p>
                <p>
                  Each request adds at most 18,000 characters of recall, with up to 6,500 for
                  lasting facts. This is a character limit, not an exact token count.
                </p>
              </div>
            )}
            {shown && (
              <>
                <h2>
                  {shown.kind === 'encounter'
                    ? 'Encounter recall'
                    : draft
                      ? 'Edit story fact'
                      : 'Story fact'}
                </h2>
                {draft ? (
                  <label className="vu-field">
                    <span className="vu-field-label">Memory</span>
                    <textarea
                      className="vu-input vu-input--multiline"
                      aria-label="Memory"
                      rows={4}
                      maxLength={draft.kind === 'encounter' ? 12000 : 800}
                      value={draft.text}
                      disabled={blocked}
                      onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                    />
                  </label>
                ) : (
                  <p className="vu-story-memory-text">{shown.text}</p>
                )}
                {draft?.kind === 'fact' && (
                  <>
                    <div className="vu-story-memory-fields">
                      {select(
                        'About',
                        draft.subject,
                        (v) => setDraft({ ...draft, subject: v, subjects: [v] }),
                        choices
                      )}
                      {select(
                        'Applies in',
                        draft.timeline,
                        (v) => setDraft({ ...draft, timeline: v as StoryFact['timeline'] }),
                        [
                          ['current', 'Current timeline'],
                          ['alternate', 'Alternate timeline'],
                          ['unspecified', 'Unspecified']
                        ]
                      )}
                      {select(
                        'Category',
                        draft.category ?? 'other',
                        (v) => setDraft({ ...draft, category: v as StoryFact['category'] }),
                        STORY_CATEGORIES.map((c) => [c, c.replaceAll('_', ' ')])
                      )}
                      {select(
                        'Evidence type',
                        draft.certainty,
                        (v) =>
                          setDraft({
                            ...draft,
                            certainty: v as StoryFact['certainty'],
                            claimant: v === 'claim' ? (draft.claimant ?? draft.subject) : null
                          }),
                        [
                          ['event', 'Established event'],
                          ['claim', 'Character claim']
                        ]
                      )}
                      {draft.certainty === 'claim' &&
                        select(
                          'Claim made by',
                          draft.claimant ?? 'reader',
                          (v) => setDraft({ ...draft, claimant: v }),
                          choices
                        )}
                    </div>
                    <label className="vu-check">
                      <input
                        className="vu-check-input"
                        type="checkbox"
                        checked={draft.public}
                        disabled={blocked}
                        onChange={(e) => setDraft({ ...draft, public: e.target.checked })}
                      />
                      <span className="vu-check-box" />
                      Public knowledge
                    </label>
                    <p>Who knows this? Leave every box clear for narrator-only knowledge.</p>
                    <div className="vu-story-memory-knowers">
                      {choices.map(([id, n]) => (
                        <label className="vu-check" key={id}>
                          <input
                            className="vu-check-input"
                            type="checkbox"
                            checked={draft.knownBy.includes(id)}
                            disabled={blocked}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                knownBy: e.target.checked
                                  ? [...draft.knownBy, id]
                                  : draft.knownBy.filter((x) => x !== id)
                              })
                            }
                          />
                          <span className="vu-check-box" />
                          {n}
                        </label>
                      ))}
                    </div>
                  </>
                )}
                {!draft && shown.kind === 'fact' && (
                  <p>
                    {name(shown.subject)} · {shown.timeline} ·{' '}
                    {shown.certainty === 'claim'
                      ? `Claim by ${name(shown.claimant ?? 'reader')}`
                      : 'Established event'}
                    <br />
                    {shown.public
                      ? 'Public knowledge'
                      : `Known by: ${shown.knownBy.map(name).join(', ') || 'Narrator only'}`}
                    {shown.manual ? ' · Player correction' : ''}
                  </p>
                )}
                {!draft && (
                  <>
                    <details>
                      <summary>Source</summary>
                      <p className="vu-story-memory-text">{shown.evidence || shown.source}</p>
                    </details>
                    <div className="vu-story-memory-actions">
                      <motion.button
                        type="button"
                        className="vu-btn vu-btn--quiet"
                        {...gestures(blocked, quietLift, quietPress)}
                        disabled={blocked}
                        onClick={() => setDraft({ ...shown, knownBy: [...shown.knownBy] })}
                      >
                        Edit
                      </motion.button>
                      <motion.button
                        type="button"
                        className="vu-btn vu-btn--quiet"
                        {...gestures(blocked, quietLift, quietPress)}
                        disabled={blocked}
                        onClick={() => hide(shown)}
                      >
                        {isHidden(shown) ? 'Restore recall' : 'Hide from recall'}
                      </motion.button>
                    </div>
                    <p>
                      Hiding affects enhanced recall only. The original history remains in the save.
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <div className="vu-foot-stack">
          <p className="vu-form-status" role="status">
            {status || (blocked ? 'Memory edits wait until narration and messages finish.' : '')}
          </p>
          <footer className="vu-foot">
            <motion.button
              type="button"
              className="vu-btn vu-btn--quiet"
              {...gestures(busy, quietLift, quietPress)}
              disabled={busy}
              onClick={close}
            >
              {draft ? 'Cancel edit' : 'Back'}
            </motion.button>
            {draft ? (
              <motion.button
                type="button"
                className="vu-btn vu-btn--primary vu-paper"
                {...gestures(blocked || !draft.text.trim(), lift, press)}
                disabled={blocked || !draft.text.trim()}
                onClick={save}
              >
                Save memory
              </motion.button>
            ) : (
              <motion.button
                type="button"
                className="vu-btn vu-btn--primary vu-paper"
                {...gestures(blocked, lift, press)}
                disabled={blocked}
                onClick={fresh}
              >
                Add fact
              </motion.button>
            )}
          </footer>
        </div>
      </motion.section>
    </motion.div>,
    host
  )
}
