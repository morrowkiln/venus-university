import { describe, expect, it, vi } from 'vitest'

/**
 * The slot opening's schema follows which mods are on at the time it is asked for, not at the
 * time the file loaded: a mod switched on mid-session gets its post fields in the next call.
 */

describe('the slot opening schema', () => {
  it('takes in the post fields of a mod switched on after the prompt file loaded', async () => {
    vi.resetModules()
    const hooks = await import('../src/renderer/mods/hooks')
    const on = { late: false }
    hooks.setHookRules({ isOn: (id) => on[id as 'late'] ?? true, order: () => 0 })
    hooks.registerHooks('late', {
      prompts: { 'slot-posts': { fields: () => ({ extra: { type: 'string' } }), required: () => ['extra'] } }
    })
    const { buildSlotIntroPrompt } = await import('../src/renderer/prompts/slotIntroPrompt')
    const input = {
      playthroughId: '1',
      date: 3,
      time: 0,
      lessNsfwText: false,
      opening: '',
      recent: [],
      askers: [],
      breakups: [],
      posters: [],
      occasions: []
    } as unknown as Parameters<typeof buildSlotIntroPrompt>[0]
    const post = (): { required: string[]; properties: Record<string, unknown> } =>
      (buildSlotIntroPrompt(input, '', '').schema.schema as never as {
        properties: { posts: { items: { required: string[]; properties: Record<string, unknown> } } }
      }).properties.posts.items

    expect(post().properties).not.toHaveProperty('extra')
    on.late = true
    expect(post().properties).toHaveProperty('extra')
    expect(post().required).toContain('extra')
  })
})
