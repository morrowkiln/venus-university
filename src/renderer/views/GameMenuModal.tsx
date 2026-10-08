import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { DeadNote } from '../components/DeadNote'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import type { ManualSaveOffer } from '../stores/gameLoop'
import {
  dealt,
  dealtItem,
  dealtItemDead,
  gestures,
  lift,
  panelUnderTab,
  press,
  quietLift,
  quietPress,
  veilIn
} from './motion'
import '../vu_styles/GameMenu.css'

export interface GameMenuModalProps {
  /** Drawn by the screen that opened this — a portal inherits neither palette nor state rules. */
  theme: 'day' | 'night'
  onClose: () => void
  /** Opens the manual save slots in the menu's place. */
  onSaveGame: () => void
  /** Whether a save can be written now, only once the reply in flight lands, or not at all. */
  saveOffer: ManualSaveOffer
  onLoadGame: () => void
  onFeedback: () => void
  onSettings: () => void
  /** Opens the community mods' switches in the menu's place. Absent drops the entry. */
  onStoryMemory?: () => void
  onMods?: () => void
  /** Absent when Plot Twist is off. Uses the native save gate, since edits are persisted. */
  onPlotTwist?: () => void
  /** A reply is on its way: a rule is not changed under a turn already being written. */
  modsWaiting?: boolean
  /**
   * Opens the list of the keys the app answers, in the menu's place. Absent on a screen those
   * keys do not reach, which drops the entry.
   */
  onControls?: () => void
  onLeave: () => void
  /** Absent where the app has no window of its own to close, which drops the entry. */
  onQuit?: () => void
}

/**
 * The Game menu: the ⚙ on the rail and Escape both open it. A fan of outline answers rather
 * than a question with one answer on the right, so they read as a list; the foot only backs out.
 */
export function GameMenuModal({
  theme,
  onClose,
  onSaveGame,
  saveOffer,
  onLoadGame,
  onFeedback,
  onSettings,
  onStoryMemory,
  onMods,
  onPlotTwist,
  modsWaiting = false,
  onControls,
  onLeave,
  onQuit
}: GameMenuModalProps): JSX.Element | null {
  const { host, overlayProps } = useModalShell(onClose)
  if (!host) return null

  const saveDead = saveOffer === 'waiting'

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
      <motion.div
        id="game-menu"
        className="vu-menu-modal vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        variants={panelUnderTab}
      >
        <TitleTab>Menu</TitleTab>

        <motion.nav className="vu-menu-modal-actions vu-fan" variants={dealt(0, 0.045)}>
          {/* Offered only where the game has a point to save; while a reply is still on its
              way it stands dead, the wrapper around it naming what it waits for. */}
          {saveOffer !== 'none' && (
            <DeadNote note={saveDead ? 'Waiting for LLM response' : null} align="center">
              <motion.button
                id="game-menu-save"
                className="vu-btn vu-btn--outline vu-paper"
                type="button"
                variants={saveDead ? dealtItemDead : dealtItem}
                {...gestures(saveDead, lift, press)}
                disabled={saveDead}
                onClick={onSaveGame}
              >
                Save Game
              </motion.button>
            </DeadNote>
          )}
          <motion.button
            id="game-menu-load"
            className="vu-btn vu-btn--outline vu-paper"
            type="button"
            variants={dealtItem}
            {...gestures(false, lift, press)}
            onClick={onLoadGame}
          >
            Load Game
          </motion.button>
          <motion.button
            id="game-menu-settings"
            className="vu-btn vu-btn--outline vu-paper"
            type="button"
            variants={dealtItem}
            {...gestures(false, lift, press)}
            onClick={onSettings}
          >
            Settings
          </motion.button>
          {onStoryMemory && (
            <motion.button type="button" className="vu-btn vu-btn--outline vu-paper" variants={dealtItem}
              {...gestures(false, lift, press)} onClick={onStoryMemory}>Story Memory…</motion.button>
          )}
          {onMods && (
            <DeadNote note={modsWaiting ? 'Waiting for LLM response' : null} align="center">
              <motion.button
                id="game-menu-mods"
                className="vu-btn vu-btn--outline vu-paper"
                type="button"
                variants={modsWaiting ? dealtItemDead : dealtItem}
                {...gestures(modsWaiting, lift, press)}
                disabled={modsWaiting}
                onClick={onMods}
              >
                Mods
              </motion.button>
            </DeadNote>
          )}
          {onPlotTwist && (
            <DeadNote note={saveOffer !== 'open' ? 'Wait for a safe save point' : null} align="center">
              <motion.button
                id="game-menu-plot-twist"
                className="vu-btn vu-btn--outline vu-paper"
                type="button"
                variants={saveOffer !== 'open' ? dealtItemDead : dealtItem}
                {...gestures(saveOffer !== 'open', lift, press)}
                disabled={saveOffer !== 'open'}
                onClick={onPlotTwist}
              >
                Plot Twist
              </motion.button>
            </DeadNote>
          )}
          {onControls && (
            <motion.button
              id="game-menu-controls"
              className="vu-btn vu-btn--outline vu-paper"
              type="button"
              variants={dealtItem}
              {...gestures(false, lift, press)}
              onClick={onControls}
            >
              Controls
            </motion.button>
          )}
          <motion.button
            id="game-menu-feedback"
            className="vu-btn vu-btn--outline vu-paper"
            type="button"
            variants={dealtItem}
            {...gestures(false, lift, press)}
            onClick={onFeedback}
          >
            Report a bug
          </motion.button>
          <motion.button
            id="game-menu-leave"
            className="vu-btn vu-btn--outline vu-paper"
            type="button"
            variants={dealtItem}
            {...gestures(false, lift, press)}
            onClick={onLeave}
          >
            Return to main menu
          </motion.button>
          {onQuit && (
            <motion.button
              id="game-menu-quit"
              className="vu-btn vu-btn--outline vu-paper"
              type="button"
              variants={dealtItem}
              {...gestures(false, lift, press)}
              onClick={onQuit}
            >
              Quit game
            </motion.button>
          )}
        </motion.nav>

        {/* No primary: the entries above are the answers, and this only backs out
            (the modal-close rule — a modal is left by a button, never a ✕). */}
        <div className="vu-foot">
          <motion.button
            id="game-menu-back"
            className="vu-btn vu-btn--quiet"
            type="button"
            {...gestures(false, quietLift, quietPress)}
            onClick={onClose}
          >
            Back to game
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}
