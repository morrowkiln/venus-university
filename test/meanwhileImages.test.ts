import { describe, expect, it, vi } from 'vitest'
import { meanwhileBackgroundKey, meanwhileBackgroundUrl } from '../src/renderer/views/meanwhileImages'
import { bgUrl } from '../src/renderer/views/bgAssets'

vi.mock('../src/renderer/views/bgAssets', () => ({ bgUrl: vi.fn((key: string) =>
  ['asian_food', 'bowling_alley', 'roller_rink', 'cat_cafe', 'gymnasium'].includes(key) ? `/art/${key}.png` : null) }))

describe('Meanwhile location artwork', () => {
  it('resolves timetable IDs and outing locations instead of treating them as filenames', () => {
    expect(meanwhileBackgroundUrl({ kind: 'hangout', ref: 'eastern_buffet' })).toBe('/art/asian_food.png')
    expect(bgUrl).toHaveBeenCalledWith('asian_food', 'day', false)
    expect(meanwhileBackgroundKey({ kind: 'hangout', ref: 'spring_mart' })).toBe('supermarket')
    expect(meanwhileBackgroundKey({ kind: 'hangout', ref: 'cutetea' })).toBe('cute_tea')
    expect(meanwhileBackgroundKey({ kind: 'hangout', ref: 'future_cinema' })).toBe('theater')
    expect(meanwhileBackgroundKey({ kind: 'dorm', ref: 'some-dorm' })).toBe('dorm_lounge')
    expect(meanwhileBackgroundKey({ kind: 'class', ref: 'some-class' })).toBe('classroom')
  })
  it('uses installed City Life artwork and leaves missing artwork to the themed fallback', () => {
    for (const ref of ['bowling_alley', 'roller_rink', 'cat_cafe']) {
      expect(meanwhileBackgroundUrl({ kind: 'hangout', ref })).toBe(`/art/${ref}.png`)
    }
    expect(meanwhileBackgroundUrl({ kind: 'hangout', ref: 'missing-location' })).toBeNull()
  })
  it('uses a saved class activity and its matching PE category instead of a universal classroom', () => {
    const climbing = { kind: 'class' as const, ref: 'PE 102', where: 'Indoor Rock Climbing and Belaying' }
    expect(meanwhileBackgroundUrl(climbing, { name: climbing.where, category: 'pe' })).toBe('/art/gymnasium.png')
    expect(meanwhileBackgroundKey({ ...climbing, where: 'Functional Movement' }, { name: 'Functional Movement', category: 'pe' })).toBe('gymnasium')
    expect(meanwhileBackgroundKey({ ...climbing, where: 'Swimming Technique' }, { name: 'Swimming Technique', category: 'pe' })).toBe('pool')
    expect(meanwhileBackgroundKey({ ...climbing, where: 'History of Swimming' }, { name: 'History of Swimming', category: 'humanities' })).toBe('classroom')
    // Old replays keep their captured activity when a new semester reuses their course code.
    expect(meanwhileBackgroundKey(climbing, { name: 'Mass Communication', category: 'humanities' })).toBe('gymnasium')
    expect(meanwhileBackgroundKey(climbing)).toBe('gymnasium')
  })
  it('falls back to native PE artwork when optional venue art is not installed', () => {
    const bowling = { kind: 'class' as const, ref: 'PE 201', where: 'Bowling Fundamentals' }
    expect(meanwhileBackgroundUrl(bowling)).toBe('/art/bowling_alley.png')
    vi.mocked(bgUrl).mockReturnValueOnce(null)
    expect(meanwhileBackgroundUrl(bowling)).toBe('/art/gymnasium.png')
  })
})
