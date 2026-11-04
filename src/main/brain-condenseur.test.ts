import { describe, expect, it, vi } from 'vitest'
import { condenserLecture, SEUIL_CONDENSE } from './brain-condenseur'

const longue = { found: true, status: 'found' as const, knowledge: 'x'.repeat(SEUIL_CONDENSE + 10) }

describe('condenserLecture (conv-1469)', () => {
  it('condense une note longue sur le besoin', async () => {
    const c = vi.fn(async (_charge: string) => '- fait utile')
    const r = await condenserLecture(longue, { besoin: 'le port' }, c)
    expect(r.knowledge).toBe('- fait utile')
    expect(c.mock.calls[0][0]).toContain('BESOIN : le port')
  })
  it('laisse passer note courte et entier: true', async () => {
    const c = vi.fn(async () => 'non')
    const courte = { ...longue, knowledge: 'court' }
    expect((await condenserLecture(courte, {}, c)).knowledge).toBe('court')
    expect((await condenserLecture(longue, { entier: true }, c)).knowledge).toBe(longue.knowledge)
    expect(c).not.toHaveBeenCalled()
  })
  it('rend la note entière sur panne, vide sans rapport', async () => {
    const panne = await condenserLecture(longue, {}, async () => { throw new Error('529') })
    expect(panne.knowledge).toBe(longue.knowledge)
    expect(panne.note).toContain('529')
    const vide = await condenserLecture(longue, {}, async () => 'AUCUN_RAPPORT')
    expect(vide.knowledge).toBe('')
  })
})
