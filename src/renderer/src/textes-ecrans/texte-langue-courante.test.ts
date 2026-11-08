import { afterEach, describe, expect, it } from 'vitest'
import { appliquerLangue } from '../langue'
import { texteArtefactsEtBandeaux, traduireArtefactsEtBandeaux } from './artefacts-et-bandeaux'
import { texteChatDecisions, traduireChatDecisions } from './chat-decisions'
import { texteTaskManager, traduireTaskManager } from './task-manager'
import { texteChatPanneaux, traduireChatPanneaux } from './chat-panneaux'

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

describe('texte des tables du Task Manager et des panneaux du fil', () => {
  it('suit la langue appliquée, comme les copies `texte` et `tx` retirées', () => {
    for (const langue of ['en', 'fr'] as const) {
      appliquerLangue(langue)
      expect(texteTaskManager('surveillance.source.outlook')).toBe(
        traduireTaskManager('surveillance.source.outlook', langue, undefined)
      )
      expect(texteChatPanneaux('quota.fenetre.hebdo')).toBe(
        traduireChatPanneaux('quota.fenetre.hebdo', langue, undefined)
      )
    }
  })
})
