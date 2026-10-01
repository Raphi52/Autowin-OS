import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'

/**
 * UNE DEMANDE DEJA POSEE PASSE DEVANT LE MOT PORTEUR (conv-889, 2026-09-30).
 *
 * Le re-classement par mot porteur compte les occurrences du mot sujet dans TOUTE la conversation
 * (plafond 6). Une longue conversation qui repete les mots de la demande battait donc le fil ou
 * cette demande avait deja ete posee mot pour mot. Mesure sur le corpus reel : le fil d'origine
 * d'une demande reposee etait 1er 30 fois sur 42, 35 au score seul.
 *
 * ENTREES QUI DOIVENT FAIRE ECHOUER CE FICHIER :
 *  - sans la priorite, `Bavarde` passe devant `Origine` (premier cas) ;
 *  - sans la condition du mot porteur, `Autre sujet` passe devant `Zarbitro` (second cas).
 */
const DEMANDE = 'ajoute un plafond de cout journalier au watchdog des mails'

function corpus(): { store: ConversationStore; ids: Record<string, string> } {
  let horloge = 1000
  const store = new ConversationStore(() => horloge++)
  const ids: Record<string, string> = {}
  const creer = (titre: string, messages: string[]): void => {
    const c = store.create({ title: titre, provider: 'claude' })
    ids[titre] = c.id
    for (const [i, content] of messages.entries())
      store.append(c.id, { role: i % 2 === 0 ? 'user' : 'assistant', content })
  }
  // Repete chaque mot de la demande, jamais plus de deux dans le meme message.
  creer('Bavarde', [
    'le watchdog tourne',
    'le watchdog lit les mails',
    'watchdog relance',
    'mails recus',
    'un plafond existe',
    'plafond horaire',
    'le plafond journalier',
    'journalier ou horaire',
    'journalier encore',
    'cout connu',
    'cout inconnu',
    'cout par jour',
    'ajoute un test',
    'ajoute une borne',
    'ajoute un journal',
    'des mails encore'
  ])
  creer('Origine', [DEMANDE, 'fait : plafond pose'])
  creer('Bruit', ['parle-moi des tickets RIG', 'voici les tickets'])
  return { store, ids }
}

describe('recherche — une demande deja posee', () => {
  it('le fil ou la demande a deja ete posee passe devant la conversation bavarde', () => {
    const { store, ids } = corpus()
    expect(store.search(DEMANDE)[0]?.id).toBe(ids.Origine)
  })

  it('un message qui ne porte PAS le mot sujet ne passe pas devant', () => {
    // Les mots d'adresse sont COURANTS (six fils), le sujet est RARE : le cas reel du re-classement.
    // Chaque fil d'adresse couvre 9 mots sur 10 de la demande -- tous sauf « zarbitro ».
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const phrase = (sujet: string): string =>
      `rappelle moi exactement ce qu'on avait dit hier soir tard a propos ${sujet}`
    for (const sujet of [
      'des pastilles',
      'du build',
      'des tickets',
      'du quota',
      'de la barre',
      'du juge'
    ]) {
      const c = store.create({ title: `Adresse ${sujet}`, provider: 'claude' })
      store.append(c.id, { role: 'user', content: phrase(sujet) })
      store.append(c.id, { role: 'assistant', content: 'voici ce qu’on avait dit' })
    }
    const b = store.create({ title: 'Zarbitro', provider: 'claude' })
    store.append(b.id, { role: 'user', content: 'le zarbitro est le nouveau composant' })
    store.append(b.id, { role: 'assistant', content: 'zarbitro plante au demarrage, corrige' })
    const trouve = store.search(phrase('de zarbitro'))
    expect(trouve[0]?.id).toBe(b.id)
  })
})
