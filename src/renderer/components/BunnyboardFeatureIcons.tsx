import type { JSX } from 'react'

const MARK = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

/** A conversation being watched, shared by the rail and the page seal. */
export function MeanwhileIcon(): JSX.Element {
  return <svg {...MARK}>
    <path d="M13 14H7l-4 3V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M9 17v1a2 2 0 0 0 2 2h6l4 2V11a2 2 0 0 0-2-2h-2"/>
    <path d="m10 6 3 2-3 2Z"/>
  </svg>
}

/** The anonymous columnist's page and pen. */
export function WhisperIcon(): JSX.Element {
  return <svg {...MARK}>
    <path d="M15 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-5M6 7h5M6 11h3M6 17h7"/>
    <path d="m12 13 1-4 6-6 3 3-6 6-4 1Zm5-8 3 3"/>
  </svg>
}
