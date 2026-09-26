import { describe, expect, it } from 'vitest'
import { ConversationStore, type Conversation } from './conversations'
import { grouperConversations } from '../../renderer/src/components/conversation-groups'

/**
 * UN LIBELLE DE CLASSEMENT N'EST PAS UN DOSSIER DE TRAVAIL.
 *
 * Defaut vecu (conv-81, 2026-09-16) : `projectPath` portait DEUX roles a la fois — le dossier ou
 * l'agent travaille, et la categorie qui groupe la conversation dans la barre laterale. Classer une
 * conversation sous « Perso » ecrivait donc « Perso » comme dossier de travail : le tour partait
 * quand meme dans le depot d'Autowin (avec un avertissement, `bascule-dossier-conversation.ts`), et
 * le libelle allait grossir la liste des dossiers connus du menu « Ranger dans… ».
 *
 * La separation : `projectPath` ne prend QUE des chemins, `categorie` prend les libelles. Le
 * routage se fait a l'ECRITURE (sur la FORME de la valeur) et une seule fois a la relecture d'un
 * fichier ancien, ou le libelle est DEPLACE — jamais efface.
 */

function horloge(depart = 1000): () => number {
  let t = depart
  return () => t++
}

const neuve = (store: ConversationStore): string =>
  store.create({ title: 'A', provider: 'claude' }).id

// fix-ok: conv-81 — test dédié à la cause mesurée : projectPath portait deux rôles, le magasin route désormais sur la FORME de la valeur et déplace le libellé à la relecture.
describe('un libelle de classement ne devient jamais un dossier de travail', () => {
  it('classer sous un LIBELLE renseigne `categorie` et laisse `projectPath` vide', () => {
    const store = new ConversationStore(horloge())
    const id = neuve(store)

    store.rangerDansDossier(id, 'Perso')

    expect(store.get(id)?.categorie).toBe('Perso')
    expect(store.get(id)?.projectPath).toBeUndefined()
  })

  it('un libelle ne pilote pas le dossier de travail deja choisi', () => {
    const store = new ConversationStore(horloge())
    const id = neuve(store)
    store.rangerDansDossier(id, 'D:/GIT/RigApplication')

    store.rangerDansDossier(id, 'Factures')

    expect(store.get(id)?.projectPath).toBe('D:\\GIT\\RigApplication')
    expect(store.get(id)?.categorie).toBe('Factures')
  })

  it('choisir un vrai DOSSIER reprend la main sur la categorie : le fil suit son depot', () => {
    // Demande utilisateur : « renseigne le CWD et classe la conv dans la categorie qui s'appelle
    // comme le CWD ». Une categorie restee en place cacherait le fil ailleurs que sous son depot.
    const store = new ConversationStore(horloge())
    const id = neuve(store)
    store.rangerDansDossier(id, 'Factures')

    store.rangerDansDossier(id, 'D:/GIT/RigApplication')

    expect(store.get(id)?.projectPath).toBe('D:\\GIT\\RigApplication')
    expect(store.get(id)?.categorie).toBeUndefined()
    const groupe = grouperConversations(store.list())[0]
    expect(groupe.label).toBe('RigApplication')
  })

  it('`null` sort des DEUX : ni dossier ni categorie ne restent sur disque', () => {
    const store = new ConversationStore(horloge())
    const id = neuve(store)
    store.rangerDansDossier(id, 'Perso')

    store.rangerDansDossier(id, null)

    expect('categorie' in (store.get(id) as object)).toBe(false)
    expect('projectPath' in (store.get(id) as object)).toBe(false)
  })

  it('MIGRATION : un ancien `projectPath` qui est un libelle est DEPLACE, pas efface', () => {
    const ancienne = {
      id: 'conv-7',
      title: 'Ancienne',
      provider: 'claude',
      schemaVersion: 3,
      projectPath: 'Clients/Amitel',
      messages: [],
      createdAt: 1,
      updatedAt: 2
    } as unknown as Conversation
    const store = new ConversationStore(horloge())

    expect(store.hydrate([ancienne])).toBe(true)

    expect(store.get('conv-7')?.categorie).toBe('Clients/Amitel')
    expect(store.get('conv-7')?.projectPath).toBeUndefined()
  })

  it('MIGRATION : relire le fichier DEJA migre ne le reecrit pas', () => {
    // Sans idempotence, chaque demarrage reecrirait le snapshot entier « pour rien ».
    const premier = new ConversationStore(horloge())
    premier.hydrate([
      {
        id: 'conv-7',
        title: 'Ancienne',
        provider: 'claude',
        schemaVersion: 3,
        projectPath: 'Clients/Amitel',
        messages: [],
        createdAt: 1,
        updatedAt: 2
      } as unknown as Conversation
    ])
    const migree = structuredClone(premier.get('conv-7')!)

    const second = new ConversationStore(horloge())
    expect(second.hydrate([migree])).toBe(false)
    expect(second.get('conv-7')).toEqual(migree)
  })

  it('MIGRATION : un vrai chemin n’est PAS deplace en categorie', () => {
    const store = new ConversationStore(horloge())
    store.hydrate([
      {
        id: 'conv-8',
        title: 'Projet',
        provider: 'claude',
        schemaVersion: 3,
        projectPath: 'D:\\GIT\\RigApplication',
        messages: [],
        createdAt: 1,
        updatedAt: 2
      } as unknown as Conversation
    ])

    expect(store.get('conv-8')?.projectPath).toBe('D:\\GIT\\RigApplication')
    expect(store.get('conv-8')?.categorie).toBeUndefined()
  })
})
