import { afterEach, describe, expect, it } from 'vitest'
import { appliquerLangue } from '../langue'
import { texteArtefactsEtBandeaux, traduireArtefactsEtBandeaux } from './artefacts-et-bandeaux'
import { texteChatDecisions, traduireChatDecisions } from './chat-decisions'

/*
 * Le texte d'une table dans la langue COURANTE, lue au moment de l'appel (comme `texteChatExecution`).
 * Chaque table en avait des copies locales : `texte` dans trois composants pour les artefacts et
 * bandeaux, `tx` dans trois autres pour les décisions du fil.
 */
afterEach(() => appliquerLangue('fr'))

describe('texte d’une table dans la langue courante', () => {
  it('artefacts et bandeaux : suit la langue appliquée et remplit les valeurs', () => {
    const valeurs = { raison: 'disque plein' }
    appliquerLangue('en')
    expect(texteArtefactsEtBandeaux('maj.echec', valeurs)).toBe(
      traduireArtefactsEtBandeaux('maj.echec', 'en', valeurs)
    )
    appliquerLangue('fr')
    expect(texteArtefactsEtBandeaux('maj.echec', valeurs)).toBe(
      traduireArtefactsEtBandeaux('maj.echec', 'fr', valeurs)
    )
  })

  it('décisions du fil : suit la langue appliquée', () => {
    appliquerLangue('en')
    expect(texteChatDecisions('pensee.raisonnement')).toBe(
      traduireChatDecisions('pensee.raisonnement', 'en', undefined)
    )
    appliquerLangue('fr')
    expect(texteChatDecisions('pensee.raisonnement')).toBe(
      traduireChatDecisions('pensee.raisonnement', 'fr', undefined)
    )
  })
})
