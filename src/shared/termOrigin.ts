/** Original semester/day for a saved event whose working date is now before day zero. */
export interface TermOrigin {
  term: number
  day: number
}

export function normalizeTermOrigin(value: unknown): TermOrigin | undefined {
  const v = value as TermOrigin | null
  return v &&
    Number.isSafeInteger(v.term) &&
    v.term >= 0 &&
    v.term <= 1000 &&
    Number.isSafeInteger(v.day) &&
    v.day >= 0 &&
    v.day <= 100000
    ? { term: v.term, day: v.day }
    : undefined
}

export function termOriginLabel(origin: TermOrigin): string {
  return `Semester ${origin.term + 1} · Day ${origin.day}`
}
