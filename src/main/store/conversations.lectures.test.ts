import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConversationStore, branchesARattacher } from './conversations'

/** Horloge de test : chaque appel avance d'une unité, donc des dates strictement croissantes. */
function makeClock(start = 1000): () => number {
  let t = start
  return () => t++
}

/** Les sources TypeScript de production sous `dossier` : les tests sont exclus. */
function sourcesDeProduction(dossier: string): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(dossier, entree.name)
    if (entree.isDirectory()) return sourcesDeProduction(chemin)
    return entree.name.endsWith('.ts') && !entree.name.endsWith('.test.ts') ? [chemin] : []
  })
}

// fix-ok: cause mesurée — le garde-fou ne visait que le receveur `conversations` : `store.list()` et
// `conversationStore.list()` passaient inaperçus. La forme optionnelle `?.list?.(` doit tomber aussi.
/**
 * Un appel à la liste COMPLÈTE d'un store de fils, sous les trois noms qu'il porte dans le code :
 * `conversations` (le store de l'app), `conversationStore` et `store`. Formes directe, optionnelle
 * (`?.list?.(`) et sur plusieurs lignes. Les autres magasins (`sourceStore`, `stateStore`...) ne
 * sont pas visés.
 */
const APPEL_A_LA_LISTE_COMPLETE =
  /\b(conversations|conversationStore|store)\s*\??\.\s*list\s*(\?\.)?\s*\(/

/**
 * Le seul module de production qui lit encore la liste complète : il écrit le store sur disque, et
 * sa migration suit la bascule des archives. Exclu PAR SON CHEMIN, pas par son contenu : un autre
 * module qui écrirait `store.list()` tomberait dans le garde-fou.
 */
const MODULE_DE_LA_BASCULE = join('src', 'main', 'store', 'conversations-disk.ts')

/** Vrai quand ce fichier lit la liste complète d'un store de fils. */
function viseLaListeComplete(chemin: string, contenu: string): boolean {
  if (relative(process.cwd(), chemin) === MODULE_DE_LA_BASCULE) return false
  return APPEL_A_LA_LISTE_COMPLETE.test(contenu)
}

describe('lectures des fils du store', () => {
  it('listResumes rend chaque fil SANS son historique, avec ses métadonnées', () => {
    const store = new ConversationStore(makeClock())
    const fil = store.create({ title: 'Titre', provider: 'claude' })
    store.append(fil.id, { role: 'user', content: 'un message' })
    store.attachRun(fil.id, 'D:/runs/demande/RUN.md')

    const [resume] = store.listResumes()

    expect(resume).not.toHaveProperty('messages')
    expect(resume).toMatchObject({
      id: fil.id,
      title: 'Titre',
      provider: 'claude',
      runPaths: ['D:/runs/demande/RUN.md']
    })
  })

  it('listResumes porte les champs dérivés de l’historique, sans ses messages, comme listSummaries', () => {
    const store = new ConversationStore(makeClock())
    const fil = store.create({ title: 'Titre', provider: 'claude' })
    store.append(fil.id, { role: 'user', content: 'ma question' })
    store.append(fil.id, { role: 'assistant', content: 'ma réponse' })
    const dateDeLaQuestion = store.get(fil.id)!.messages.find((m) => m.role === 'user')!.ts

    const [resume] = store.listResumes()

    expect(resume).not.toHaveProperty('messages')
    expect(resume).toMatchObject({ messageCount: 2, lastMessageRole: 'assistant' })
    expect(dateDeLaQuestion).toBeGreaterThan(0)
    expect(resume.lastUserMessageAt).toBe(dateDeLaQuestion)
    expect(resume).toEqual(store.listSummaries()[0])
  })

  it('un résumé suit la modification et la suppression du fil : aucune copie périmée ne reste lue', () => {
    const store = new ConversationStore(makeClock())
    const fil = store.create({ title: 'Titre', provider: 'claude' })
    store.append(fil.id, { role: 'user', content: 'premiere' })
    expect(store.listResumes()[0]).toMatchObject({ messageCount: 1 })

    store.append(fil.id, { role: 'assistant', content: 'reponse' })
    expect(store.listResumes()[0]).toMatchObject({ messageCount: 2, lastMessageRole: 'assistant' })
    expect(store.get(fil.id)?.messages.map((message) => message.content)).toEqual([
      'premiere',
      'reponse'
    ])

    store.remove(fil.id)
    expect(store.listResumes()).toEqual([])
    expect(store.listAvecMessages()).toEqual([])
  })

  it('listAvecMessages rend le fil entier, messages compris', () => {
    const store = new ConversationStore(makeClock())
    const fil = store.create({ title: 'Titre', provider: 'claude' })
    store.append(fil.id, { role: 'user', content: 'un message' })

    const [complet] = store.listAvecMessages()

    expect(complet.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'un message' })
    ])
  })

  it('les deux lectures rendent les mêmes fils, le plus récemment touché en tête', () => {
    const store = new ConversationStore(makeClock())
    const premier = store.create({ title: 'premier créé', provider: 'claude' })
    const second = store.create({ title: 'second créé', provider: 'claude' })
    // Le premier créé, touché en dernier : il doit passer en tête dans les deux lectures.
    store.append(premier.id, { role: 'user', content: 'touché en dernier' })

    const ordreResumes = store.listResumes().map((resume) => resume.id)

    expect(ordreResumes).toEqual([premier.id, second.id])
    expect(ordreResumes).toEqual(store.listAvecMessages().map((fil) => fil.id))
  })

  it('list reste la lecture avec messages : il rend exactement ce que rend listAvecMessages', () => {
    const store = new ConversationStore(makeClock())
    const fil = store.create({ title: 'Titre', provider: 'claude' })
    store.append(fil.id, { role: 'user', content: 'un message' })

    expect(store.list()).toEqual(store.listAvecMessages())
  })

  it('get relit un fil archivé avec tout son historique : rattacherLaBranche en a besoin pour la branche et sa source', () => {
    // fix-ok: pendant la relecture des archives qui suit le démarrage, un fil archivé n'est pas encore
    // dans le store : `chargeurDArchive` le relit à la demande, et `get` doit le rendre entier, sinon
    // la branche et sa source perdraient leur historique.
    const disque = new ConversationStore(makeClock())
    const archive = disque.create({ title: 'Ancien fil', provider: 'claude' })
    disque.append(archive.id, { role: 'user', content: 'question' })
    disque.append(archive.id, { role: 'assistant', content: 'réponse' })
    const store = new ConversationStore(makeClock())
    store.chargeurDArchive = (id) => disque.get(id)

    expect(store.get(archive.id)?.messages.map((message) => message.content)).toEqual([
      'question',
      'réponse'
    ])
    expect(store.get('fil-inconnu')).toBeUndefined()
  })

  it('aucun code de production ne lit la liste complète d’un store de fils : chaque lecteur choisit listResumes ou listAvecMessages', () => {
    const racine = join(process.cwd(), 'src/main')
    const sources = sourcesDeProduction(racine)
    // Sans ce plancher, un dossier mal résolu rendrait le garde-fou vide, donc toujours vert.
    expect(sources.length).toBeGreaterThan(100)

    const appelants = sources
      .filter((chemin) => viseLaListeComplete(chemin, readFileSync(chemin, 'utf8')))
      .map((chemin) => relative(process.cwd(), chemin))

    expect(appelants).toEqual([])
  })

  it('le motif vise les trois noms du store, les formes optionnelles et sur plusieurs lignes ; jamais les lectures résumées ni les autres magasins', () => {
    expect(APPEL_A_LA_LISTE_COMPLETE.test('this.os.conversations?.list?.() ?? []')).toBe(true)
    expect(APPEL_A_LA_LISTE_COMPLETE.test('os.conversations\n      .list()')).toBe(true)
    expect(APPEL_A_LA_LISTE_COMPLETE.test('store.list()')).toBe(true)
    expect(APPEL_A_LA_LISTE_COMPLETE.test('conversationStore.list()')).toBe(true)
    expect(APPEL_A_LA_LISTE_COMPLETE.test('os.conversations.listResumes()')).toBe(false)
    expect(APPEL_A_LA_LISTE_COMPLETE.test('store.listResumes()')).toBe(false)
    expect(APPEL_A_LA_LISTE_COMPLETE.test('this.stateStore?.list()')).toBe(false)
    expect(APPEL_A_LA_LISTE_COMPLETE.test('this.dependencies.sourceStore.list()')).toBe(false)
  })

  it('conversations-disk.ts est exclu PAR SON CHEMIN, pas par son contenu : un autre module qui lit list() est visé', () => {
    const disque = join(process.cwd(), 'src/main/store/conversations-disk.ts')
    const autre = join(process.cwd(), 'src/main/store/autre-module.ts')

    expect(viseLaListeComplete(disque, 'store.list()')).toBe(false)
    expect(viseLaListeComplete(autre, 'store.list()')).toBe(true)
  })

  it('branchesARattacher rend les branches entières, et seulement elles', () => {
    const store = new ConversationStore(makeClock())
    const source = store.create({ title: 'Source', provider: 'claude' })
    store.append(source.id, { role: 'user', content: 'question' })
    const branche = store.fork(source.id, store.messagesOf(source.id).at(-1)?.messageId ?? '')
    store.create({ title: 'Sans source', provider: 'claude' })

    const branches = branchesARattacher(store)

    expect(branches.map((fil) => fil.id)).toEqual([branche.id])
    expect(branches[0]).toBe(store.get(branche.id))
    expect(branches[0].messages.map((message) => message.content)).toEqual(['question'])
  })

  it('branchesARattacher ne rend que les branches du fil source demandé', () => {
    const store = new ConversationStore(makeClock())
    const sourceA = store.create({ title: 'A', provider: 'claude' })
    store.append(sourceA.id, { role: 'user', content: 'a' })
    const brancheA = store.fork(sourceA.id, store.messagesOf(sourceA.id).at(-1)?.messageId ?? '')
    const sourceB = store.create({ title: 'B', provider: 'claude' })
    store.append(sourceB.id, { role: 'user', content: 'b' })
    store.fork(sourceB.id, store.messagesOf(sourceB.id).at(-1)?.messageId ?? '')

    expect(branchesARattacher(store, sourceA.id).map((fil) => fil.id)).toEqual([brancheA.id])
    expect(branchesARattacher(store, 'fil-inconnu')).toEqual([])
  })

  it('branchesARattacher garde une branche déjà lue quand elle est supprimée pendant le travail', () => {
    const store = new ConversationStore(makeClock())
    const source = store.create({ title: 'Source', provider: 'claude' })
    store.append(source.id, { role: 'user', content: 'question' })
    const branche = store.fork(source.id, store.messagesOf(source.id).at(-1)?.messageId ?? '')

    const branches = branchesARattacher(store)
    store.remove(branche.id)

    // La liste est prise avant l'attente de la boucle : une suppression pendant l'attente ne la change pas.
    expect(branches.map((fil) => fil.id)).toEqual([branche.id])
    expect(branches[0].messages).toHaveLength(1)
  })
})
