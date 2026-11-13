import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'
import { attendreEcrituresConversations, persistConversations } from './conversations-disk'
import { cheminTexteDesArchives, ouvrirTexteDesArchives } from './recherche-archives'

/**
 * LE TEXTE DES FILS ARCHIVÉS VIT DANS UNE BASE DÉRIVÉE, PAS EN MÉMOIRE.
 *
 * Les deux côtés sont tenus : la base suit le cycle de vie du fil (rangé, ravivé, supprimé), et ce que
 * lisent la recherche et `listAvecTexte` ne change pas. La base n'est jamais la source de vérité : abîmée,
 * absente ou en retard, elle se reconstruit depuis l'archive.
 */
const racine = mkdtempSync(join(tmpdir(), 'aos-texte-archives-'))
afterAll(() => rmSync(racine, { recursive: true, force: true }))
let compteur = 0
const nouveauChemin = (): string => {
  const dossier = join(racine, `cas-${++compteur}`)
  mkdirSync(dossier, { recursive: true })
  return join(dossier, 'conversations.json')
}

const JOUR = 24 * 60 * 60 * 1000
const MAINTENANT = Date.parse('2026-11-13T12:00:00.000Z')

/** Les lignes de la base pour un fil, lues par une connexion à part, refermée aussitôt. */
function lignesDuFil(
  snapshot: string,
  id: string
): Array<{ rang: number; contenu: string | null }> {
  const base = new DatabaseSync(cheminTexteDesArchives(snapshot))
  try {
    return base
      .prepare('SELECT rang, contenu FROM texte WHERE fil = ? ORDER BY rang')
      .all(id) as Array<{ rang: number; contenu: string | null }>
  } finally {
    base.close()
  }
}

/** Laisse la base se refermer : elle l'est dès que le travail synchrone en cours rend la main. */
const laisserFermer = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** Un store persisté avec un fil vieux de 30 jours (à archiver) et un fil récent. */
function monter(p: string): { store: ConversationStore; vieux: string; recent: string } & {
  persistance: ReturnType<typeof persistConversations>
} {
  let horloge = MAINTENANT - 30 * JOUR
  const store = new ConversationStore(() => horloge)
  const persistance = persistConversations(store, p)
  const vieux = store.create({ title: 'Vieux fil', provider: 'claude' }).id
  store.append(vieux, { role: 'user', content: 'Question ancienne sur les éléphants' })
  store.append(vieux, { role: 'assistant', content: 'Réponse ancienne' })
  horloge = MAINTENANT - JOUR
  const recent = store.create({ title: 'Fil récent', provider: 'claude' }).id
  store.append(recent, { role: 'user', content: 'Question récente' })
  horloge = MAINTENANT
  return { store, persistance, vieux, recent }
}

const textesDe = (store: ConversationStore, id: string): string[] | undefined =>
  store
    .listAvecTexte()
    .find((fil) => fil.id === id)
    ?.messages.map((message) => message.content)

describe('ouvrirTexteDesArchives : la base elle-même', () => {
  it('range, relit, retire, élague ; un message sans texte reste sans texte', () => {
    const p = nouveauChemin()
    const texte = ouvrirTexteDesArchives(cheminTexteDesArchives(p))!
    expect(texte.ranger('conv-1', ['un', undefined, ''])).toBe(true)
    expect(texte.ranger('conv-2', ['deux'])).toBe(true)
    expect([0, 1, 2].map((rang) => texte.lire('conv-1', rang))).toEqual(['un', undefined, ''])
    texte.retirer('conv-1')
    expect(texte.lire('conv-1', 0)).toBeUndefined()
    texte.elaguer(new Set(['conv-3']))
    expect(texte.lire('conv-2', 0)).toBeUndefined()
    texte.fermer()
  })

  it('réécrit un fil dont le texte a changé, même rangé sous le même identifiant', () => {
    const p = nouveauChemin()
    const texte = ouvrirTexteDesArchives(cheminTexteDesArchives(p))!
    texte.ranger('conv-1', ['avant', 'suite'])
    texte.ranger('conv-1', ['après'])
    expect([texte.lire('conv-1', 0), texte.lire('conv-1', 1)]).toEqual(['après', undefined])
    texte.fermer()
  })

  it('un fichier abîmé à l’ouverture est effacé puis recréé', () => {
    const p = nouveauChemin()
    writeFileSync(cheminTexteDesArchives(p), 'ceci n’est pas une base SQLite, '.repeat(200))
    const texte = ouvrirTexteDesArchives(cheminTexteDesArchives(p))
    expect(texte).toBeDefined()
    expect(texte!.ranger('conv-1', ['relu'])).toBe(true)
    expect(texte!.lire('conv-1', 0)).toBe('relu')
    texte!.fermer()
  })
})

describe('cycle de vie d’un fil archivé et sa base', () => {
  it('ranger : le texte quitte la mémoire pour la base, et se lit à l’identique', async () => {
    const p = nouveauChemin()
    const { store, persistance, vieux } = monter(p)
    expect(await persistance.archiver(MAINTENANT)).toBe(1)
    await attendreEcrituresConversations()

    expect(lignesDuFil(p, vieux).map((l) => l.contenu)).toEqual([
      'Question ancienne sur les éléphants',
      'Réponse ancienne'
    ])
    const [message] = store.listAvecTexte().find((fil) => fil.id === vieux)!.messages
    // Aucune valeur gardée : `content` se relit dans la base à chaque lecture.
    expect(Object.getOwnPropertyDescriptor(message, 'content')?.get).toBeTypeOf('function')
    expect(textesDe(store, vieux)).toEqual([
      'Question ancienne sur les éléphants',
      'Réponse ancienne'
    ])
    // Une copie emporte le texte : les lecteurs qui recopient un message ne perdent rien.
    expect({ ...message }.content).toBe('Question ancienne sur les éléphants')
    expect(structuredClone(message).content).toBe('Question ancienne sur les éléphants')
    // La recherche de la liste trouve le texte archivé, accents repliés.
    const trouvees = await store.rechercherParContenuAsync('ELEPHANT')
    expect(trouvees.map((t) => t.id)).toEqual([vieux])
    await laisserFermer()
  })

  it('raviver : le fil touché redevient actif et entier, son texte quitte la base', async () => {
    const p = nouveauChemin()
    const { store, persistance, vieux } = monter(p)
    await persistance.archiver(MAINTENANT)
    await attendreEcrituresConversations()
    expect(lignesDuFil(p, vieux)).toHaveLength(2)

    store.append(vieux, { role: 'user', content: 'Nouvelle question' })
    await attendreEcrituresConversations()
    await laisserFermer()

    expect(lignesDuFil(p, vieux)).toEqual([])
    expect(textesDe(store, vieux)).toEqual([
      'Question ancienne sur les éléphants',
      'Réponse ancienne',
      'Nouvelle question'
    ])
  })

  it('supprimer : le fil archivé part, son texte aussi', async () => {
    const p = nouveauChemin()
    const { store, persistance, vieux } = monter(p)
    await persistance.archiver(MAINTENANT)
    await attendreEcrituresConversations()

    expect(store.remove(vieux)).toBe(true)
    await attendreEcrituresConversations()
    await laisserFermer()

    expect(lignesDuFil(p, vieux)).toEqual([])
    expect(textesDe(store, vieux)).toBeUndefined()
  })

  it('redémarrage : une base en retard ou abîmée se reconstruit depuis l’archive', async () => {
    const p = nouveauChemin()
    const { persistance, vieux } = monter(p)
    await persistance.archiver(MAINTENANT)
    await attendreEcrituresConversations()
    await laisserFermer()

    // En retard : la base porte un autre texte (et une autre empreinte) que l'archive.
    const base = new DatabaseSync(cheminTexteDesArchives(p))
    base.prepare("UPDATE texte SET contenu = 'périmé' WHERE fil = ?").run(vieux)
    base.prepare("UPDATE fils SET empreinte = 'ancienne' WHERE id = ?").run(vieux)
    base.close()
    const apresRetard = new ConversationStore(() => MAINTENANT)
    expect(await persistConversations(apresRetard, p).archivesChargees).toBe(1)
    expect(textesDe(apresRetard, vieux)).toEqual([
      'Question ancienne sur les éléphants',
      'Réponse ancienne'
    ])
    await laisserFermer()

    // Abîmée : le fichier n'est plus une base.
    writeFileSync(cheminTexteDesArchives(p), 'abîmé '.repeat(500))
    const apresDegat = new ConversationStore(() => MAINTENANT)
    expect(await persistConversations(apresDegat, p).archivesChargees).toBe(1)
    expect(textesDe(apresDegat, vieux)).toEqual([
      'Question ancienne sur les éléphants',
      'Réponse ancienne'
    ])
    await laisserFermer()
  })
})
