import { describe, expect, it } from 'vitest'
import { rappelDesEchangesPasses } from './rappel-conversations'
import { ConversationStore } from '../store/conversations'

/**
 * LE RAPPEL NE GÈLE PAS LE TOUR PENDANT LA PRÉPARATION DE L'INDEX.
 *
 * Le rappel est appelé de façon SYNCHRONE à chaque tour de chat. Avant ce chantier, son premier appel de
 * session construisait l'index de recherche sur le fil principal : 3,5 s mesurées sur le corpus réel.
 * Désormais, si l'index n'est pas prêt, le tour part SANS rappel (un rappel est un confort) et
 * la construction se fait par tranches en arrière-plan.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : un rappel non vide avant que l'index soit prêt (donc une
 * construction sur le fil principal), ou un rappel vide une fois l'index prêt.
 */

function corpus(): ConversationStore {
  let horloge = 1000
  const store = new ConversationStore(() => horloge++)
  const a = store.create({ title: 'Code couleur', provider: 'claude' })
  store.append(a.id, {
    role: 'user',
    content: 'tu peux m’expliquer le code couleur de la pastille à côté des conversations'
  })
  store.append(a.id, { role: 'assistant', content: 'ambre = en cours, cyan = à jour' })
  const b = store.create({ title: 'Courante', provider: 'claude' })
  store.append(b.id, { role: 'user', content: 'remake les pastilles de couleurs' })
  return store
}

describe('rappel des échanges passés pendant la préparation de l’index', () => {
  it('rend vide sans construire l’index, puis rappelle une fois l’index prêt', async () => {
    const store = corpus()
    const demande = 'code couleur de la pastille'
    expect(rappelDesEchangesPasses(store, demande, undefined, 'claude', undefined)).toBe('')
    expect(store.indexPret()).toBe(false)
    await store.prechaufferIndex()
    expect(store.indexPret()).toBe(true)
    expect(rappelDesEchangesPasses(store, demande, undefined, 'claude', undefined)).toContain(
      'Code couleur'
    )
  })
})
