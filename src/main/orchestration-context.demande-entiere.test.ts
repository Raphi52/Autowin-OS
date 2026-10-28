import { describe, expect, it } from 'vitest'
import { collectOrchestrationContext } from './orchestration-context'
import { CONTEXT_LAST_REPLY_CHARS } from './conversation-window'

/**
 * PLAFOND MUET n°4 (conv-1228, 2026-10-28) : le contexte joint à un run coupait CHAQUE message du
 * fil à 600 caractères — y compris ceux de l'utilisateur. Une demande détaillée faite deux messages
 * plus tôt (une liste de points, un journal collé) arrivait au run amputée, sans autre signe qu'un
 * « … ». Les messages de l'utilisateur passent désormais entiers ; une réponse ancienne de
 * l'assistant reste résumée, mais la coupe dit combien elle a retiré.
 */
describe('le contexte d’un run porte les demandes de l’utilisateur en entier', () => {
  it('une demande longue de l’utilisateur arrive entière', () => {
    const demande = `Corrige ces points :\n${Array.from({ length: 40 }, (_, i) => `${i + 1}. point numéro ${i + 1} à traiter`).join('\n')}`
    expect(demande.length).toBeGreaterThan(600)
    const context = collectOrchestrationContext({
      task: 'go',
      conversation: {
        id: 'c',
        messages: [
          { role: 'user', content: demande },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'go' }
        ]
      }
    })
    expect(context).toContain('40. point numéro 40 à traiter')
  })

  it('une demande démesurée est bornée EN LE DISANT', () => {
    const enorme = `debut ${'x'.repeat(CONTEXT_LAST_REPLY_CHARS * 2)}`
    const context = collectOrchestrationContext({
      task: 't',
      conversation: { id: 'c', messages: [{ role: 'user', content: enorme }] }
    })
    expect(context).toContain('debut ')
    expect(context).toMatch(/coupée à \d+ caractères sur \d+/)
  })

  it('une réponse ancienne de l’assistant résumée dit combien elle a perdu', () => {
    const ancienne = `ancienne ${'y'.repeat(3_000)}`
    const context = collectOrchestrationContext({
      task: 't',
      conversation: {
        id: 'c',
        messages: [
          { role: 'assistant', content: ancienne },
          { role: 'user', content: 'suite' },
          { role: 'assistant', content: 'dernière' }
        ]
      }
    })
    expect(context).toMatch(/résumée : 600 caractères sur \d+/)
  })
})
