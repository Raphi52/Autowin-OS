import { describe, expect, it } from 'vitest'
import { commandeNonInjectable } from './skill-routing'

/**
 * LE REFUS D'INJECTION DOIT DIRE SON MOTIF (conv-891, 2026-09-30).
 *
 * Le processus principal refusait d'ajouter « et pour tester scout des améliorations… » au tour en
 * cours de conv-890 en rendant un simple `{ ok: false }` : l'écran ne pouvait pas distinguer ce refus
 * VOLONTAIRE d'une panne et affichait « ⚠ Échec ». Cette fonction nomme la commande reconnue, pour
 * que le reçu puisse dire pourquoi le message attend.
 */
describe('commandeNonInjectable', () => {
  it('nomme la commande lue dans le message réel de conv-890', () => {
    expect(
      commandeNonInjectable(
        'et pour tester scout des améliorations de notre systeme de workflow pour rendre le model plus autonome sur leur création et modification et suppression'
      )
    ).toBe('scout')
  })

  it('nomme une commande avec barre oblique', () => {
    expect(commandeNonInjectable('/judge mon watchdog')).toBe('judge')
  })

  it('un message ordinaire ne porte aucune commande', () => {
    expect(commandeNonInjectable('décale les icônes de 4 px')).toBeUndefined()
    expect(commandeNonInjectable('corrige le bouton workflows dans la page chat')).toBeUndefined()
  })
})
