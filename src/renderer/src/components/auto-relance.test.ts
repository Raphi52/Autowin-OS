import { describe, expect, it } from 'vitest'
import { promptDeRelanceGratuite } from './auto-relance'
import type { Msg } from './chat-view-types'

/**
 * LA RELANCE AUTOMATIQUE NE CONCERNE QUE LE CAS GRATUIT.
 *
 * Cas mesuré trois fois les 12-13/08 : un scout tué par un redémarrage avant son premier appel
 * provider — 0 token, 0 texte, 0 action — marqué `cancelled` et abandonné jusqu'à un clic humain.
 * Relancer ce cas ne coûte rien et ne double rien. Tout autre cas reste à l'humain.
 */
const user = (content: string): Msg => ({ role: 'user', content })
const assistant = (patch: Record<string, unknown>): Msg =>
  ({ role: 'assistant', content: '', parts: [], status: 'completed', ...patch }) as unknown as Msg

describe('prompt de relance gratuite', () => {
  it('relance un tour interrompu qui n’a RIEN produit', () => {
    const messages = [user('scout des défauts réels'), assistant({ status: 'interrupted' })]
    expect(promptDeRelanceGratuite(messages)).toBe('scout des défauts réels')
  })

  it('NE relance JAMAIS un statut cancelled : un stop peut être volontaire', () => {
    // Appris des tests de comportement : le bouton d'interruption produit `cancelled`. Relancer
    // automatiquement ce cas rejouerait un tour que l'utilisateur vient d'arrêter exprès.
    const messages = [user('audit du coût'), assistant({ status: 'cancelled' })]
    expect(promptDeRelanceGratuite(messages)).toBeUndefined()
  })

  it('NE relance PAS si le modèle a parlé : de l’argent a été dépensé', () => {
    const messages = [
      user('scout'),
      assistant({
        status: 'interrupted',
        parts: [{ kind: 'text', text: 'Diagnostic ancré sur les vraies données…' }]
      })
    ]
    expect(promptDeRelanceGratuite(messages)).toBeUndefined()
  })

  it('NE relance PAS si une action a abouti ou échoué : des effets ont pu avoir lieu', () => {
    const okMessages = [
      user('scout'),
      assistant({ status: 'interrupted', parts: [{ kind: 'action', name: 'orchestrate', ok: true }] })
    ]
    const koMessages = [
      user('scout'),
      assistant({ status: 'interrupted', parts: [{ kind: 'action', name: 'orchestrate', ok: false }] })
    ]
    expect(promptDeRelanceGratuite(okMessages)).toBeUndefined()
    expect(promptDeRelanceGratuite(koMessages)).toBeUndefined()
  })

  it('une action marquée interrupted SANS résultat ne compte pas comme production', () => {
    // C'est le marquage posé par la réconciliation au démarrage, pas un travail du modèle.
    const messages = [
      user('scout'),
      assistant({
        status: 'interrupted',
        parts: [{ kind: 'action', name: 'orchestrate', interrupted: true }]
      })
    ]
    expect(promptDeRelanceGratuite(messages)).toBe('scout')
  })

  it('NE touche PAS un tour terminé, en échec explicite, ou encore en cours', () => {
    for (const status of ['completed', 'failed', 'streaming', 'cancelled']) {
      expect(promptDeRelanceGratuite([user('x'), assistant({ status })])).toBeUndefined()
    }
  })

  it('ne rend rien sans message utilisateur à rejouer', () => {
    expect(promptDeRelanceGratuite([assistant({ status: 'interrupted' })])).toBeUndefined()
    expect(promptDeRelanceGratuite([])).toBeUndefined()
  })
})
